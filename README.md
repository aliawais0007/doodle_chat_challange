# Doodle Chat Frontend Challenge Submission

This is my submission for the Doodle frontend hiring challenge — a single-room chat UI built on top of the provided REST backend.

Stack: React, TypeScript, Vite, TanStack Query, Zod, Tailwind CSS, Vitest/MSW for tests, Playwright for e2e.

## What's implemented

- local display-name identity flow (first-visit dialog, edit later)
- message history with cursor-based pagination (`before`)
- incremental sync for new messages while the tab is open (`after`)
- optimistic sending with sending/failed states, plus retry and remove
- an unread-messages affordance when you're scrolled up reading older history

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Runs on http://localhost:5173.

## Backend setup

The frontend expects the challenge backend from the `api` folder to be running.

Docker (easiest):

```bash
cd api
docker compose up
```

Or locally with Node + MongoDB:

```bash
cd api
cp .env.example .env
npm install
npm run dev
```

Backend runs on http://localhost:3000, Swagger docs at `/api/v1/docs`.

## Environment variables

- `VITE_API_BASE_URL` — e.g. `http://localhost:3000/api/v1`
- `VITE_API_TOKEN` — the challenge bearer token

Anything prefixed `VITE_` gets bundled into the browser bundle, so this token isn't actually secret client-side — that's fine here since it's a challenge token, not a real credential.

## Scripts

```bash
npm run dev
npm run lint
npm run typecheck
npm run test
npm run test:coverage
npm run build
npm run test:e2e
npm run test:e2e:headed
```

## Architecture

Feature folders:

- `src/app` — shell, providers, error boundary
- `src/features/chat` — timeline UI, hooks, domain logic
- `src/features/identity` — display-name flow
- `src/shared` — API client, contracts, errors, env config
- `src/test` — shared test setup and MSW wiring

**Why TanStack Query and not Redux or plain `useState`/`useEffect`:** almost all the complexity here is server state — cursor history, incremental sync, optimistic mutation reconciliation, retry/backoff — not app-wide client state. TanStack Query already solves that lifecycle (loading/stale/retry/error, cache updates) so I didn't need to hand-roll it. Whatever's left over (composer text, dialog open/closed, scroll affordance) is small and local enough that Redux would just be extra ceremony without solving anything real.

**Why Vite:** fast dev loop, and it plugs into TypeScript/Vitest/Playwright/env config with basically no setup friction.

## Synchronization

New messages show up via polling, not websockets:

```
GET /api/v1/messages?after=<timestamp>&limit=100
```

This kicks in once the initial history load succeeds, pauses when the tab is hidden or offline, and re-triggers on focus/reconnect. Recoverable failures back off exponentially instead of hammering the API.

I went with polling because the backend is REST-only with cursor params — there's no websocket/SSE contract to build against, so a websocket layer would just be scope creep for this challenge.

## Pagination

Loading older history uses `before=<oldestLoadedTimestamp>`: load the most recent page first, fetch older pages on demand as the user scrolls up, merge everything into one chronological stream, and dedupe by the persisted message `_id`.

## Sending a message

1. validate what's in the composer
2. create an optimistic message with a local `clientId`, show it immediately as "sending"
3. POST it to the backend
4. on success, swap the optimistic message for the real persisted one
5. on failure, mark it failed and let the user retry or remove it

This is built to handle concurrent sends and responses that come back out of order.

## Scroll behavior

The scroll position tries to do the right thing based on *why* the timeline changed:

- first load jumps straight to the bottom
- your own sent messages follow to the bottom
- incoming messages from others only auto-scroll if you're already near the bottom — otherwise they just bump an unread counter and show a "scroll to latest" button
- loading older messages captures your scroll anchor first and restores it after, so the viewport doesn't jump around

## Accessibility

Landmarks and labels are semantic, the dialog and composer are fully keyboard-operable, focus gets restored properly around the dialog, there's a polite live region announcing new synced messages, and scroll/transition behavior respects reduced-motion. I wouldn't call this a perfect accessibility pass, but it's a real one — covered by an axe scan in the e2e suite, not just eyeballed.

## Error handling

API failures get normalized into categories (configuration, unauthorized, validation, timeout, network, malformed response, server, aborted, unknown) so the UI can react appropriately instead of showing one generic error everywhere. Initial history failures get a retry button; pagination failures keep whatever's already loaded on screen; failed sends can be retried or removed; and background sync issues never wipe out messages you can already see — they just show a small status line.

## Testing

Three layers: unit tests for the domain logic (message ordering/merging/reconciliation, schema parsing), integration tests for hooks and screens against MSW, and e2e tests covering identity, send/retry, pagination, sync, keyboard flow, mobile viewport, and an accessibility scan.

## CI

`.github/workflows/ci.yml` runs a quality job (lint, typecheck, unit/integration tests, coverage, build) and a separate e2e job (Playwright), uploads artifacts on failure for debugging, and cancels superseded runs on a branch.

## Performance

Polling incrementally instead of refetching full history, deduping by `_id`, and bounded retry/backoff keep this reasonably efficient without extra machinery. I didn't add list virtualization — cursor pagination already keeps the rendered timeline bounded for what this challenge needs, and virtualization is the kind of thing you add once you actually measure a rendering bottleneck, not before.

## Security assumptions

- the bearer token is visible client-side by design — it's a challenge token, not a real secret boundary
- messages render as plain text, no HTML injection path
- all API payloads are validated at runtime with Zod before anything touches state

## Identity

The display name is a local chat identity, not authentication. It's stored locally for convenience and sent as the `author` field on new messages. Changing it later doesn't rewrite the authorship of anything you already sent.

## Backend limitations I worked around

The backend is REST-only with timestamp-based cursors (`before`/`after`), no websocket/SSE. One real limitation: if two messages share the exact same timestamp, cursor pagination can't perfectly distinguish them. I mitigate this with overlapping polling windows plus `_id` dedupe, but it's a backend data-model limitation I can't fully fix from the frontend.

## What I deliberately left out

Reactions, message edit/delete, typing indicators, presence/read receipts, attachments, multi-room support, and a custom auth system — none of these were in scope for the challenge, so I didn't build them.

## If this went to production

I'd swap the challenge token for real auth/session handling, add proper observability for client failures and sync behavior, define a real device/browser support matrix with accessibility QA baked into it, profile before reaching for virtualization, and tighten up release hygiene (branch protection, changelogs, the works).
