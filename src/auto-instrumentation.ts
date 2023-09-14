import { Instrumentation } from '@opentelemetry/instrumentation'
import { AedesInstrumentation } from './aedes-instrumentation'
import { MqttPacketInstrumentation } from './mqtt-packet.instrumentation'
import { diag } from '@opentelemetry/api'

const InstrumentationMap = {
  '@opentelemetry/instrumentation-mqtt-packet': MqttPacketInstrumentation,
  '@opentelemetry/instrumentation-aedes': AedesInstrumentation,
}

// Config types inferred automatically from the first argument of the constructor
type ConfigArg<T> = T extends new (...args: infer U) => unknown ? U[0] : never
export type InstrumentationConfigMap = {
  [Name in keyof typeof InstrumentationMap]?: ConfigArg<
    (typeof InstrumentationMap)[Name]
  >
}

/**
 *
 * @description this helper function is similar to getNodeAutoInstrumentations() in '@opentelemetry/auto-instrumentations-node'
 * it might become obsolete if the mqtt-packet instrumentation is moved to its own package
 */
export function getNodeMqttAutoInstrumentations(
  inputConfigs: InstrumentationConfigMap = {}
): Instrumentation[] {
  for (const name of Object.keys(inputConfigs)) {
    if (!Object.prototype.hasOwnProperty.call(InstrumentationMap, name)) {
      diag.error(`Provided instrumentation name "${name}" not found`)
      continue
    }
  }

  const instrumentations: Instrumentation[] = []

  for (const name of Object.keys(InstrumentationMap) as Array<
    keyof typeof InstrumentationMap
  >) {
    const Instance = InstrumentationMap[name]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userConfig: any = inputConfigs[name] ?? {}

    if (userConfig.enabled === false) {
      diag.debug(`Disabling instrumentation for ${name}`)
      continue
    }

    try {
      diag.debug(`Loading instrumentation for ${name}`)
      instrumentations.push(new Instance(userConfig))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      diag.error(e)
    }
  }

  return instrumentations
}
