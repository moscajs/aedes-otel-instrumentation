import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { Resource } from '@opentelemetry/resources'
import { NodeSDK } from '@opentelemetry/sdk-node'
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
} from '@opentelemetry/sdk-trace-base'
import {
  PeriodicExportingMetricReader,
  ConsoleMetricExporter,
} from '@opentelemetry/sdk-metrics'
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions'
import { AedesInstrumentation } from '../src/instrumentation'
import { MqttPacketInstrumentation } from '../src'

const traceExporter = new ConsoleSpanExporter()
const metricReader = new PeriodicExportingMetricReader({
  exporter: new ConsoleMetricExporter(),
})

const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: 'test service',
    [SemanticResourceAttributes.SERVICE_VERSION]:
      process.env.npm_package_version,
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV,
  }),
  traceExporter,
  metricReader,
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': {
        enabled: false,
      },
    }),
    new MqttPacketInstrumentation(),
    new AedesInstrumentation({
      enabled: true,
      // publishHook: (span, info) => {
      //   console.log('publishHook', span)
      // },
      // consumeHook: (span, info) => {
      //   console.log('consumeHook', span)
      // },
      // consumeEndHook: (span, info) => {
      //   console.log('consumeEndHook', span)
      // },
    }),
  ],
  spanProcessor: new BatchSpanProcessor(traceExporter),
})

sdk.start()

process.on('SIGTERM', () => {
  sdk
    .shutdown()
    .catch((error) => console.error('Error terminating tracing', error))
})
