import type { Attributes, Span } from '@opentelemetry/api'
import type Aedes from 'aedes'
import type {
  AedesPublishPacket,
  Client,
  ConnectPacket,
  PublishPacket,
  SubscribePacket,
  UnsubscribePacket,
} from 'aedes'
import type { AedesPacket } from 'aedes-packet'
import type { CONNECTION_ATTRIBUTES } from './constants'

export interface InstrumentationSpan extends Span {
  name?: string
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
