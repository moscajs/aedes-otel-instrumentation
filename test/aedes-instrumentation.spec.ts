import { context, propagation } from '@opentelemetry/api'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import {
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics'
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { SemanticAttributes } from '@opentelemetry/semantic-conventions'
import type Aedes from 'aedes'
import type { AedesPublishPacket } from 'aedes'
import type * as MqttClient from 'mqtt'
import type { IPublishPacket } from 'mqtt-packet'
import * as semver from 'semver'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { afterEach, beforeEach, describe, it } from 'node:test'

import {
  AedesAttributes,
  AedesInstrumentation,
  CONNECTION_ATTRIBUTES,
  MqttPacketInstrumentation,
} from '../src'
import { AedesClient } from '../src/internal-types'
import { NO_RESOLVE, waitForEvent } from './helpers'

// polyfill for JS new feature
if (semver.lt(process.versions.node, '20.0.0')) {
  Object.defineProperty(Symbol, 'dispose', {
    configurable: true,
    value: Symbol('Symbol.dispose'),
  })
  Object.defineProperty(Symbol, 'asyncDispose', {
    configurable: true,
    value: Symbol('Symbol.asyncDispose'),
  })
}

let Client: typeof MqttClient
let Broker: typeof Aedes

const getBroker = async () => {
  const broker = new Broker()
  const tcpServer = createServer(broker.handle.bind(broker))

  await new Promise((resolve) => {
    broker.once('closed', () => {
      tcpServer.close()
    })
    tcpServer.listen(1883, () => {
      return resolve(broker)
    })
  })

  return {
    broker,
    tcpServer,
    [Symbol.asyncDispose]: async () => {
      await new Promise((resolve) => {
        broker.close(() => {
          tcpServer.close(() => {
            resolve(null)
          })
        })
      })
    },
  }
}

const getMqttClient = async (wait?: boolean) => {
  const client = wait
    ? await Client.connectAsync('mqtt://localhost:1883')
    : Client.connect('mqtt://localhost:1883')
  return {
    client,
    [Symbol.asyncDispose]: async () => {
      await client.endAsync()
    },
  }
}

describe('Aedes', () => {
  const mqttPacketInstrumentation = new MqttPacketInstrumentation()
  const instrumentation = new AedesInstrumentation()
  const tracerProvider = new NodeTracerProvider()
  const memorySpanExporter = new InMemorySpanExporter()
  const spanProcessor = new SimpleSpanProcessor(memorySpanExporter)
  tracerProvider.addSpanProcessor(spanProcessor)
  const memoryMetricExporter = new InMemoryMetricExporter(0)
  const metricProvider = new MeterProvider()
  metricProvider.addMetricReader(
    new PeriodicExportingMetricReader({
      exporter: memoryMetricExporter,
    })
  )
  const contextManager = new AsyncHooksContextManager()

  beforeEach(() => {
    contextManager.enable()
    context.setGlobalContextManager(contextManager)
    instrumentation.setTracerProvider(tracerProvider)
    instrumentation.setMeterProvider(metricProvider)
    instrumentation.enable()
    mqttPacketInstrumentation.enable()
    propagation.setGlobalPropagator(new W3CTraceContextPropagator())
    /* eslint-disable @typescript-eslint/no-var-requires */
    Client = require('mqtt')
    Broker = require('aedes')
    /* eslint-enable @typescript-eslint/no-var-requires */
  })

  afterEach(() => {
    contextManager.disable()
    contextManager.enable()
    memorySpanExporter.reset()
    memoryMetricExporter.reset()
    mqttPacketInstrumentation.disable()
    instrumentation.disable()
  })

  it('should not generate any spans when disabled', async () => {
    mqttPacketInstrumentation.disable()
    instrumentation.disable()
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    await using brokerWrapper = await getBroker()
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    await using clientWrapper = await getMqttClient(true)

    const spans = memorySpanExporter.getFinishedSpans()
    assert.strictEqual(spans.length, 0)
  })

  it('should create a span when a client is connected', async () => {
    await using brokerWrapper = await getBroker()
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    await using clientWrapper = await getMqttClient()
    const client = await waitForEvent(
      brokerWrapper.broker,
      'clientReady',
      (client: AedesClient) => client
    )

    const span = memorySpanExporter
      .getFinishedSpans()
      .find((span) => span.name.includes('mqtt.connect'))

    assert.notStrictEqual(span, undefined)
    assert.strictEqual(
      client[CONNECTION_ATTRIBUTES][AedesAttributes.CLIENT_ID],
      client.id
    )
    assert.strictEqual(
      client[CONNECTION_ATTRIBUTES][SemanticAttributes.MESSAGING_SYSTEM],
      AedesAttributes.MESSAGING_SYSTEM
    )
    assert.strictEqual(
      client[CONNECTION_ATTRIBUTES][SemanticAttributes.MESSAGING_PROTOCOL],
      AedesAttributes.MESSAGING_PROTOCOL
    )
    assert.notStrictEqual(
      span?.events.find((event) => event.name === 'preConnect'),
      undefined
    )
    assert.notStrictEqual(
      span?.events.find((event) => event.name === 'authenticate'),
      undefined
    )
    assert.strictEqual(span?.attributes[AedesAttributes.CLIENT_ID], client.id)
  })

  it('should create a span when a client is publishing a message (JSON payload)', async () => {
    await using brokerWrapper = await getBroker()
    await using clientWrapper = await getMqttClient(true)
    const topic = 'test'
    await clientWrapper.client.publishAsync(
      topic,
      JSON.stringify({ message: 'test' })
    )
    await waitForEvent(
      brokerWrapper.broker,
      'publish',
      (packet: AedesPublishPacket) => {
        if (packet.topic.startsWith('$SYS')) {
          return NO_RESOLVE
        }
        return packet
      }
    )

    const span = memorySpanExporter
      .getFinishedSpans()
      .find((span) => span.name.includes(`${topic} publish`))
    assert.notStrictEqual(span, undefined)
    assert.notStrictEqual(
      span?.events.find((event) => event.name === 'authorizePublish'),
      undefined
    )
  })

  it('should propagate from the publisher to the subscriber (JSON payload)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    await using brokerWrapper = await getBroker()
    await using clientWrapper1 = await getMqttClient(true)
    await using clientWrapper2 = await getMqttClient(true)
    const publisher = clientWrapper1.client
    const subscriber = clientWrapper2.client
    const topic = 'test'
    await subscriber.subscribeAsync(topic)
    await publisher.publishAsync(topic, JSON.stringify({ message: 'test' }))
    await waitForEvent(
      subscriber,
      'message',
      (topic, message, packet: IPublishPacket) => {
        return packet
      }
    )

    const subscriberSpan = memorySpanExporter
      .getFinishedSpans()
      .find((span) => span.name.includes(`${topic} receive`))
    const publisherSpan = memorySpanExporter
      .getFinishedSpans()
      .find((span) => span.name.includes(`${topic} publish`))

    assert.notStrictEqual(subscriberSpan, undefined)
    assert.notStrictEqual(publisherSpan, undefined)
    assert.strictEqual(
      publisherSpan?.spanContext().spanId,
      subscriberSpan?.parentSpanId
    )
  })

  it.todo('should capture connection events')
  it.todo('should capture connection errors')
})
