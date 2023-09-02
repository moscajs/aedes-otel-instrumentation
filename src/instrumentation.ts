import {
  InstrumentationBase,
  InstrumentationNodeModuleDefinition,
  InstrumentationNodeModuleFile,
  isWrapped,
  safeExecuteInTheMiddle,
} from '@opentelemetry/instrumentation'
import {
  MessagingDestinationKindValues,
  SemanticAttributes,
} from '@opentelemetry/semantic-conventions'
import type Aedes from 'aedes'
import type {
  AedesPublishPacket,
  ConnectPacket,
  Connection,
  PublishPacket,
} from 'aedes'
import type { IncomingMessage } from 'node:http'
import { AedesInstrumentationConfig, PublishInfo } from './types'
import {
  AedesClient,
  HandleConnect,
  HandlePublish,
  PacketFactory,
} from './internal-types'
import {
  CONNECTION_ATTRIBUTES,
  PACKET_STORED_CONTEXT,
  PACKET_STORED_SPAN,
  isNetSocket,
  isNetSocketAddress,
} from './utils'
import {
  Span,
  SpanKind,
  context,
  diag,
  propagation,
  trace,
} from '@opentelemetry/api'
import { AedesPacket } from 'aedes-packet'

export class AedesInstrumentation extends InstrumentationBase {
  protected override _config: AedesInstrumentationConfig = {
    enabled: true,
  }

  constructor(
    config: AedesInstrumentationConfig = {
      enabled: true,
    }
  ) {
    super('@opentelemetry/instrumentation-aedes', '0.0.0', config)
  }

  override setConfig(config: AedesInstrumentationConfig = {}) {
    this._config = config
  }

  override getConfig(): AedesInstrumentationConfig {
    return this._config
  }

  isWrapped<M extends object>(moduleExports: M, name?: keyof M) {
    if (!name || !(name in moduleExports)) {
      return isWrapped(moduleExports)
    }
    return isWrapped(moduleExports[name])
  }

  protected init() {
    this._diag.debug('patching')

    const handleConnectModuleFile = new InstrumentationNodeModuleFile(
      'aedes/lib/handlers/connect.js',
      ['>=0.5.0'],
      this.patchHandleConnect.bind(this),
      this.unpatchHandleConnect.bind(this)
    )

    const handlePublishModuleFile = new InstrumentationNodeModuleFile(
      'aedes/lib/handlers/publish.js',
      ['>=0.5.0'],
      this.patchHandlePublish.bind(this),
      this.unpatchHandlePublish.bind(this)
    )

    // TODO: patch aedes/lib/write to attach event to span created during publish

    const aedesPacketModule = new InstrumentationNodeModuleDefinition(
      'aedes-packet',
      ['>=3.0.0'],
      this.patchAedesPacket.bind(this),
      this.unpatchAedesPacket.bind(this)
    )

    const aedesModule = new InstrumentationNodeModuleDefinition<typeof Aedes>(
      'aedes',
      ['>=0.5.0'],
      this.patchAedes.bind(this),
      this.unpatchAedes.bind(this),
      [handleConnectModuleFile, handlePublishModuleFile]
    )

    return [aedesPacketModule, aedesModule]
  }

  // #region aedes-packet
  private patchAedesPacket(moduleExports: { Packet: PacketFactory }) {
    moduleExports = this.unpatchAedesPacket(moduleExports)
    if (!isWrapped(moduleExports)) {
      this._wrap(moduleExports, 'Packet', this.getAedesPacketPatch.bind(this))
    }
    return moduleExports
  }

  private unpatchAedesPacket(moduleExports: { Packet: PacketFactory }) {
    if (isWrapped(moduleExports)) {
      this._unwrap(moduleExports, 'Packet')
    }
    return moduleExports
  }

  private getAedesPacketPatch(original: PacketFactory) {
    return function patchedPacket(
      this: Aedes,
      originalPacket?: AedesPacket,
      broker?: Aedes
    ) {
      const packet = original.call(this, originalPacket, broker) as AedesPacket
      if (!originalPacket) {
        return packet
      }
      PACKET_STORED_CONTEXT in originalPacket &&
        (packet[PACKET_STORED_CONTEXT] = originalPacket[PACKET_STORED_CONTEXT])
      PACKET_STORED_SPAN in originalPacket &&
        (packet[PACKET_STORED_SPAN] = originalPacket[PACKET_STORED_SPAN])
      return packet
    }
  }

  // #endregion

  // #region aedes class

  private patchAedes(moduleExports: typeof Aedes) {
    moduleExports = this.unpatchAedes(moduleExports)
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
      )
    }
    // TODO: how to patch preconnect ?
    return moduleExports
  }

  private unpatchAedes(moduleExports: typeof Aedes) {
    if (isWrapped(moduleExports.prototype.handle)) {
      this._unwrap(moduleExports.prototype, 'handle')
    }
    if (isWrapped(moduleExports.prototype.subscribe)) {
      this._unwrap(moduleExports.prototype, 'subscribe')
    }
    return moduleExports
  }

  private getAedesHandlePatch(original: Aedes['handle']) {
    return function patchedHandle(
      this: Aedes,
      stream: Connection,
      request?: IncomingMessage
    ) {
      const client = original.call(this, stream, request) as AedesClient
      client[CONNECTION_ATTRIBUTES] = {
        [SemanticAttributes.MESSAGING_SYSTEM]: 'aedes',
        // How to get the broker URL?
        [SemanticAttributes.MESSAGING_URL]: '',
      }
      // use protocol decoder to determine remote address ?
      if (isNetSocket(stream)) {
        const address = stream.address()
        client[CONNECTION_ATTRIBUTES][SemanticAttributes.NET_PEER_IP] =
          stream.remoteAddress
        client[CONNECTION_ATTRIBUTES][SemanticAttributes.NET_PEER_PORT] =
          stream.remotePort
        if (isNetSocketAddress(address)) {
          client[CONNECTION_ATTRIBUTES][SemanticAttributes.NET_HOST_IP] =
            address.address
          client[CONNECTION_ATTRIBUTES][SemanticAttributes.NET_HOST_PORT] =
            address.port
          client[CONNECTION_ATTRIBUTES][
            SemanticAttributes.NET_TRANSPORT
          ] = `IP.${address.family}`
        }
      }
      return client
    }
  }

  // #endregion

  // #region aedes handlers

  private patchHandleConnect(moduleExports: HandleConnect) {
    this.unpatchHandleConnect(moduleExports)
    if (!this.isWrapped(moduleExports, 'handleConnect')) {
      this._wrap(
        moduleExports,
        'handleConnect',
        this.getHandleConnectPatch.bind(this)
      )
    }
    return moduleExports
  }

  private unpatchHandleConnect(moduleExports?: HandleConnect) {
    if (moduleExports && this.isWrapped(moduleExports, 'handleConnect')) {
      this._unwrap(moduleExports, 'handleConnect')
    }
    return moduleExports
  }

  private getHandleConnectPatch(original: HandleConnect['handleConnect']) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this
    return function patchedHandleConnect(
      this: unknown,
      client: AedesClient,
      packet: ConnectPacket,
      done: (err?: Error) => void
    ) {
      const attributes = {
        ...client[CONNECTION_ATTRIBUTES],
        [SemanticAttributes.MESSAGING_DESTINATION_KIND]:
          MessagingDestinationKindValues.TOPIC,
        [SemanticAttributes.MESSAGING_CONSUMER_ID]: packet.clientId,
        [SemanticAttributes.MESSAGING_PROTOCOL]: 'MQTT',
        // TODO: determine the correct version based on packet.protocolVersion and packet.protocolId
        [SemanticAttributes.MESSAGING_PROTOCOL_VERSION]: '3.1.1',
      }

      return self.tracer.startActiveSpan(
        `mqtt connect`,
        {
          kind: SpanKind.SERVER,
          attributes,
        },
        (span: Span | undefined) => {
          return original.call(
            this,
            client,
            packet,
            function callbackOverride(this: unknown, err?: Error) {
              if (!err) {
                client[CONNECTION_ATTRIBUTES] = attributes
                // console.log('connect', client[CONNECTION_ATTRIBUTES])
                span?.setStatus({ code: 0 })
              } else {
                span?.setStatus({ code: 1 })
                span?.recordException(err)
              }
              span?.end()
              done.call(this, err)
            }
          )
        }
      )
    }
  }

  private patchHandlePublish(moduleExports: HandlePublish) {
    this.unpatchHandlePublish(moduleExports)
    if (!this.isWrapped(moduleExports, 'handlePublish')) {
      this._wrap(
        moduleExports,
        'handlePublish',
        this.getHandlePublishPatch.bind(this)
      )
    }
    return moduleExports
  }

  private unpatchHandlePublish(moduleExports?: HandlePublish) {
    if (moduleExports && this.isWrapped(moduleExports, 'handlePublish')) {
      this._unwrap(moduleExports, 'handlePublish')
    }
    return moduleExports
  }

  private createPublishSpan(
    self: AedesInstrumentation,
    client: AedesClient,
    packet: AedesPublishPacket | PublishPacket
  ) {
    const topic = packet.topic
    const span = self.tracer.startSpan(`${topic} send`, {
      kind: SpanKind.PRODUCER,
      attributes: {
        ...client[CONNECTION_ATTRIBUTES],
        [SemanticAttributes.MESSAGING_DESTINATION]: topic,
        [SemanticAttributes.MESSAGING_DESTINATION_KIND]:
          MessagingDestinationKindValues.TOPIC,
        [SemanticAttributes.MESSAGING_MESSAGE_ID]: packet.messageId,
      },
    })
    // that's very tricky to propagate the context in Aedes
    // here packet will be GC and won't be used in subscribe delivery func
    // so we use an extra library to patch aedes-packet
    // and this lib will copy the ctx that transports the context
    packet[PACKET_STORED_CONTEXT] ??= {}
    propagation.inject(
      trace.setSpan(context.active(), span),
      packet[PACKET_STORED_CONTEXT]
    )
    return span
  }

  private callPublishHook(span: Span, info: PublishInfo) {
    const publishHook = this.getConfig().publishHook
    if (typeof publishHook === 'function') {
      safeExecuteInTheMiddle(
        () => publishHook(span, info),
        (e) => {
          if (e) {
            diag.error('aedes instrumentation: publishHook error', e)
          }
        },
        true
      )
    }
  }

  private getHandlePublishPatch(original: HandlePublish['handlePublish']) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this
    return function patchedHandlePublish(
      this: unknown,
      client: AedesClient,
      packet: AedesPublishPacket | PublishPacket,
      done: (err?: Error) => void
    ) {
      // ? maybe the span should be created before calling original its callback ?
      return original.call(
        this,
        client,
        packet,
        function callbackOverride(this: unknown, err?: Error) {
          const span = self.createPublishSpan(self, client, packet)
          self.callPublishHook(span, { client, packet })
          // TODO: based on QoS, span should be ended in puback
          // TODO: patch handlePuback to end the span and call publishConfirmHook
          if (!err) {
            span.setStatus({ code: 0 })
          } else {
            span.setStatus({ code: 1 })
            span.recordException(err)
          }
          span.end()
          done.call(this, err)
        }
      )
    }
  }
  // #endregion
}
