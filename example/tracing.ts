import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
// import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
// import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'

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
import { getNodeMqttAutoInstrumentations } from '../src'

// Outputs to Jaeger
// const traceExporter = new OTLPTraceExporter({
//   url: 'http://localhost:4318/v1/traces',
// })
// const metricExporter = new OTLPMetricExporter({
//   url: 'http://localhost:4318/v1/metrics',
// })

// Outputs to STDOUT
const traceExporter = new ConsoleSpanExporter()
const metricExporter = new ConsoleMetricExporter()

const metricReader = new PeriodicExportingMetricReader({
  exporter: metricExporter,
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
    getNodeMqttAutoInstrumentations({
      '@opentelemetry/instrumentation-mqtt-packet': {
        enabled: true,
      },
      '@opentelemetry/instrumentation-aedes': {
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
      },
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
