import { deliveriesDal } from './deliveries-dal.js';
import { subscriptionsDal } from './subscriptions-dal.js';
import { sign } from './verify.js';
import type { WebhookDeliveryRow } from './types.js';

const MAX_ATTEMPTS = 5;
// Gaps between attempts: 1→2, 2→3, 3→4, 4→5. After attempt 5 fails the
// delivery is marked failed and not retried again.
const BACKOFF_SECONDS = [30, 120, 600, 3600];
const TIMEOUT_MS = 10_000;
const BATCH_SIZE = 25;
const TICK_INTERVAL_MS = 5_000;

export async function tick(): Promise<void> {
  const now = new Date().toISOString();
  const pending = deliveriesDal.listDuePending(now, BATCH_SIZE);
  for (const delivery of pending) {
    await dispatchOne(delivery);
  }
}

async function dispatchOne(delivery: WebhookDeliveryRow): Promise<void> {
  const sub = subscriptionsDal.getRow(delivery.subscription_id, delivery.merchant_id);
  if (!sub) {
    deliveriesDal.recordFailure(delivery.id, 'subscription_deleted', null, null);
    return;
  }

  const signature = sign(delivery.payload_json, sub.secret);
  let status: number | null = null;
  let error: string | null = null;

  try {
    const res = await fetch(sub.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-t1-signature': `sha256=${signature}`,
        'x-t1-event-type': delivery.event_type,
        'x-t1-event-id': delivery.id,
      },
      body: delivery.payload_json,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    status = res.status;
    if (status >= 200 && status < 300) {
      deliveriesDal.markDelivered(delivery.id, status, new Date().toISOString());
      return;
    }
    error = `status_${status}`;
  } catch (e) {
    error = e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 200) : 'unknown_error';
  }

  const newAttempts = delivery.attempts + 1;
  if (newAttempts >= MAX_ATTEMPTS) {
    deliveriesDal.recordFailure(delivery.id, error ?? 'unknown', status, null);
    return;
  }
  const waitSeconds = BACKOFF_SECONDS[newAttempts - 1]!;
  const nextAt = new Date(Date.now() + waitSeconds * 1000).toISOString();
  deliveriesDal.recordFailure(delivery.id, error ?? 'unknown', status, nextAt);
}

let intervalHandle: NodeJS.Timeout | null = null;

export function start(): void {
  if (intervalHandle) return;
  intervalHandle = setInterval(() => {
    tick().catch((err) => console.error('[webhooks] tick error', err));
  }, TICK_INTERVAL_MS);
  intervalHandle.unref?.();
}

export function stop(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
