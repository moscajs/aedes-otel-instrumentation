import type { Attributes, Span } from '@opentelemetry/api'
import type { CONNECTION_ATTRIBUTES, PACKET_STORED_SPAN } from './utils'
import type { AedesPacket } from 'aedes-packet'
import type Aedes from 'aedes'
import type {
  AedesPublishPacket,
  Client,
  ConnectPacket,
  PublishPacket,
  SubscribePacket,
  UnsubscribePacket,
} from 'aedes'

/**
 * we manually add the ctx property to the packet
 * this property is used to store the context of the span
 */
export type PatchedAedesPacket = AedesPacket & {
  ctx?: {
    traceparent?: unknown
    tracestate?: unknown
  }
  [PACKET_STORED_SPAN]?: Span
}

export type PacketFactory = (
  original?: PatchedAedesPacket,
  broker?: Aedes
) => AedesPacket

export interface AedesClient extends Client {
  [CONNECTION_ATTRIBUTES]: Attributes
  broker: Aedes
}

export type HandleConnect = {
  handleConnect: (
    client: AedesClient,
    packet: ConnectPacket,
    done: (err?: Error) => void
  ) => void
}

export type HandlePublish = {
  handlePublish: (
    client: AedesClient,
    packet: AedesPublishPacket | PublishPacket,
    done: (err?: Error) => void
  ) => void
}

export type HandleSubscribe = {
  handleSubscribe: (
    client: AedesClient,
    packet: SubscribePacket,
    restore: boolean,
    done: (err?: Error) => void
  ) => void
}

export type HandleUnsubscribe = {
  handleUnsubscribe: (
    client: AedesClient,
    packet: UnsubscribePacket,
    done: (err?: Error) => void
  ) => void
}
