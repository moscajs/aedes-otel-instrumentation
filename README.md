# OpenTelemetry Aedes Instrumentation

<!-- TODO: add CI and NPM badges -->

⚠️ Experimental ⚠️

This library provides automatic tracing instrumentation for [Aedes][aedes-git-url] and [mqtt-packet][mqtt-packet-git-url].
It follows [OTel guidelines](https://github.com/open-telemetry/opentelemetry-js-contrib/blob/main/GUIDELINES.md).

Compatible with OpenTelemetry JS API and SDK `1.0+`.

## Installation

```bash
npm install --save aedes-otel-instrumentation
```

### Supported Versions

- Aedes:

  - no support for Aedes 0.x yet as it requires some changes in the library, see [issue](https://github.com/moscajs/aedes/issues/888)

- MQTT-packet
  - [>=8.0.0]
  - it might work with older versions but it was not tested

## Usage

OpenTelemetry Aedes Instrumentation allows the user to automatically collect trace data from Aedes.
It can also collect distributed traces from MQTT clients that use [mqtt-packet][mqtt-packet-git-url] library and the [MqttPacketInstrumentation](./src/mqtt-packet.instrumentation.ts). Other MQTT client libraries can be supported by adding the OpenTelemetry context to the MQTT packet, as described [here][otel-ctx-mqtt-packet].

To load the instrumentation, specify it in the `instrumentations` options of the OTel NodeSDK.

```ts
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { Resource } from '@opentelemetry/resources'
import {
  PeriodicExportingMetricReader,
  ConsoleMetricExporter,
} from '@opentelemetry/sdk-metrics'
import { NodeSDK } from '@opentelemetry/sdk-node'
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
} from '@opentelemetry/sdk-trace-base'
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions'
import { getNodeMqttAutoInstrumentations } from 'aedes-otel-instrumentation'

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
        publishHook: (span, info) => {
          console.log('publishHook', span)
        },
        consumeHook: (span, info) => {
          console.log('consumeHook', span)
        },
        consumeEndHook: (span, info) => {
          console.log('consumeEndHook', span)
        },
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
```

Check the [example](./example) folder for more details.

## Open Telemetry Specifications

- [Messaging semantic conventions](https://opentelemetry.io/docs/specs/otel/trace/semantic_conventions/messaging/)
- [Context in MQTT packet][otel-ctx-mqtt-packet]

## Spans

| Name              | Aedes method                           | Description                  |
| ----------------- | -------------------------------------- | ---------------------------- |
| `mqtt.connect`    | `handleConnect`                        | A client is connected        |
| `{topic} publish` | `handlePublish`                        | A client published a message |
| `{topic} receive` | `handleSubscribe` & `Aedes.subscribe`` | A client received a message  |

## TODO

- Create span during subscription to track the subscription processing
- Make span ending more accurate based on packet QoS
- Support context in non JSON packet payload (e.g. [binary][otel-ctx-binary])
- When reaching stable state consider adding this project to [OpenTelemetry ecosystem](https://github.com/open-telemetry/oteps/blob/main/text/0155-external-modules.md#contrib-components).

## License

MIT - See [LICENSE][license-url] for more information.

[license-url]: https://opensource.org/licenses/MIT
[aedes-git-url]: https://github.com/moscajs/aedes
[mqtt-packet-git-url]: https://github.com/mqttjs/mqtt-packet
[otel-ctx-mqtt-packet]: https://w3c.github.io/trace-context-mqtt/#trace-context-fields-placement-in-a-message
[otel-ctx-binary]: https://w3c.github.io/trace-context-binary/#serialization-of-traceparent
