# Doodle Chat Frontend Challenge Submission

This is a single-room chat frontend for the Doodle hiring challenge.

Built with React, TypeScript, Vite, TanStack Query, Zod, Tailwind CSS, Vitest/MSW, and Playwright.

## Product Overview

What is implemented:

- local display-name identity flow
- message history with cursor pagination
- incremental synchronization for incoming persisted messages
- optimistic send with failed/retry/remove states
- unread affordance when the user is reading older history

## Live / Demo

No public deployment URL is included in this repository.

## Screenshots

No curated static screenshots are currently committed.

Evaluator screenshot set to capture:

- first-visit display-name dialog
- conversation timeline with date separators
- optimistic failure state with retry/remove
- unread new-message affordance while scrolled up
- mobile viewport (390x844)

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Frontend default URL: http://localhost:5173

## Backend Setup

This frontend targets the provided challenge backend in the local api folder.

Docker (recommended):

```bash
cd api
docker compose up
```

Local Node + MongoDB:

```bash
cd api
cp .env.example .env
npm install
npm run dev
```

Backend default URL: http://localhost:3000
API docs: http://localhost:3000/api/v1/docs

## Environment Variables

Frontend runtime config:

- `VITE_API_BASE_URL` (example: `http://localhost:3000/api/v1`)
- `VITE_API_TOKEN` (challenge bearer token)

Note on bearer token: values prefixed with `VITE_` are bundled to browser code. For this challenge the token is intentionally client-usable, so it should not be treated or described as a secret.

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

Feature-oriented layout:

- `src/app`: shell, providers, error boundary
- `src/features/chat`: timeline UI, hooks, domain logic
- `src/features/identity`: display-name identity flow
- `src/shared`: API client/contracts/errors/config
- `src/test`: shared test setup and MSW server wiring

### Why TanStack Query

The main complexity is server state, not local global state:

- cursor history (`before`)
- incremental sync (`after`)
- optimistic mutation reconciliation
- async lifecycle state (loading/stale/retry/error)

TanStack Query handles this directly with less custom cache machinery.

### Why Redux Was Not Needed

Redux was not introduced because:

- server state is already owned by TanStack Query
- remaining state is localized UI state (composer/dialog/scroll affordance)
- adding Redux here would add structure without solving a missing problem

### Why Vite

Vite fits this challenge because it gives fast local iteration and simple integration with TypeScript, Vitest, Playwright, and environment-variable based backend configuration.

## Synchronization

The app uses incremental polling:

- `GET /api/v1/messages?after=<timestamp>&limit=100`
- enabled after initial history success
- paused while hidden/offline
- refreshed on focus/reconnect
- bounded retry/backoff for recoverable failures

### Why Incremental Polling

The backend contract is REST with cursor params. Polling with `after` provides near-real-time updates without refetching the full history repeatedly.

### Why No WebSocket

WebSocket was not added because the challenge backend is REST-oriented and the scope is intentionally constrained to the provided contract.

## Pagination

Older pagination uses `before=<oldestLoadedPersistedTimestamp>`:

- load recent page first
- request older pages on demand
- merge pages into one chronological stream
- dedupe by persisted message `_id`

## Optimistic Updates

Send path:

1. validate composer content
2. create optimistic message with `clientId`
3. render immediately as `sending`
4. POST message to backend
5. reconcile optimistic item with persisted message on success
6. mark as `failed` on error and allow retry/remove

This flow is designed to support concurrent sends and out-of-order server responses.

## Scrolling

Scroll behavior is intent-based:

- initial loaded history jumps to latest
- own sends follow latest
- remote incoming follows only when near bottom
- remote incoming while reading history increments unread count and shows explicit "scroll to latest"
- prepending older history captures/restores anchor position to preserve viewport continuity

## Accessibility

Implemented accessibility work includes:

- semantic landmarks and labels
- keyboard-operable dialog and composer actions
- focus restoration around dialog interactions
- dedicated polite live region for newly synchronized remote messages
- reduced-motion handling for scroll/transition behavior

This README does not claim perfect accessibility.

## Error Handling

API failures are normalized into typed categories (configuration, unauthorized, validation, timeout, network, malformed response, server, aborted, unknown).

UI handles distinct failure scopes:

- initial history load failure with retry
- older-pagination failure while preserving already loaded messages
- send failure on optimistic messages with retry/remove
- background sync delay/offline status without clearing existing timeline

Background sync errors are treated as non-blocking; already loaded messages remain visible.

## Testing

Testing layers:

- unit: domain ordering/merge/reconciliation and schema parsing
- integration: hooks and screen behavior with MSW
- e2e: identity flow, send/retry, pagination, sync behavior, keyboard flow, mobile flow, accessibility scan

No test coverage percentage claim is made here.

## CI

Workflow in `.github/workflows/ci.yml` runs:

- quality job: lint, typecheck, unit/integration tests, coverage, build
- e2e job: Playwright suite
- artifact upload for debugging on failure
- run cancellation for superseded commits

No claim is made here that CI is always green.

## Performance

Current performance decisions:

- incremental polling instead of full-history refetch
- dedupe by `_id`
- bounded sync retry/backoff
- keep state ownership focused to avoid unnecessary rerender/caching layers

### Why Virtualization Was Not Added

Virtualization was intentionally not added at this stage. Cursor pagination keeps active timeline size bounded for typical challenge usage, and virtualization should be introduced only after measured evidence that rendering cost is a bottleneck.

No performance score claim is made here.

## Security Assumptions

- challenge bearer token is browser-visible by design (not a secret boundary)
- message content is rendered as plain text (no HTML rendering path)
- API payloads are runtime-validated via Zod at the boundary

## Display Name and Identity

Display name is local chat identity, not authentication.

- persisted locally for convenience
- sent as `author` for future messages
- changing it does not rewrite historical message authorship

## Backend Limitations

This frontend intentionally follows the supplied backend constraints:

- REST history/send endpoints
- cursor pagination using timestamps (`before`/`after`)
- no WebSocket/SSE contract

Known backend data-model limitation:

- timestamp-only cursor pagination can have edge collisions when multiple messages share identical timestamps. Frontend mitigates with overlap polling and `_id` dedupe, but the root limitation is backend pagination semantics.

## Deliberate Non-Goals

Deliberately excluded features:

- reactions
- message edits/deletes
- typing indicators
- presence/read receipts
- attachments
- multi-room/channel support
- custom auth system

## Future Production Considerations

If this were taken beyond challenge scope:

- move from challenge token to real auth/session architecture
- add structured observability for client failures and sync behavior
- formalize device/browser support matrix and accessibility QA gates
- profile high-volume timelines before introducing virtualization
- tighten release hygiene with branch protection and release notes discipline

## Verification Notes

Before asserting stronger claims (for example "all checks pass"), re-run:

```bash
npm run lint
npm run typecheck
npm run test
npm run test:coverage
npm run build
npm run test:e2e
```
