const {
  getNodeAutoInstrumentations,
} = require('@opentelemetry/auto-instrumentations-node')

const { Resource } = require('@opentelemetry/resources')
const { NodeSDK } = require('@opentelemetry/sdk-node')
const {
  BatchSpanProcessor,
  ConsoleSpanExporter,
} = require('@opentelemetry/sdk-trace-base')
const {
  PeriodicExportingMetricReader,
  ConsoleMetricExporter,
} = require('@opentelemetry/sdk-metrics')
const {
  SemanticResourceAttributes,
} = require('@opentelemetry/semantic-conventions')
const { getNodeMqttAutoInstrumentations } = require('../dist')

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
