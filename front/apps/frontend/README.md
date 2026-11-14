# Claimly — Frontend

Next.js 15 (App Router) + TypeScript + Tailwind 4. Port **3000**. Contract **2.0.0** (`../../contracts/backend.openapi.json`).

The app opens straight to **Home** — no registration, login, password or email. On first load the API client
calls `POST /api/v1/demo/sessions` (no body, no credentials), stores `session_token` + `expires_at` in
`localStorage`, and sends `X-Demo-Session` with every data request. A refresh reuses the stored token.

## Run

```bash
cp .env.example .env.local      # mock mode by default
npm ci
npm run dev                     # http://localhost:3000
```

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on :3000 |
| `npm run build` / `npm start` | Production build / serve on :3000 |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest: API adapter + stateful mock + UI logic (31 tests) |
| `npm run test:e2e` | Playwright on a production build in mock mode (9 flows; run `npm run build` first, then `npx playwright install chromium` once) |
| `npm run gen:api` | Regenerate `src/api/schema.gen.ts` from `contracts/backend.openapi.json` |

## Environment

```
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000   # Backend, WITHOUT /api/v1 (a trailing /api/v1 is stripped anyway)
NEXT_PUBLIC_API_MODE=mock                        # mock | http
```

That's all the frontend needs. No Supabase keys, no service role, no LLM token, no scheduler secret.
`NEXT_PUBLIC_*` values are **inlined at build time** — rebuild after changing them.

**Switching to the real Backend:** set `NEXT_PUBLIC_API_MODE=http` and the Backend URL, rebuild. No page code changes.
The URL must be reachable from the user's browser (on another machine use its network address; in Docker, not the internal service name).
Backend CORS must allow the frontend origin and the `X-Demo-Session` and `Idempotency-Key` headers.

## Docker

```bash
docker build -t claimly-frontend \
  --build-arg NEXT_PUBLIC_API_MODE=http \
  --build-arg NEXT_PUBLIC_API_BASE_URL=http://localhost:8000 .
docker run -p 3000:3000 claimly-frontend
```

Multi-stage, Next `standalone` output, non-root user.

## Structure

```
src/api/        schema.gen.ts (generated), types.ts (aliases), client.ts (the one API client),
                session.ts (demo session), idempotency.ts, jobs.ts (polling), errors.ts, config.ts
src/mocks/      core.ts (stateful mock backend), templates.ts (sample extractions), handlers.ts (MSW), browser.ts, node.ts
src/components/ ui.tsx, AppShell, Providers (MSW boot + session gate), Chat, Evidence (source viewer),
                Benefit, BenefitReview, Entry, Reminders, JobStatus, case/Sections
src/app/        / · /vault · /vault/[id] · /upload · /review/[id] · /benefits · /benefits/[id]
                /assistant · /cases · /cases/[id] · /calendar · /settings
e2e/            Playwright flows
```

## API client behaviour (`src/api/client.ts`, `session.ts`)

- One client for both modes; paths are `/api/v1/...` per the contract; envelopes parsed as `{data, request_id}`,
  lists as `{data, next_cursor, request_id}`, errors as `{error: {code, message, retryable}, request_id}` → `ApiError`. 204 → no body.
- **Session:** created lazily through **one shared promise**, so parallel components never create separate spaces.
  `/health` and session creation are sent without a token. An expired `expires_at` is discarded before use.
- **401 `DEMO_SESSION_REQUIRED` / `DEMO_SESSION_EXPIRED`:** clear the token, create a new session once, clear the
  React Query cache and resumable jobs, and show “Your previous demo session ended…”. A **GET** is retried once;
  a **mutation is never replayed** (its UUIDs belonged to the old space) — it fails with `SessionReplacedError`.
- **Idempotency-Key** on every POST/PUT that requires it: the key is stored (localStorage) per operation + payload
  until it completes, so a retry re-sends the same key; a new request after success gets a new key.
  Chat messages carry a per-message nonce so two identical questions are two messages, but a retry is not.
- **Multipart:** `FormData` with `entry_id` + `file`; `Content-Type` is never set by hand.
- **Optimistic concurrency:** PATCH/PUT send the entity's current `data_version` (`expected_input_version` for drafts).
  A 409 shows a conflict notice with **Load latest** — nothing is overwritten.
- **Jobs:** `202` → `job.id` → `GET /jobs/{id}` with backoff (1s ×1.5, max 6s), stops on terminal status or unmount.
  Started jobs are remembered so polling resumes after navigating away and back. `progress: null` → indeterminate
  bar, never an invented percentage. `failed` → error + Retry if allowed, `stale` → “run again”, `cancelled` shown as such.
  After an extract job the UI refetches Document/Entry/Benefits from the backend; job payloads are never stored as data.
- **Sources:** `EvidenceRef` opens `/documents/{id}/content` fetched with the `X-Demo-Session` header → object URL
  (revoked on close). PDF opens at `#page=N` with the quote; images show the picture and the quote.
  Older `document_version` → warning; deleted/unavailable source → notice, no fake preview. The token never goes into a URL.
- **Model actions:** only `open_benefit | open_case | add_document | ask_question` are rendered, and only with known UUIDs.
  Anything else (unknown types, URLs) is dropped.

## Mock mode

`NEXT_PUBLIC_API_MODE=mock` starts MSW in the browser with **one catch-all handler** that delegates to
`src/mocks/core.ts`, a stateful implementation of the same routes, envelopes, status codes and error codes.
Vitest runs the exact same code through `msw/node`, and validates responses against the OpenAPI component schemas with Ajv.

- Creates demo sessions automatically like http mode; data per session is persisted in `localStorage` (files ≤1.5 MB too).
- Jobs move `queued → running → succeeded` over ~3 s; usage, drafts, statuses, replies, outcomes and reminders all change state.
- Idempotency replay / 409 on a reused key with a different payload; `expected_version` conflicts; cursor pagination.
- The UI shows a **Sample mode** badge, and Review says results come from a template, not from reading the file.
- Settings → *Sample mode controls*: simulate `503 AI_NOT_CONFIGURED`, or expire the session (401). A file named `*unreadable*` fails analysis.

“Try a sample document” builds a small, clearly labelled sample PDF in the browser and sends it through the normal
Entry + Upload API, so in http mode it is analyzed by the real backend.

## Checks run

- `npm run typecheck` — clean. `npm run build` — OK (mock and http/standalone builds).
- `npm test` — **31/31**: session sharing & persistence, 401 on GET (retry) vs mutation (no replay), expired local token,
  Start new demo, multipart without Content-Type, Idempotency-Key reuse after a network failure and 409 on a different payload,
  upload → job → refreshed entities matching `fixtures/benefit_unknown.json`, **4 → used 1 → 3** matching
  `fixtures/benefit_after_one_use.json` + stale-version 409, unknown total stays `null`, chat de-duplication, 503,
  full case flow (assess → draft → edit/409 → submitted → reply analysis → follow-up → outcome without double usage),
  stale job, reminder rescheduling, pagination, profile, document deletion; all fixtures validate against the schemas;
  whitelisting of model actions; usage display never invents a remainder.
- `npm run test:e2e` — **9/9** in Chromium: no-login open + single session + refresh keeps data; upload → job → review →
  source viewer (blob URL, `#page=1`) → Mark used 4/1/3 → entry chat with quote → matching in the general thread →
  Plan to use (nothing deducted) → draft edit/save → **Copy doesn't mark sent** → I sent it → company reply analysis →
  follow-up → persistent case chat after reload; calendar interval edits; 503 / 409 across two tabs / 401 → new space with
  no login; unknown usage not shown as zero; failed analysis; **375 / 768 / 1440 px** with no horizontal scroll and the
  mobile bottom nav not covering the main action; skip link and dialog focus/Escape.
- http mode against an unreachable backend: one `POST /api/v1/demo/sessions` without a token, honest “can't reach the server” screen with retry.

## Points for the integrator (contract is not changed)

These are interpretations the frontend relies on; please confirm on the backend side:

1. `GET /threads/{id}/messages` and `GET /cases/{id}/events` are in **chronological (ascending)** order.
2. One `vault` thread per session: the frontend lists `scope=vault` and creates one only if none exists.
3. `DraftPatch.expected_input_version` equals the draft's current `input_version`; regeneration produces a new version → 409 on old edits.
4. A reminder with `channels: ["email"]` is rejected (422) while `profile.email_configured=false`; the UI only offers email when configured and opted in.
5. `Benefit.deadline_status=user_set` after `PATCH {deadline_date, deadline_origin: "user"}`.
6. Outcomes with `service_used`/`voucher_used` + `quantity` update benefit usage **once** (mock applies only the delta on re-PUT).
7. No endpoint marks notifications as read, so they're display-only. No endpoint uploads a new version of an existing document,
   so “outdated source” warnings rely on `document_version` < `Document.version`.
8. CORS must expose/allow `X-Demo-Session`, `Idempotency-Key`, and ideally expose `X-Contract-Version`.
