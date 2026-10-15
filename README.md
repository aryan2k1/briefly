# Briefly

A relationship-intelligence prototype for organising contacts, meetings and follow-up work. It explores how a relational data model and permission-aware workflows can support a team’s institutional relationships.

**Status:** local, synthetic-data prototype. Demo personas are not production authentication. No live email, calendar, news or AI service is connected.

## What to explore

- Searchable contact records, linked companies and employment history.
- Meetings with participant snapshots, notes and follow-up workflows.
- Role-aware workspace views and organisation/team data boundaries.
- Version checks and draft handling around edits.
- PostgreSQL row-level security and transactional audit records.

## Stack and layout

Next.js, React and TypeScript; PostgreSQL through `pg`.

| Folder | Purpose |
| --- | --- |
| `src/` | Application pages, components and server logic |
| `db/` | Schema migrations and security policies |
| `scripts/` | Local database, synthetic seeds and verification |
| `tests/` | Database integration and response/draft tests |

## Run locally

Use Node.js 24+ and pnpm. The bundled PostgreSQL development dependency targets **Apple Silicon macOS**; other platforms need a compatible PostgreSQL installation and `PG_BIN` pointing to its binary directory.

```sh
pnpm install --frozen-lockfile --ignore-scripts
# Apple Silicon only: restore the bundled PostgreSQL library symlinks.
(cd node_modules/@embedded-postgres/darwin-arm64 && node scripts/hydrate-symlinks.js)
pnpm db:local
# In another terminal, from this directory:
pnpm dev
```

Open http://127.0.0.1:4319 and select a fictional persona. PostgreSQL listens only on loopback port 55439. The launcher creates synthetic records on a fresh database and stores generated credentials under ignored `.local/`. Never upload that directory.

## Check the project

```sh
pnpm typecheck
pnpm lint
pnpm format:check
# Requires the local PostgreSQL server:
pnpm verify
pnpm build
```

Integration tests create separate `briefly_test_*` databases. They are retained for inspection. Synthetic sign-in intentionally refuses production mode; `pnpm start` is not a production login path.

## Design decisions and limitations

The database enforces access boundaries as well as the UI. Runtime credentials are separate from migration credentials. Search works over stored records; this is not a connected external intelligence service. Production identity, hosting, secret management, backups and organisational data approval remain separate work.

This publication is a clean source snapshot. It excludes local databases, credentials and private planning material. Third-party dependencies retain their own licences; no blanket licence is asserted over them.
