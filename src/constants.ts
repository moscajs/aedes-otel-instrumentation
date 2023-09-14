import { createContextKey } from '@opentelemetry/api'

// export const CLIENT_CONTEXT_KEY: unique symbol = Symbol(
//   'opentelemetry.aedes.client'
// )
export const CLIENT_CONTEXT_KEY = createContextKey('opentelemetry.aedes.client')

export const CLIENT_SPANS_NOT_ENDED: unique symbol = Symbol(
  'opentelemetry.aedes.client.spans-not-ended'
)

export const CONNECTION_ATTRIBUTES: unique symbol = Symbol(
  'opentelemetry.aedes.connection.attributes'
)

const namespace = 'messaging.aedes'
const client = `${namespace}.client`
const broker = `${namespace}.broker`

export const AedesAttributes = {
  MESSAGING_SYSTEM: 'aedes',
  MESSAGING_PROTOCOL: 'mqtt',
  CLIENT_ID: `${client}.id`,
  CLIENT_TRANSPORT: `${client}.transport`,
  BROKER_ID: `${broker}.id`,
  BROKER_PROXY: `${broker}.proxy`,
}
