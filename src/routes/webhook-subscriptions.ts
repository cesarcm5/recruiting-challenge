import { Router } from 'express';
import { randomUUID, randomBytes } from 'node:crypto';
import { subscriptionsDal } from '../webhooks/subscriptions-dal.js';
import { deliveriesDal } from '../webhooks/deliveries-dal.js';
import { isEventType, type EventType } from '../webhooks/types.js';

export const webhookSubscriptionsRouter = Router();

function validateUrl(raw: string): { ok: true } | { ok: false; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }
  if (parsed.protocol === 'https:') return { ok: true };
  if (
    parsed.protocol === 'http:' &&
    (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') &&
    process.env.NODE_ENV !== 'production'
  ) {
    return { ok: true };
  }
  return { ok: false, reason: 'url_must_be_https' };
}

webhookSubscriptionsRouter.post('/', (req, res) => {
  const body = req.body as { url?: unknown; event_types?: unknown };
  if (typeof body.url !== 'string' || !Array.isArray(body.event_types) || body.event_types.length === 0) {
    res.status(400).json({ error: 'invalid_body' });
    return;
  }
  const urlCheck = validateUrl(body.url);
  if (!urlCheck.ok) {
    res.status(400).json({ error: urlCheck.reason });
    return;
  }
  const eventTypes: EventType[] = [];
  for (const t of body.event_types) {
    if (!isEventType(t)) {
      res.status(400).json({ error: 'invalid_event_type' });
      return;
    }
    if (!eventTypes.includes(t)) eventTypes.push(t);
  }

  const id = `whsub_${randomUUID()}`;
  const secret = randomBytes(32).toString('hex');
  const subscription = subscriptionsDal.create({
    id,
    merchant_id: req.merchantId!,
    url: body.url,
    secret,
    event_types: eventTypes,
  });

  res.status(201).json({ subscription, secret });
});

webhookSubscriptionsRouter.get('/', (req, res) => {
  const subscriptions = subscriptionsDal.listByMerchant(req.merchantId!);
  res.json({ subscriptions });
});

webhookSubscriptionsRouter.delete('/:id', (req, res) => {
  const removed = subscriptionsDal.deleteById(req.params.id, req.merchantId!);
  if (!removed) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.status(204).end();
});

webhookSubscriptionsRouter.get('/:id/deliveries', (req, res) => {
  const subscription = subscriptionsDal.getById(req.params.id, req.merchantId!);
  if (!subscription) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  const limitRaw = typeof req.query.limit === 'string' ? Number(req.query.limit) : 50;
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50;
  const deliveries = deliveriesDal.listBySubscription(subscription.id, limit);
  res.json({
    deliveries: deliveries.map((d) => ({
      id: d.id,
      event_type: d.event_type,
      status: d.status,
      attempts: d.attempts,
      next_attempt_at: d.next_attempt_at,
      last_error: d.last_error,
      response_status: d.response_status,
      created_at: d.created_at,
      delivered_at: d.delivered_at,
    })),
  });
});
