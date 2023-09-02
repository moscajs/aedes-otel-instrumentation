import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { Resource } from '@opentelemetry/resources'
import { NodeSDK } from '@opentelemetry/sdk-node'
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
} from '@opentelemetry/sdk-trace-base'
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions'
import { AedesInstrumentation } from '../src/instrumentation'

const traceExporter = new ConsoleSpanExporter()

const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: 'test service',
    [SemanticResourceAttributes.SERVICE_VERSION]:
      process.env.npm_package_version,
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV,
  }),
  traceExporter,
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': {
        enabled: false,
      },
    }),
    new AedesInstrumentation({
      enabled: true,
      publishHook: (span, info) => {
        console.log('publishHook', info.packet)
      },
      consumeHook: (span, info) => {
        console.log('consumeHook', info.packet)
      },
      consumeEndHook: (span, info) => {
        console.log('consumeEndHook', info.packet)
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
