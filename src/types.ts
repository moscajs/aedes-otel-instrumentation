import type { Span } from '@opentelemetry/api'
import type { InstrumentationConfig } from '@opentelemetry/instrumentation'
import type { Client, PublishPacket } from 'aedes'

export interface PublishInfo {
  client: Client
  packet: PublishPacket
}

export interface PublishConfirmedInfo extends PublishInfo {
  confirmError?: unknown
}

export interface ConsumeInfo {
  packet: PublishPacket
}

export interface ConsumeEndInfo {
  packet: PublishPacket
  rejected: boolean | null
}

export interface AedesPublishCustomAttributeFunction {
  (span: Span, publishInfo: PublishInfo): void
}

export interface AedesPublishConfirmCustomAttributeFunction {
  (span: Span, publishConfirmedInto: PublishConfirmedInfo): void
}

export interface AedesConsumeCustomAttributeFunction {
  (span: Span, consumeInfo: ConsumeInfo): void
}

export interface AedesConsumeEndCustomAttributeFunction {
  (span: Span, consumeEndInfo: ConsumeEndInfo): void
}

export interface AedesInstrumentationConfig extends InstrumentationConfig {
  /** hook for adding custom attributes before publish message is sent */
  publishHook?: AedesPublishCustomAttributeFunction

  /** hook for adding custom attributes after publish message is confirmed by the broker */
  publishConfirmHook?: AedesPublishConfirmCustomAttributeFunction

  /** hook for adding custom attributes before consumer message is processed */
  consumeHook?: AedesConsumeCustomAttributeFunction

  /** hook for adding custom attributes after consumer message is acked to server */
  consumeEndHook?: AedesConsumeEndCustomAttributeFunction
}
