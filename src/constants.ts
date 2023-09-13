const namespace = 'messaging.aedes'
const client = `${namespace}.client`
const broker = `${namespace}.broker`

export const AedesAttributes = {
  MESSAGING_SYSTEM: 'aedes',
  MESSAGING_PROTOCOL: 'mqtt',
  CLIENT_ID: `${client}.id`,
  BROKER_ID: `${broker}.id`,
}
