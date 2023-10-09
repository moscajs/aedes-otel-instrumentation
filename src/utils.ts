import {
  SpanStatusCode,
  type Span,
  Attributes,
  propagation,
  ROOT_CONTEXT,
  context,
  Context,
} from '@opentelemetry/api'
import { SemanticAttributes } from '@opentelemetry/semantic-conventions'
import type { Connection } from 'aedes'
import type { ConnectionDetails } from 'aedes-protocol-decoder'
import type { Packet } from 'mqtt-packet'
import { IncomingMessage } from 'node:http'
import type { AddressInfo, Socket as NetSocket } from 'node:net'
import path from 'node:path'

const packageJsonUrl = path.resolve(`${module.path}/../package.json`)
// eslint-disable-next-line @typescript-eslint/no-var-requires
export const { version: VERSION } = require(packageJsonUrl)

export const setSpanWithError = (span: Span, error: Error): void => {
  const message = error.message
  span?.setAttributes({
    // [AttributeNames.HTTP_ERROR_NAME]: error.name,
    // [AttributeNames.HTTP_ERROR_MESSAGE]: message,
  })
  span?.setStatus({ code: SpanStatusCode.ERROR, message })
  span?.recordException(error)
}

export const getMetricAttributes = (spanAttributes: Attributes): Attributes => {
  const metricAttributes: Attributes = {}
  metricAttributes[SemanticAttributes.MESSAGE_ID] =
    spanAttributes[SemanticAttributes.MESSAGE_ID]
  metricAttributes[SemanticAttributes.NET_HOST_PORT] =
    spanAttributes[SemanticAttributes.NET_HOST_PORT]
  if (spanAttributes[SemanticAttributes.MESSAGING_DESTINATION] !== undefined) {
    metricAttributes[SemanticAttributes.MESSAGING_DESTINATION] =
      spanAttributes[SemanticAttributes.MESSAGING_DESTINATION]
  }
  return metricAttributes
}

export function isNetSocket(x: unknown): x is NetSocket {
  return (
    typeof x === 'object' &&
    !!x &&
    'remoteAddress' in x &&
    typeof x.remoteAddress === 'string' &&
    'remotePort' in x &&
    typeof x.remotePort === 'number' &&
    'address' in x &&
    typeof x.address === 'function'
  )
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

function getPacketProtocolVersion(packet: Packet): number {
  if ('protocolVersion' in packet) {
    return packet.protocolVersion ?? 4
  }
  return 4
}

/**
 * @see https://w3c.github.io/trace-context-mqtt/#trace-context-fields-placement-in-a-message
 */

export function getContextFromPacket(
  packet: Packet,
  ctx = ROOT_CONTEXT,
  options: {
    protocolVersion?: number
  } = {}
): Context | undefined {
  const protocolVersion =
    options?.protocolVersion ?? getPacketProtocolVersion(packet)

  if (
    protocolVersion === 5 &&
    'properties' in packet &&
    packet.properties &&
    'userProperties' in packet.properties
  ) {
    return propagation.extract(ctx, packet.properties.userProperties)
  } else if ('payload' in packet) {
    // TODO: improve context extraction from payload
    try {
      const payload = JSON.parse(packet.payload.toString())
      return propagation.extract(ctx, payload)
    } catch (e) {
      // TODO: consider https://w3c.github.io/trace-context-binary/#de-serialization-algorithms if not JSON
      return undefined
    }
  }
  return undefined
}

/**
 * @see https://w3c.github.io/trace-context-mqtt/#trace-context-fields-placement-in-a-message
 */

export function setContextInPacket(
  packet: Packet,
  ctx = context.active(),
  options: {
    protocolVersion?: number
  } = {}
): void {
  const protocolVersion =
    options?.protocolVersion ?? getPacketProtocolVersion(packet)
  if (
    protocolVersion === 5 &&
    'properties' in packet &&
    packet.properties &&
    'userProperties' in packet.properties
  ) {
    propagation.inject(ctx, packet.properties.userProperties)
  } else if ('payload' in packet) {
    try {
      const payload = JSON.parse(packet.payload.toString())
      propagation.inject(ctx, payload)
      // TODO: ensure to not mutate original packet.payload
      packet.payload = JSON.stringify(payload)
    } catch (e) {
      // TODO: consider https://w3c.github.io/trace-context-binary/#serialization-of-traceparent if not JSON
      // ignore
    }
  }
}

export function getClientTransport(
  request?: IncomingMessage & { connDetails?: ConnectionDetails }
) {
  if (!request?.connDetails) {
    return !request ? 'mqtt' : 'ws'
  }
  const { isTls, isWebsocket } = request.connDetails
  if (isTls) {
    return isWebsocket ? 'wss' : 'mqtts'
  }
  return isWebsocket ? 'ws' : 'mqtt'
}

// TODO: refine to include full URL (pathname)
export function getBrokerUrl(
  stream: Connection,
  request?: IncomingMessage & { connDetails?: ConnectionDetails }
): string {
  const protocol = getClientTransport(request)
  if (!request?.connDetails) {
    let address = {}
    if (isNetSocket(stream) && isNetSocketAddress(stream.address())) {
      address = stream.address()
    } else if (
      typeof request?.socket?.address === 'function' &&
      isNetSocketAddress(request.socket.address())
    ) {
      address = request.socket.address()
    }

    return isNetSocketAddress(address)
      ? `${protocol}://${address.address}:${address.port}`
      : `${protocol}://localhost:1883`
  }
  const { isTls, isWebsocket, serverIpAddress, serverPort } =
    request.connDetails
  if (isTls) {
    return isWebsocket
      ? `${protocol}://${serverIpAddress}:${serverPort}`
      : `${protocol}://${serverIpAddress}:${serverPort}`
  }
  return isWebsocket
    ? `${protocol}://${serverIpAddress}:${serverPort}`
    : `${protocol}://${serverIpAddress}:${serverPort}`
}
