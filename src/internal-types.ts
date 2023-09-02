import type { Attributes } from '@opentelemetry/api'
import type {
  CONNECTION_ATTRIBUTES,
  PACKET_STORED_CONTEXT,
  PACKET_STORED_SPAN,
} from './utils'
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

declare module 'mqtt-packet' {
  interface IPublishPacket {
    [PACKET_STORED_CONTEXT]?: {
      traceparent?: unknown
      tracestate?: unknown
    }
    [PACKET_STORED_SPAN]?: import('@opentelemetry/api').Span
  }
}

declare module 'aedes-packet' {
  interface IPacket {
    [PACKET_STORED_CONTEXT]?: {
      traceparent?: unknown
      tracestate?: unknown
    }
    [PACKET_STORED_SPAN]?: import('@opentelemetry/api').Span
  }
}

export type PacketFactory = (
  original?: AedesPacket,
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
