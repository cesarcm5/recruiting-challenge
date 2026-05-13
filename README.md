# T1 Engineering Recruiting Challenge

Welcome. This is a small merchant-dashboard application with some problems. Your job is to find what's wrong, fix it, and add one feature — then tell us how you thought about it.

We care less about *whether* you finish than *how* you decide what to do. Read [`EVALUATION.md`](./EVALUATION.md) before you start.

---

## What you'll do

1. **Fork** this repo to your own GitHub account. Make your fork public.
2. **Set up the app locally** (instructions below). Run it. Click around the dashboard.
3. **Identify and address at least 3 quality issues.** Treat this codebase the way you'd treat a real production system that just landed on your desk: things that work but shouldn't, things that are missing, things whose shape could be better, things that won't scale, things that aren't safe. Some are easy to spot, some take more reading. We don't tell you in advance which ones — surfacing them is part of the exercise. **The entire codebase, docs, and API surface are fair game.** You decide what's worth improving and why.
4. **Pick one feature from the menu below and add it.** You choose. Tell us why you chose it.
5. **Improve the documentation** as you go. The `docs/` directory is out of date and incomplete; treat it as part of the codebase.
6. **Submit** the four artifacts described in [`SUBMISSION.md`](./SUBMISSION.md).

**Expected time: ~6 hours.** If you spend a lot more or a lot less, write down why in your decision log — we'll read it.

---

## Setup

Requirements: **Node 20+**.

```sh
npm install
npm run dev
```

The app starts at <http://localhost:3000>. The dashboard is at `/`, the API at `/api/*`.

If port 3000 is taken: `PORT=3055 npm run dev`.

**Windows note.** `better-sqlite3` builds a native module on install; if it fails, you'll need Visual Studio build tools or `windows-build-tools`. Modern Node distributions usually ship with what you need. macOS and Linux: no extra setup.

The database is SQLite, kept in `data/dashboard.db`. The first run seeds two merchants (`m_acme`, `m_bistro`) and ~80 orders. Delete the file to reseed.

```sh
npm test     # run the (intentionally thin) test suite
```

The dashboard authenticates with JWT bearer tokens. Open <http://localhost:3000/login.html>
(or hit `/` and you'll be redirected) and sign in with one of the seeded merchants:

- `m_acme` / `acme-dev-password`
- `m_bistro` / `bistro-dev-password`

The client stores the token in `localStorage` and sends `Authorization: Bearer <token>`
on every API request — see `src/auth.ts` and `src/routes/auth.ts`. Set `JWT_SECRET` in
the environment to keep tokens stable across restarts (the server generates an ephemeral
random secret and warns on the console if it's missing).

---

## Feature menu — pick one

Pick exactly one. Implement it, integrate it into the dashboard if it has a UI surface, and explain your choice in your decision log.

### Feature A — CSV export of orders

Add an endpoint and a "Download CSV" button that exports the merchant's orders for a given date range as CSV. The candidate decides the column shape, the auth model, the format conventions (dates, currency, escaping), and how to handle large result sets.

### Feature B — Order-event webhooks

Add a way for merchants to register an HTTPS URL and receive a POST notification when an order is created, refunded, or its status changes. The candidate decides the event payload, the delivery guarantees, the retry policy, the auth between us and the merchant, and how a merchant manages their subscriptions.

### Feature C — Order search with filters

Add a search endpoint (and dashboard UI) that lets the merchant find orders by customer email, status, type (sale / refund), date range, and amount range. The candidate decides pagination, sort order, performance under larger datasets, and how the query shape is exposed in the API.

You can sketch a fourth option if none of these fit your strengths — just be very explicit in the decision log about what you built and why.

---

## What you submit

See [`SUBMISSION.md`](./SUBMISSION.md). In short, four files:

1. **A link to your fork** with your work merged or in a clear branch.
2. **`decision_log.md`** — one page on what you chose to do and why.
3. **`prompt_history.md`** — raw history of your prompts to whatever AI tool(s) you used.
4. **`written_answers.md`** — three short past-tense behavioral questions (templates included).

Email your submission to the recruiter you've been talking to. They'll get back to you within a week.

---

## A note on AI

You should use AI. Claude Code, Cursor, Copilot, Aider, ChatGPT — whatever you actually work with. We are not testing whether you can write code without help. We are testing how you direct, review, and decide. That's what we look at in your prompt history and your decision log.

You do not need to "perform AI use" — if you only used it for one thing, write that one thing. If you used it for everything, write what you accepted, what you rejected, and what you had to re-prompt to fix.

---

## Questions?

Don't ask us. Make a decision, document it, and move on. We'd rather see you call your shot in writing than see you blocked on clarification. If your call turns out to be wrong, your decision log is where you tell us what you'd do differently.

---

## Found this repo without a recruiter contact?

If you reached this repo organically and want to use it as an entry point into T1 engineering, send your submission and a short note about how you found us to **<recruiting@t1.com>** (or the address listed on the T1 careers page). We do hire from cold submissions.

