# Home layouts: technical handover and acceptance evidence

23 October 2026. Local synthetic prototype increment; not production approval.

## Re-baseline (before this increment)
Run on 23 Oct 2026 from the unmodified active app, database started with `node scripts/local-postgres.ts` (existing database preserved; clean shutdown logged 11 Oct):
- `node scripts/verify.ts`: TypeScript, ESLint, Prettier passed; 34/34 tests, isolated database `briefly_test_b2c9796e03e2`.
- `next build` (Turbopack): passed. Dev server ready; `/` returned 200, anonymous `/api/session` 401.
This replaces, rather than confirms, the September results.

## What was added
- `db/003-home-layouts.sql` (additive; no existing table or row altered): function `current_member()`, table `home_layouts(org_id, team_id, membership_id, version, blocks jsonb, updated_at)`, primary key `(org_id, membership_id)`, composite FK to `identity.memberships(org_id, team_id, id)`, forced RLS: select/insert/update only where org, team and member equal the session's. No delete policy or grant. `scripts/migrate.ts` now lists 003; migrations 001/002 are byte-unchanged.
- `src/lib/server/db.ts`: `scoped()` also sets transaction-local `briefly.member`.
- `src/lib/home-contracts.ts`: `homeBlockIds` (allowlist: upcoming, myActions, awaitingNotes, recent), `HomeLayout`, `defaultHomeBlocks()`. Version 0 = no saved layout.
- `src/lib/server/home-layout.ts` + routes in `api.ts`: `GET /api/home/layout` (query strings rejected, like `/api/home`); `PATCH /api/home/layout` with `{version, blocks}`. Server requires every block id exactly once, boolean visibility, at least one visible block, no extra fields. Version 0 inserts (conflict → 409 if a row exists); otherwise `UPDATE … WHERE version = expected` (no match → 409). Existing Origin/CSRF/session checks apply to PATCH. Reset is a save of the default order.
- UI: `HomeBlocks.tsx` renders blocks in saved order; "Customise Home" panel with keyboard-operable Up/Down/Hide buttons, Save, Reset to default, Cancel, saving/error/conflict states. A layout load failure falls back to the default order without hiding records. `GET /api/home` and its data rules are unchanged.
- Tests: new integration test in `tests/foundation.test.ts`; two parser tests in `tests/home-response.test.ts`; the existing migration-version assertion now expects versions 1, 2, 3 (the populated 001→002→003 upgrade is rehearsed).

## Decisions to review
- **No `audit_events` row for layout saves.** Audit inserts are editor-only by RLS, and layouts are a personal display preference; the row's `version` and `updated_at` are the record. Say if you want layout changes audited (it would need an editor-only restriction or a separate policy).
- **Viewers may save their own layout** (display preference, own row only). Say if you want this restricted.
- Other members' layouts are never readable, even by admins.

## Evidence (23 Oct 2026, worktree `home-layouts`)
- `node scripts/verify.ts`: TypeScript, ESLint, Prettier passed; **37/37 tests** on isolated database `briefly_test_77a0ad6c08c6`. The new integration test covers: default, create, create-conflict, stale-version conflict, update, personal isolation between editor/viewer/other organisation, direct SQL seeing only the member's row, unscoped reads seeing none, cross-member update affecting 0 rows, 13 invalid payloads (all 400), wrong CSRF and foreign Origin (403), anonymous (401), and two concurrent saves producing exactly one 200 and one 409.
- `next build`: passed .
- **Not verified:** no browser session was available, so the Customise Home UI, keyboard use, the 390px layout and the Stay/Discard guards were not exercised in a browser. Run the browser checks below before accepting.

## Upgrading an existing local database
Migration 003 is additive and forward-only. Restarting `pnpm db:local` applies it and preserves existing data; do not copy a running PostgreSQL directory. Code rollback leaves an unused `home_layouts` table, which is harmless.

## Browser checks still to run
Sign in as editor: reorder/hide, save, reload (persists), Reset; two-tab conflict message; viewer and the other-organisation persona see only their own layout; 390px width; keyboard-only use.
