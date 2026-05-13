export type EventType = 'order.created' | 'order.refunded';

export const ALL_EVENT_TYPES: readonly EventType[] = ['order.created', 'order.refunded'];

export const API_VERSION = '2026-05-12';

export function isEventType(value: unknown): value is EventType {
  return typeof value === 'string' && (ALL_EVENT_TYPES as readonly string[]).includes(value);
}

export interface WebhookSubscriptionRow {
  id: string;
  merchant_id: string;
  url: string;
  secret: string;
  event_types: string;
  enabled: number;
  created_at: string;
}

export interface WebhookSubscription {
  id: string;
  merchant_id: string;
  url: string;
  event_types: EventType[];
  enabled: boolean;
  created_at: string;
}

export interface WebhookDeliveryRow {
  id: string;
  subscription_id: string;
  merchant_id: string;
  event_type: string;
  payload_json: string;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  response_status: number | null;
  created_at: string;
  delivered_at: string | null;
}

export interface EventEnvelope {
  id: string;
  type: EventType;
  created_at: string;
  api_version: string;
  data: Record<string, unknown>;
}

export function rowToSubscription(row: WebhookSubscriptionRow): WebhookSubscription {
  return {
    id: row.id,
    merchant_id: row.merchant_id,
    url: row.url,
    event_types: JSON.parse(row.event_types) as EventType[],
    enabled: row.enabled === 1,
    created_at: row.created_at,
  };
}
