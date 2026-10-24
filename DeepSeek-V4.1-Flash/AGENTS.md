# AGENTS.md

Guidance for agents working in this repository.

## What this is

NoldOJ: a Windows-native online judge. Backend is zero-runtime-dependency
Node.js (ESM, `node:http`, `node:sqlite`, `node:crypto`). Frontend is a
build-free vanilla-JS SPA served statically by the backend.

## Commands

- Start: `npm start` (or `.\start.bat`)
- Dev (watch): `npm run dev`
- Init dirs + DB: `npm run init`
- Migrate DB: `npm run migrate`
- Tests: `npm test`
- Lint: `npm run lint`

Always run `npm run lint` and `npm test` after backend changes. Node >= 24 is
required (`node:sqlite`).

## Conventions

- Backend uses ES modules. No CommonJS `require`.
- Do NOT add runtime npm dependencies without a strong reason; the backend is
  intentionally dependency-free. Dev-only tooling (eslint) is fine.
- All user-facing strings are Chinese (`zh-CN`); code comments and identifiers
  are English.
- Route modules live in `backend/src/routes/` and export a `register(router)`.
- Database access goes through `backend/src/db.js`. Never open SQLite directly
  in a route.
- Sandbox code must never run in the main server process — it is spawned as a
  child (`backend/src/services/sandbox-runner.js`).

## Layout reminders

- `backend/src/services/` — judge queue, sandbox, compiler, comparator, scorer,
  captcha, websocket, ai, plagiarism.
- `backend/src/http/` — router + middleware. Add new middleware there and wire
  it in `server.js`.
- Every table is defined in `db.js` `SCHEMA`; migrations are additive.
