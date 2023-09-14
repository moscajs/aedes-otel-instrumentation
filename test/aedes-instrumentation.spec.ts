import { context, propagation } from '@opentelemetry/api'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import type Aedes from 'aedes'
import type * as MqttClient from 'mqtt'
import assert from 'node:assert'
import { createServer } from 'node:net'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { AedesInstrumentation, MqttPacketInstrumentation } from '../src'

// polyfill for JS new feature
Object.defineProperty(Symbol, 'dispose', {
  configurable: true,
  value: Symbol('Symbol.dispose'),
})
Object.defineProperty(Symbol, 'asyncDispose', {
  configurable: true,
  value: Symbol('Symbol.asyncDispose'),
})

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
  const provider = new NodeTracerProvider()
  const memoryExporter = new InMemorySpanExporter()
  const spanProcessor = new SimpleSpanProcessor(memoryExporter)
  provider.addSpanProcessor(spanProcessor)
  const contextManager = new AsyncHooksContextManager()

  beforeEach(() => {
    contextManager.enable()
    context.setGlobalContextManager(contextManager)
    instrumentation.setTracerProvider(provider)
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
    memoryExporter.reset()
    instrumentation.disable()
    mqttPacketInstrumentation.disable()
  })

  it('should not generate any spans when disabled', async () => {
    instrumentation.disable()
    mqttPacketInstrumentation.disable()
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    await using brokerWrapper = await getBroker()
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    await using clientWrapper = await getMqttClient(true)

    const spans = memoryExporter.getFinishedSpans()
    assert.strictEqual(spans.length, 0)
  })
})
