# Written answers — César Contreras

> ~200 words per question. Past-tense, real systems. See `SUBMISSION.md`.

## Q1 — Production correctness validation

> Describe a system you owned where you had to add production correctness validation — alarms, contract tests, golden datasets, something that caught a class of bugs before users did. What did you do, what worked, what didn't, and what would you do differently?

When I integrated Paddle as Merchant of Record, I identified three classes of bugs a 'naive' webhook would have: forged webhooks from an attacker, captured-and-replayed webhooks, and duplicate deliveries of thesame event (Paddle uses at-least-once delivery). Without protection, an attacker could give themselves a free upgrade, or a single payment would trigger a double plan change. I built three layers in the paddle-webhook edge function: 

First, HMAC-SHA256 verification over {timestamp}:{body} with a shared secret. If the signature doesn't match, 401. I used crypto.subtle.verify which internally is constant-time — prevents timing attacks.

Second, anti-replay rejecting webhooks with timestamp older than 5 minutes. This covers the case where an attacker captured a legitimate webhook and tries to resend it.

Third, explicit idempotency via a processed_webhooks table with event_id as PRIMARY KEY. The first INSERT succeeds; the second fails with unique violation; I return 200 so Paddle stops retrying. Result: one single write to subscriptions per event, no matter how many times it arrives.

What worked: zero reported subscription-state bugs in production since this shipped. Logs show Paddle retries being deduplicated correctly.
What didn't work — or rather, what's missing: I don't have a reconciliation cron against the Paddle API. If for some reason my subscriptions table drifted from Paddle's source of truth (a webhook permanently lost,  no longer retried), I wouldn't know until a user reports it. 
I also never configured CloudWatch alarms to detect a spike in failed webhooks.
What I'd do differently: (1) a reconciliation cron that hourly compares my subscriptions against GET /subscriptions from Paddle for active clinics. (2) An alarm on error rate > 1% in the edge function — if webhooks  start failing, I see it in email. (3) A golden dataset of archived Paddle payloads for regression tests when I refactor — today if I break the parser, I don't find out until the first real webhook arrives.

## Q2 — Scaling-forced structural change

> Describe a system you've worked on where scaling — traffic, data volume, team size, or geography — forced a structural change to the code or architecture. What changed, who pushed back, and how did you decide?

I'm sorry, I don't have a solid experiencie working on scaling systems, a similar experince where it shares this scaling it's the Vertical SaaS I've built for dental clinics managment but I've already wrote about this project so other similar experience was a multi-agent system for a scuba dive shop in Cozumel where i decided to set fallbacks errors in the instance of the chatbot and set monitor of chatbots in alerts way, when every time the chatbot failed i received an alert

## Q3 — Cross-team contract change

> Describe a time you needed another team to change their API, contract, or shared resource for your work to ship. How did you propose it, how did the other side respond, and how did the change actually land?
I can't remember a time when they need to change those details for I can ship my work.

