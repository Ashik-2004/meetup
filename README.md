# Meetups — Phase 1 local MVP

An event networking and travel companion platform that helps people attending the same event discover compatible attendees, connect anonymously, and coordinate travelling together.

A local-first prototype for event communities and optional travel-companion matching. The Phase 1 focus is event invitations, joining, privacy-safe matching, anonymous requests, mutual acceptance, and chat after consent.

## Run locally

Requirements: Node.js 20.19+, 22.12+, or 24+, and npm.

```bash
cd /workspace/meetups
npm install
npm run dev
```

Open **http://localhost:5173**. The Vite development server forwards `/api` calls to the local API on port `3001`. Stop both processes with `Ctrl+C`.

For a single-server local run instead:

```bash
npm run build
npm start
```

Then open **http://localhost:3001**. This is still a development prototype—not a public deployment configuration.

New local accounts use an email and password; the local-only flow marks accounts verified without sending email. Use throwaway demo credentials, not a real password. There is no seeded/demo activity: create a coordinator account, make an event, then use separate browser profiles for attendee accounts to exercise matching.

## Architecture

- **Client:** React 19 with Vite; responsive attendee and coordinator views, built as a static SPA.
- **API:** Express 5 JSON API, with Zod request validation, role checks, rate limits for authentication and request creation, and restrictive same-origin checks.
- **Storage:** SQLite via `better-sqlite3`; data is created at `data/meetups.sqlite` by default. Set `DB_FILE` to use another path. Remove that database plus its `-wal` and `-shm` files to reset local data.
- **Authentication:** Local email/password accounts (scrypt password hashes) and opaque 14-day, HttpOnly, SameSite session cookies. Session tokens are stored as keyed hashes. Set `SESSION_SECRET` before any production-mode run; the built-in development secret is intentionally rejected in production mode.
- **Matching privacy:** The matching API returns anonymous travel fields and short-lived opaque references. Identity/profile endpoints and chat verify an accepted connection on the server. Sender acknowledgement and recipient acceptance are stored as separate consent timestamps before profile reveal or chat is allowed. Contact details are not returned by the public event or matching APIs.

No third-party service, analytics, external font, email provider, or file storage is needed to run this prototype.

## Implemented flows

- Public landing and event invitation details; public event browser for signed-in users; private event links; event registration/open-capacity state.
- Local attendee/coordinator accounts, profile setup, approximate starting locality, mutual gender preferences, and per-field profile visibility.
- Coordinator event creation, attendee list and real city/travel-method aggregates, and event announcements.
- Event membership that remains separate from opting into travel matching.
- Real same-event matching only when both users opted in and their gender preferences, travel modes and available car-seat conditions are compatible; no fabricated recommendations.
- Anonymous request inbox, accept/decline/cancel/expiry, block/report, disconnect, and chat that is inaccessible before recorded consent and acceptance.
- Responsive loading, error, success and empty states; keyboard focus styles and reduced-motion handling.

The consent wording is a **configurable draft pending owner approval**, centralized in `client/src/consentConfig.js` and visibly marked as a draft in the UI. The provisional flow requires a sender acknowledgement in the request dialog and a recipient acceptance before the server reveals only approved profile fields and opens chat. Confirm the wording and any policy changes with the owner before treating this behavior as final or exposing the prototype to real users. The app does not offer optional free-text request messages, to avoid accidentally leaking identity before acceptance.

## Local test commands

```bash
npm run check   # Node syntax checks
npm test        # API integration/privacy tests with a temporary SQLite database
npm run build   # Production client bundle
```

The automated API tests cover event privacy and coordinator authorization; same-event and mutual-gender matching; rejection of requests without sender acknowledgement; anonymous requests; consent timestamps; identity reveal and chat gating; blocking; and invalid profile/event-role inputs.

## Prototype boundaries

This is not ready for real users or deployment. Email/Google/phone verification, password reset, account deletion/export, email/push notifications, real-time chat/read receipts, event discussion threads, admin report review/suspension, file uploads, and production secrets/backups are not implemented. Reports are saved privately in SQLite but there is no moderation console. Coordinators can create events, see attendees/aggregates, and publish announcements; full event editing and community-content moderation are not included yet. Car seat sharing is explicit and represented in matching, but no driver, vehicle, identity, or transport service is verified. A private event invite URL is the access link; share it only with intended invitees.
