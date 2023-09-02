import { Span } from '@opentelemetry/api';
import {
  InstrumentationBase,
  InstrumentationNodeModuleDefinition,
  InstrumentationNodeModuleFile,
  isWrapped,
} from '@opentelemetry/instrumentation';
import {
  MessagingDestinationKindValues,
  SemanticAttributes,
} from '@opentelemetry/semantic-conventions';
import type Aedes from 'aedes';
import type { ConnectPacket, Connection } from 'aedes';
import type { IncomingMessage } from 'node:http';
import { AedesInstrumentationConfig } from './types';
import {
  AedesClient,
  HandleConnect,
  PacketFactory,
  PatchedAedesPacket,
} from './internal-types';
import { CONNECTION_ATTRIBUTES, PACKET_STORED_SPAN } from './utils';

declare module 'mqtt-packet' {
  export interface IPacket {
    ctx?: {
      traceparent?: any;
      tracestate?: any;
    };
    [PACKET_STORED_SPAN]?: Span;
  }
}

export class AedesInstrumentation extends InstrumentationBase {
  protected override _config!: AedesInstrumentationConfig;

  constructor(config: AedesInstrumentationConfig = {}) {
    super('@opentelemetry/instrumentation-aedes', '0.0.0', config);
  }

  override setConfig(config: AedesInstrumentationConfig = {}) {
    this._config = config;
  }

  isWrapped<M extends object>(moduleExports: M, name?: keyof M) {
    if (!name || !(name in moduleExports)) {
      return isWrapped(moduleExports);
    }
    return isWrapped(moduleExports[name]);
  }

  protected init() {
    this._diag.debug('patching');

    const handleConnectModuleFile = new InstrumentationNodeModuleFile(
      'aedes/lib/handlers/connect.js',
      ['>=0.5.0'],
      this.patchConnect.bind(this),
      this.unpatchConnect.bind(this)
    );

    // TODO: patch aedes/lib/write to attach event to span created during publish

    const aedesPacketModule = new InstrumentationNodeModuleDefinition(
      'aedes-packet',
      ['>=3.0.0'],
      this.patchAedesPacket.bind(this),
      this.unpatchAedesPacket.bind(this)
    );

    const aedesModule = new InstrumentationNodeModuleDefinition<typeof Aedes>(
      'aedes',
      ['>=0.5.0'],
      this.patchAedes.bind(this),
      this.unpatchAedes.bind(this),
      [handleConnectModuleFile]
    );

    return [aedesPacketModule, aedesModule];
  }

  // #region aedes-packet
  private patchAedesPacket(moduleExports: { Packet: PacketFactory }) {
    moduleExports = this.unpatchAedesPacket(moduleExports);
    if (!isWrapped(moduleExports)) {
      this._wrap(moduleExports, 'Packet', this.getAedesPacketPatch.bind(this));
    }
    return moduleExports;
  }

  private unpatchAedesPacket(moduleExports: { Packet: PacketFactory }) {
    if (isWrapped(moduleExports)) {
      this._unwrap(moduleExports, 'Packet');
    }
    return moduleExports;
  }

  private getAedesPacketPatch(original: PacketFactory) {
    return function patchedPacket(
      this: Aedes,
      originalPacket: PatchedAedesPacket,
      broker?: Aedes
    ) {
      const packet = original.call(
        this,
        originalPacket,
        broker
      ) as PatchedAedesPacket;
      packet.ctx = originalPacket.ctx;
      packet[PACKET_STORED_SPAN] = originalPacket[PACKET_STORED_SPAN];
      return packet;
    };
  }

  // #endregion

  // #region aedes

  private patchAedes(moduleExports: typeof Aedes) {
    moduleExports = this.unpatchAedes(moduleExports);
    if (!this.isWrapped(moduleExports.prototype, 'handle')) {
      // this require to modify aedes =>
      // Aedes.prototype.handle = function (conn, req) {
      // 	conn.setMaxListeners(this.concurrency * 2)
      // 	// create a new Client instance for a new connection
      // 	// return, just to please standard
      // 	return new Client(this, conn, req)
      // }
      this._wrap(
        moduleExports.prototype,
        'handle',
        this.getAedesHandlePatch.bind(this)
      );
    }
    // TODO: how to patch preconnect ?
    return moduleExports;
  }

  private unpatchAedes(moduleExports: typeof Aedes) {
    if (isWrapped(moduleExports.prototype.handle)) {
      this._unwrap(moduleExports.prototype, 'handle');
    }
    if (isWrapped(moduleExports.prototype.subscribe)) {
      this._unwrap(moduleExports.prototype, 'subscribe');
    }
    return moduleExports;
  }

  private patchConnect(moduleExports: HandleConnect) {
    this.unpatchConnect(moduleExports);
    if (!this.isWrapped(moduleExports, 'handleConnect')) {
      this._wrap(
        moduleExports,
        'handleConnect',
        this.getConnectPatch.bind(this)
      );
    }
    return moduleExports;
  }

  private unpatchConnect(moduleExports?: HandleConnect) {
    if (moduleExports && this.isWrapped(moduleExports, 'handleConnect')) {
      this._unwrap(moduleExports, 'handleConnect');
    }
    return moduleExports;
  }

  private getAedesHandlePatch(original: Aedes['handle']) {
    return function patchedHandle(
      this: Aedes,
      stream: Connection,
      request?: IncomingMessage
    ) {
      const client = original.call(this, stream, request) as AedesClient;
      client[CONNECTION_ATTRIBUTES] = {
        [SemanticAttributes.MESSAGING_SYSTEM]: 'aedes',
        // How to get the broker URL?
        [SemanticAttributes.MESSAGING_URL]: '',
        // ? use protocol decoder to determine remote address ?
        // [SemanticAttributes.NET_PEER_IP]: client.conn.remoteAddress,
        // [SemanticAttributes.NET_PEER_PORT]: client.conn.remotePort,
        // [SemanticAttributes.NET_TRANSPORT]:'IP.TCP',
      };
      return client;
    };
  }

  private getConnectPatch(original: HandleConnect['handleConnect']) {
    return function patchedConnect(
      this: unknown,
      client: AedesClient,
      packet: ConnectPacket,
      done: (err?: Error) => void
    ) {
      return original.call(
        this,
        client,
        packet,
        function callbackOverride(this: unknown, err?: Error) {
          if (!err) {
            client[CONNECTION_ATTRIBUTES] = {
              ...client[CONNECTION_ATTRIBUTES],
              [SemanticAttributes.MESSAGING_DESTINATION_KIND]:
                MessagingDestinationKindValues.TOPIC,
              [SemanticAttributes.MESSAGING_CONSUMER_ID]: packet.clientId,
              [SemanticAttributes.MESSAGING_PROTOCOL]: 'MQTT',
              // TODO: determine the correct version based on packet.protocolVersion and packet.protocolId
              [SemanticAttributes.MESSAGING_PROTOCOL_VERSION]: '3.1.1',
              [SemanticAttributes.MESSAGE_ID]: packet.messageId,
            };
            console.log(client[CONNECTION_ATTRIBUTES]);
          }
          done.call(this, err);
        }
      );
    };
  }

  // #endregion
}
