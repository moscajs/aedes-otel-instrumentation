import { AddressInfo, Socket as NetSocket } from 'node:net'

export const PACKET_STORED_SPAN: unique symbol = Symbol(
  'opentelemetry.aedes.packet.stored-span'
)

export const CLIENT_SPANS_NOT_ENDED: unique symbol = Symbol(
  'opentelemetry.aedes.client.spans-not-ended'
)

export const CONNECTION_ATTRIBUTES: unique symbol = Symbol(
  'opentelemetry.aedes.connection.attributes'
)

export function isNetSocket(x: unknown): x is NetSocket {
  return x instanceof NetSocket
}

export function isNetSocketAddress(x: unknown): x is AddressInfo {
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as AddressInfo).port === 'number' &&
    typeof (x as AddressInfo).address === 'string' &&
    typeof (x as AddressInfo).family === 'string'
  )
}
