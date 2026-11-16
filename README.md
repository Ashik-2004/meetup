# Meetups — Phase 1 local MVP

An event networking and travel companion platform that helps people attending the same event discover compatible attendees, connect anonymously, and coordinate travelling together.

A local-first prototype for event communities and optional travel-companion matching. The Phase 1 focus is event invitations, joining, privacy-safe matching, anonymous requests, mutual acceptance, and chat after consent.

## Run locally

Requirements: Node.js 20.19+, 22.12+, or 24+, and npm.

```bash
cd /workspace/meetup-remote-inspect
npm install
npm run dev
```

Open **http://localhost:5173**. The Vite development server forwards `/api` calls to the local API on port `3001` and preserves the browser's `Host` and `Origin` headers. Stop both processes with `Ctrl+C`.

For a single-server local run instead:

```bash
npm run build
npm start
```

Then open **http://localhost:3001**. This is still a development prototype—not a public deployment configuration.

New public accounts are always attendees; the registration API does not grant roles from client input. Create a coordinator or moderator account through normal registration first, then use the local operator CLI against the same SQLite database:

```bash
npm run provision:access -- coordinator account@example.test
npm run provision:access -- moderator account@example.test
```

Set `DB_FILE` for both the app and CLI if using a non-default database. Coordinator and moderator grants are written server-side and recorded in the local audit log; do not expose this offline operator command as a public endpoint.

## Origin and deployment settings

Mutating requests are accepted only from the same origin or from an explicitly trusted exact origin. Local development permits only `http://localhost:5173` and `http://127.0.0.1:5173`; production does not add those local origins. When the browser-facing frontend and API are on different origins, set `TRUSTED_ORIGINS` in the API environment to the exact browser origin, including scheme and port when present, with comma-separated values if needed. Do not include URL paths, credentials, wildcards, or `*`. For a proxied preview, allow the exact origin shown in the browser—not the API's internal upstream address.

Production also requires a long random `SESSION_SECRET` and `NODE_ENV=production`. Example values below are placeholders, not credentials:

```text
NODE_ENV=production
SESSION_SECRET=<long-random-secret>
TRUSTED_ORIGINS=https://meetups.example.com
```

The Vite preview host allowlist is limited to localhost, loopback, and the established `.manus.computer` suffix. This development-server host setting does not relax the API's exact Origin/Host check. The current API read throttles are in-memory and process-local; a multi-process or horizontally scaled deployment needs a shared rate-limit store and operational monitoring before public use.

## Architecture

- **Client:** React 19 with Vite; responsive attendee, coordinator, and moderator views, built as a static SPA.
- **API:** Express 5 JSON API, with Zod request validation, server-controlled role checks, bounded and paginated list reads, read/write throttles, and restrictive same-origin checks.
- **Storage:** SQLite via `better-sqlite3`; data is created at `data/meetups.sqlite` by default. Set `DB_FILE` to use another path. Remove that database plus its `-wal` and `-shm` files to reset local data.
- **Authentication:** Local email/password accounts (scrypt password hashes) and opaque 14-day, HttpOnly, SameSite session cookies. Session tokens are stored as keyed hashes. Set `SESSION_SECRET` before any production-mode run; the built-in development secret is intentionally rejected in production mode.
- **Matching privacy:** The matching API returns anonymous travel fields and short-lived opaque references. Identity/profile endpoints and chat require an accepted connection, an active event, current membership for both participants, recorded mutual consent, and no block. Contact details are not returned by public event or matching APIs.

No third-party service, analytics, external font, email provider, or file storage is needed to run this prototype.

## Implemented flows

- Public landing and event invitation details; signed-out landing cards include only public events; private event links; event registration/open-capacity state.
- Attendee registration with optional profile setup and explicit opt-in to matching; public registration cannot assign coordinator or moderator access.
- Coordinator event creation, editing, registration controls, cancellation, and owner announcements; dashboards list registered attendees by name only, separately from city/travel aggregates that are suppressed below the five-person threshold. Attendee contact details, profile fields, localities, travel methods, and matching status are not included in the roster.
- Event membership remains separate from opting into travel matching. An event owner can read and post announcements without joining; announcement history is limited to the event owner and current members.
- Real same-event matching only when both users opted in and their gender preferences, travel modes, and driver-reported seat counts are compatible; no fabricated recommendations.
- Anonymous request inbox, accept/decline/cancel/expiry, block/report, disconnect, and chat that is inaccessible before recorded consent and acceptance. Blocked-pair requests are excluded from both inboxes.
- Cancelled events pause matching, reject stale recommendation references and travel updates, expire pending requests, and revoke accepted chat/profile access.
- Moderator-only report list, detail, and status-review actions, with audit records for report access and status changes. Reports are bound to verified request/event context and protected by duplicate and idempotency controls.
- Strict calendar-date and time validation, and bounded, paginated, throttled reads for events, matches, requests, connections, chat history, announcements, coordinator data, and reports.
- Responsive loading, error, success, and empty states; keyboard focus styles and reduced-motion handling. The mobile navigation moves focus into the sidebar and returns it to the menu control when closed.

The consent wording is a **configurable draft pending owner approval**, centralized in `client/src/consentConfig.js` and visibly marked as a draft in the UI. The provisional flow requires a sender acknowledgement in the request dialog and a recipient acceptance before the server reveals both attendees' names and only the profile fields each person chose to share, then opens chat. Confirm the wording and any policy changes with the owner before treating this behavior as final or exposing the prototype to real users. The app does not offer optional free-text request messages, to avoid accidentally leaking identity before acceptance.

A seat count shown in matching is labelled **Driver-reported seats**. Seats aren’t reserved through Meetups; confirm availability and costs directly in chat. The prototype does not verify drivers, vehicles, identities, seat capacity at the time of acceptance, or transport arrangements. Atomic seat reservation/overbooking prevention is outside this Phase 1 security-fix scope and should be designed before presenting seat counts as reserved capacity.

## Local test commands

```bash
npm run check   # Node syntax checks
npm test        # API integration and client privacy regressions with temporary SQLite databases
npm run build   # Production client bundle
```

The test suite covers the ten reported security findings plus role tampering, origin policy, profile opt-in, private event exposure, consent wording, announcement privacy, cancellation and membership revocation, moderation authorization/audit, bounded pagination, read throttling, and strict date/time validation.

## Prototype boundaries

This is not ready for real users or deployment. Email/Google/phone verification, password reset, account deletion/export, email/push notifications, real-time chat/read receipts, event discussion threads, content moderation, production secrets/backups, and distributed rate limiting are not implemented. The moderator workflow reviews reports and records status changes; it does not suspend accounts, remove content, or provide appeals. Local operator provisioning is not a public administration service. Car-seat availability is unverified and not atomically reserved. A private event invite URL grants access to invitation details, not announcement history; share it only with intended invitees.
