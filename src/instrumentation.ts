import {
  Attributes,
  Histogram,
  HrTime,
  INVALID_SPAN_CONTEXT,
  Span,
  SpanKind,
  SpanOptions,
  ValueType,
  context,
  diag,
  trace,
} from '@opentelemetry/api'
import {
  hrTime,
  hrTimeDuration,
  hrTimeToMilliseconds,
} from '@opentelemetry/core'
import {
  InstrumentationBase,
  InstrumentationNodeModuleDefinition,
  InstrumentationNodeModuleFile,
  isWrapped,
  safeExecuteInTheMiddle,
} from '@opentelemetry/instrumentation'
import {
  MessagingDestinationKindValues,
  MessagingOperationValues,
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
import { AedesClient, HandleConnect, HandlePublish } from './internal-types'
import {
  CONNECTION_ATTRIBUTES,
  getContextFromPacket,
  getMetricAttributes,
  isNetSocket,
  isNetSocketAddress,
  setContextInPacket,
  setSpanWithError,
} from './utils'

export class AedesInstrumentation extends InstrumentationBase {
  protected override _config!: AedesInstrumentationConfig
  private _mqttBrokerDurationHistogram!: Histogram
  private _mqttClientDurationHistogram!: Histogram
  readonly _spanNotEnded = new WeakSet<Span>()

  constructor(
    config: AedesInstrumentationConfig = {
      enabled: true,
      requireParentforIncomingSpans: false,
    }
  ) {
    super('@opentelemetry/instrumentation-aedes', '0.0.0', config)
  }

  protected override _updateMetricInstruments() {
    this._mqttBrokerDurationHistogram = this.meter.createHistogram(
      'mqtt.server.duration',
      {
        description: 'Measures the duration of inbound MQTT published packets.',
        unit: 'ms',
        valueType: ValueType.DOUBLE,
      }
    )
    this._mqttClientDurationHistogram = this.meter.createHistogram(
      'mqtt.client.duration',
      {
        description:
          'Measures the duration of outbound MQTT published packets.',
        unit: 'ms',
        valueType: ValueType.DOUBLE,
      }
    )
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

    const aedesModule = new InstrumentationNodeModuleDefinition<typeof Aedes>(
      'aedes',
      ['>=0.5.0'],
      this.patchAedes.bind(this),
      this.unpatchAedes.bind(this),
      [handleConnectModuleFile, handlePublishModuleFile]
    )

    return [aedesModule]
  }

  // #endregion

  // #region span management

  private startSpan(
    name: string,
    options: SpanOptions,
    ctx = context.active()
  ) {
    const requireParent = this.getConfig().requireParentforIncomingSpans
    let span: Span
    const currentSpan = trace.getSpan(ctx)

    if (requireParent && currentSpan === undefined) {
      span = trace.wrapSpanContext(INVALID_SPAN_CONTEXT)
    } else if (requireParent && currentSpan?.spanContext().isRemote) {
      span = currentSpan
    } else {
      span = this.tracer.startSpan(name, options, ctx)
    }
    this._spanNotEnded.add(span)

    return span
  }

  private endSpan(
    span: Span,
    spanKind: SpanKind,
    startTime: HrTime,
    metricAttributes: Attributes = {}
  ) {
    if (!this._spanNotEnded.has(span)) {
      return
    }

    span.end()
    this._spanNotEnded.delete(span)

    // Record metrics
    const duration = hrTimeToMilliseconds(hrTimeDuration(startTime, hrTime()))
    if (spanKind === SpanKind.SERVER) {
      this._mqttBrokerDurationHistogram.record(duration, metricAttributes)
    } else if (spanKind === SpanKind.CLIENT) {
      this._mqttClientDurationHistogram.record(duration, metricAttributes)
    }
  }

  // #endregion

  // #region aedes class

  private patchAedes(moduleExports: typeof Aedes) {
    moduleExports = this.unpatchAedes(moduleExports)
    if (!this.isWrapped(moduleExports.prototype, 'handle')) {
      this._wrap(
        moduleExports.prototype,
        'handle',
        this.getAedesHandlePatch.bind(this)
      )
    }
    if (!this.isWrapped(moduleExports.prototype, 'subscribe')) {
      this._wrap(
        moduleExports.prototype,
        'subscribe',
        this.getAedesSubscribePatch.bind(this)
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
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const instrumentation = this
    return function patchedHandle(
      this: Aedes,
      stream: Connection,
      request?: IncomingMessage
    ) {
      instrumentation._diag.debug(`instrumentation incoming connection`)

      const setHostAttributes = () => {
        client[CONNECTION_ATTRIBUTES] = {
          [SemanticAttributes.MESSAGING_SYSTEM]: 'aedes',
          [SemanticAttributes.MESSAGING_DESTINATION_KIND]:
            MessagingDestinationKindValues.TOPIC,
          // How to get the broker URL?
          [SemanticAttributes.MESSAGING_URL]: '',
        }
        // TODO: use protocol decoder to determine remote address ?
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
      }

      const client = original.call(this, stream, request) as AedesClient
      setHostAttributes()

      // TODO: add listener to client to remove spans from _spanNotEnded when client is closed
      return client
    }
  }

  /**
   *
   * This function should be called before `getSubscribePatch`
   */
  private getAedesSubscribePatch(original: Aedes['subscribe']) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const instrumentation = this
    return function patchedSubscribe(
      this: Aedes,
      ...args: Parameters<Aedes['subscribe']>
    ) {
      const [topic, deliver] = args
      const kind = SpanKind.CLIENT
      // const deliver = args[1]
      const attributes = {
        // TODO: retrieve the client (receiver) attributes
        // ...client[CONNECTION_ATTRIBUTES],
        [SemanticAttributes.MESSAGING_DESTINATION]: topic,
        [SemanticAttributes.MESSAGING_DESTINATION_KIND]:
          MessagingDestinationKindValues.TOPIC,
        [SemanticAttributes.MESSAGING_OPERATION]:
          MessagingOperationValues.PROCESS,
      }

      function patchedDeliverFunc(
        this: unknown,
        packet: AedesPublishPacket,
        callback: () => void
      ) {
        // const client = broker.?
        const parentContext = getContextFromPacket(packet)
        const startTime = hrTime()
        const span = instrumentation.startSpan(
          `${topic} receive`,
          {
            kind,
            attributes,
          },
          parentContext
        )

        const currentContext = trace.setSpan(
          parentContext || context.active(),
          span
        )
        instrumentation.callConsumeHook(span, packet)

        function wrappedCallback(this: unknown) {
          instrumentation.callConsumeEndHook(span, packet, null)
          instrumentation.endSpan(span, kind, startTime)
          // const cb = context.bind(currentContext, callback)
          // cb.apply(this)
          callback.call(this)
        }

        // TODO depending on QoS :
        // - span should be ended in this function for QoS 0 and 1
        // - span should be ended in packet ack for QoS 2

        // context.with(ctx, () => {
        //   deliver.call(this, packet, wrappedCallback)
        // })

        return context.with(
          currentContext,
          deliver,
          this,
          packet,
          wrappedCallback
        )
      }

      args[1] = patchedDeliverFunc

      return original.apply(this, args)
    }
  }

  private callConsumeHook(span: Span, packet: PublishPacket) {
    const consumeHook = this.getConfig().consumeHook
    if (typeof consumeHook !== 'function') return
    safeExecuteInTheMiddle(
      () => consumeHook(span, { packet }),
      (e) => {
        if (e) {
          diag.error('aedes instrumentation: consumeHook error', e)
        }
      },
      true
    )
  }

  private callConsumeEndHook(
    span: Span,
    packet: PublishPacket,
    rejected: boolean | null
  ) {
    const consumeEndHook = this.getConfig().consumeEndHook
    if (typeof consumeEndHook !== 'function') return
    safeExecuteInTheMiddle(
      () =>
        consumeEndHook(span, {
          packet,
          rejected,
        }),
      (e) => {
        if (e) {
          diag.error('aedes instrumentation: consumerEndHook error', e)
        }
      },
      true
    )
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
    const instrumentation = this
    return function patchedHandleConnect(
      this: unknown,
      client: AedesClient,
      packet: ConnectPacket,
      done: (err?: Error) => void
    ) {
      const kind = SpanKind.INTERNAL
      const attributes = {
        ...client[CONNECTION_ATTRIBUTES],
        [SemanticAttributes.MESSAGING_CONSUMER_ID]: packet.clientId,
        [SemanticAttributes.MESSAGING_PROTOCOL]: 'MQTT',
        [SemanticAttributes.MESSAGING_PROTOCOL_VERSION]:
          packet.protocolVersion === 3
            ? '3.1'
            : packet.protocolVersion === 4
            ? '3.1.1'
            : packet.protocolVersion === 5
            ? '5.0'
            : '3.1.1',
      }

      /**
       * ? only create a span when packet protocol version is 5 ?
       * with previous version there's no way to retreive the parent context
       * since OTEL recommands to store in payload the traceparent and tracestate and there's no payload in MQTT connect packet
       */
      const parent = getContextFromPacket(packet, {
        protocolVersion: packet.protocolVersion,
      })
      const span = instrumentation.startSpan(
        'mqtt.connect',
        {
          kind,
          attributes,
        },
        parent
      )
      const startTime = hrTime()
      const metricAttributes = getMetricAttributes(attributes)
      const ctx = parent ? trace.setSpan(parent, span) : context.active()

      function wrappedCallback(this: unknown, err?: Error) {
        if (!err) {
          client[CONNECTION_ATTRIBUTES] = attributes
          span?.setStatus({ code: 0 })
        } else {
          setSpanWithError(span, err)
        }
        instrumentation.endSpan(span, kind, startTime, metricAttributes)
        // if (parent) {
        //   return context.with(parent, done.bind(this), err)
        // }
        // const cb = context.bind(context.active(), done)
        // cb.call(this, err)
        done.call(this, err)
      }

      // return context.with(ctx, () => {
      //   context.bind(parent || context.active(), done)
      //   context.bind(context.active(), client)
      //   return original.call(this, client, packet, wrappedCallback)
      // })
      return context.with(ctx, original, this, client, packet, wrappedCallback)
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
    const instrumentation = this
    return function patchedHandlePublish(
      this: unknown,
      client: AedesClient,
      packet: AedesPublishPacket | PublishPacket,
      done: (err?: Error) => void
    ) {
      // ? maybe the span should be created before calling original's callback ?
      const startTime = hrTime()
      const { topic } = packet
      const kind = client.id ? SpanKind.CLIENT : SpanKind.SERVER
      const span = instrumentation.startSpan(`${topic} send`, {
        kind,
        attributes: {
          ...client[CONNECTION_ATTRIBUTES],
          [SemanticAttributes.MESSAGING_DESTINATION]: topic,
          [SemanticAttributes.MESSAGING_DESTINATION_KIND]:
            MessagingDestinationKindValues.TOPIC,
          [SemanticAttributes.MESSAGING_MESSAGE_ID]: packet.messageId,
        },
      })
      const parentContext = context.active()
      //? const parentContext = getContextFromPacket(packet) ?? context.active()
      const packetContext = trace.setSpan(parentContext, span)
      setContextInPacket(packet, packetContext, {
        protocolVersion: client.version,
      })

      function callbackOverride(this: unknown, err?: Error) {
        instrumentation.callPublishHook(span, { client, packet })
        // TODO: based on QoS, span should be ended in puback
        // TODO: patch handlePuback to end the span and call publishConfirmHook
        if (!err) {
          span.setStatus({ code: 0 })
        } else {
          setSpanWithError(span, err)
        }

        instrumentation.endSpan(span, kind, startTime)
        done.call(this, err)
      }

      return context.with(packetContext, () => {
        const cb = context.bind(parentContext, callbackOverride)
        return original.call(this, client, packet, cb)
      })
      // return original.call(this, client, packet, callbackOverride)
    }
  }
  // #endregion
}
