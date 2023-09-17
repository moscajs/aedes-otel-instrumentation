import { ROOT_CONTEXT, context } from '@opentelemetry/api'
import {
  InstrumentationBase,
  InstrumentationConfig,
  InstrumentationNodeModuleDefinition,
  isWrapped,
} from '@opentelemetry/instrumentation'
import type { Packet, parser, writeToStream } from 'mqtt-packet'

import { AedesInstrumentationConfig } from './types'
import { VERSION, getContextFromPacket, setContextInPacket } from './utils'

type MqttPacketModule = {
  parser: typeof parser
  writeToStream: typeof writeToStream
}

export class MqttPacketInstrumentation extends InstrumentationBase {
  protected override _config: InstrumentationConfig = {}

  constructor(config: InstrumentationConfig = {}) {
    super('@opentelemetry/instrumentation-mqtt-packet', VERSION, config)
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

    const mqttPacketModule = new InstrumentationNodeModuleDefinition(
      'mqtt-packet',
      ['>=8.0.0'],
      this.patchMqttPacket.bind(this),
      this.unpatchMqttPacket.bind(this)
    )

    return [mqttPacketModule]
  }

  // #region aedes-packet
  private patchMqttPacket(moduleExports: MqttPacketModule) {
    moduleExports = this.unpatchMqttPacket(moduleExports)
    if (!isWrapped(moduleExports.parser)) {
      this._wrap(
        moduleExports,
        'parser',
        this.getMqttPacketParserPatch.bind(this)
      )
    }
    if (!isWrapped(moduleExports.writeToStream)) {
      this._wrap(
        moduleExports,
        'writeToStream',
        // there is a type conflict here since writeToStream is declared as a function returning a boolean
        // and a namespace containing a property cacheNumbers
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.getMqttPacketWriteToStreamPatch.bind(this) as any
      )
    }
    return moduleExports
  }

  private unpatchMqttPacket(moduleExports: MqttPacketModule) {
    if (isWrapped(moduleExports)) {
      this._unwrap(moduleExports, 'parser')
    }
    return moduleExports
  }

  private getMqttPacketParserPatch(original: typeof parser): typeof parser {
    return function patchedParser(
      this: unknown,
      options?: { protocolVersion?: number }
    ) {
      const parser = original.call(this, options)
      // we want to ensure this is the first listener so that all other listeners will have the context set in the packet
      parser.prependListener('packet', (packet) => {
        const parentCtx = getContextFromPacket(packet, ROOT_CONTEXT, options)
        if (!parentCtx) setContextInPacket(packet, context.active(), options)
      })
      //! or
      // const originalEmit = parser.emit.bind(parser)
      // parser.emit = (eventName, packet) => {
      //   if (eventName === 'packet') {
      //     const parentCtx = getContextFromPacket(packet, options)
      //     if (!parentCtx) setContextInPacket(packet, context.active(), options)
      //   }
      //   return originalEmit(eventName, packet)
      // }
      return parser
    }
  }

  private getMqttPacketWriteToStreamPatch(
    original: typeof writeToStream
  ): (
    packet: Packet,
    stream: NodeJS.WritableStream,
    opts?: { protocolVersion?: number }
  ) => boolean {
    return function patchedWriteToStream(
      this: unknown,
      packet: Packet,
      stream: NodeJS.WritableStream,
      opts: { protocolVersion?: number } = {}
    ) {
      // const parentContext = context.active() or ? ROOT_CONTEXT
      setContextInPacket(packet, context.active(), opts)
      return original.call(this, packet, stream, opts)
    }
  }
}
