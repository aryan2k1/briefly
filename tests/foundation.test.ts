import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomBytes, createHash } from "node:crypto";
import pg from "pg";
import { migrate } from "../scripts/migrate.ts";
import { seed } from "../scripts/seed.ts";
import { seedUnified } from "../scripts/seed-unified.ts";
import { fixtureId as id } from "../src/lib/fixture-ids.ts";
import type { SessionView } from "../src/lib/contracts.ts";
let handle: typeof import("../src/lib/server/api.ts").handle;
let pool: pg.Pool;
let admin: pg.Client;
let testAdminUrl: string;
let editor: { token: string; session: SessionView },
  viewer: typeof editor,
  other: typeof editor;
const origin = "http://127.0.0.1:4319";
async function req(
  path: string,
  method = "GET",
  data?: unknown,
  auth = editor,
  extra: Record<string, string> = {},
) {
  const headers: Record<string, string> = {
    origin: origin,
    ...(auth
      ? {
          cookie: `briefly_foundation_session=${auth.token}`,
          "x-csrf-token": auth.session.csrfToken,
        }
      : {}),
    ...extra,
  };
  if (data !== undefined) headers["content-type"] = "application/json";
  return handle(
    new Request(origin + path, {
      method,
      headers,
      body: data === undefined ? undefined : JSON.stringify(data),
    }),
  );
}
async function login(persona: string) {
  const response = await handle(
    new Request(origin + "/api/auth/demo", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ persona }),
    }),
  );
  assert.equal(response.status, 200);
  const token = response.headers
    .get("set-cookie")!
    .match(/briefly_foundation_session=([^;]+)/)![1];
  return { token, session: (await response.json()) as SessionView };
}
before(async () => {
  const cfg = JSON.parse(
    await readFile(new URL("../.local/runtime.json", import.meta.url), "utf8"),
  ) as { adminUrl: string; appUrl: string };
  const db = `briefly_test_${randomBytes(6).toString("hex")}`;
  const control = new pg.Client({ connectionString: cfg.adminUrl });
  await control.connect();
  await control.query(`CREATE DATABASE ${db}`);
  await control.end();
  const adminUrl = new URL(cfg.adminUrl);
  adminUrl.pathname = "/" + db;
  testAdminUrl = adminUrl.href;
  const appUrl = new URL(cfg.appUrl);
  appUrl.pathname = "/" + db;
  // Rehearse an actual populated version-1 upgrade, not only a fresh schema.
  const upgrade = new pg.Client({ connectionString: adminUrl.href });
  await upgrade.connect();
  const originalSql = await readFile(
    new URL("../db/001-foundation.sql", import.meta.url),
    "utf8",
  );
  await upgrade.query(originalSql);
  await upgrade.query(
    "CREATE TABLE schema_migrations(version integer PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())",
  );
  await upgrade.query(
    "INSERT INTO schema_migrations(version,checksum) VALUES(1,$1)",
    [createHash("sha256").update(originalSql).digest("hex")],
  );
  await seed(adminUrl.href);
  const preserved = await upgrade.query(
    "SELECT id,title,starts_at FROM meetings ORDER BY id",
  );
  const preservedContacts = await upgrade.query(
    "SELECT * FROM contacts ORDER BY id",
  );
  await migrate(adminUrl.href);
  assert.deepEqual(
    (await upgrade.query("SELECT id,title,starts_at FROM meetings ORDER BY id"))
      .rows,
    preserved.rows,
  );
  assert.deepEqual(
    (await upgrade.query("SELECT * FROM contacts ORDER BY id")).rows,
    preservedContacts.rows,
  );
  assert.deepEqual(
    (
      await upgrade.query(
        "SELECT version FROM schema_migrations ORDER BY version",
      )
    ).rows,
    [{ version: 1 }, { version: 2 }, { version: 3 }],
  );
  await upgrade.end();
  await migrate(adminUrl.href);
  await seed(adminUrl.href);
  await seed(adminUrl.href);
  process.env.DATABASE_URL = appUrl.href;
  process.env.APP_ORIGIN = origin;
  process.env.AUTH_MODE = "synthetic-local";
  Object.assign(process.env, { NODE_ENV: "test" });
  handle = (await import("../src/lib/server/api.ts")).handle;
  pool = (await import("../src/lib/server/db.ts")).pool;
  admin = new pg.Client({ connectionString: adminUrl.href });
  await admin.connect();
  editor = await login("editor");
  viewer = await login("viewer");
  other = await login("other");
  console.log(
    `Real PostgreSQL isolated test database: ${db}; retained for inspection. No demo database was modified.`,
  );
});
after(async () => {
  await pool?.end();
  await admin?.end();
});
test("unified meeting reads, edits, history, filters and overview share authorised persisted records", async () => {
  const auth = await login("editor");
  const read = async (path: string) => {
    const r = await req(path, "GET", undefined, auth);
    assert.equal(r.status, 200);
    return r.json();
  };
  const before = await read("/api/meetings?pageSize=100");
  assert.equal((await read("/api/overview")).totalMeetings, before.total);
  const old = await read(`/api/meetings/${id(7001)}`);
  const patch = {
    version: old.version,
    title: old.title,
    startsAt: old.startsAt,
    status: "completed",
    notes:
      "Discussed refinancing exposure and requested the next sector review.",
    tags: ["CFG", "ESG"],
    actions: [
      {
        description: "Share permitted sector review",
        ownerId: id(101),
        dueOn: "2026-09-20",
        status: "open",
      },
    ],
  };
  assert.equal(
    (await req(`/api/meetings/${old.id}`, "PATCH", patch, auth)).status,
    200,
  );
  const saved = await read(`/api/meetings/${old.id}`);
  assert.equal(saved.notes, patch.notes);
  assert.equal(saved.actions.length, 1);
  const overview = await read("/api/overview");
  assert.equal(
    (await read("/api/meetings?scope=upcoming")).total,
    overview.upcomingMeetings,
  );
  assert.equal(
    (await read("/api/meetings?scope=missing-notes")).total,
    overview.missingNotes,
  );
  assert.equal(
    (await read("/api/meetings?status=completed")).total,
    overview.completedMeetings,
  );
  const withActions = await read(
    "/api/meetings?scope=open-actions&pageSize=100",
  );
  let openActions = 0;
  for (const record of withActions.rows) {
    const detail = await read(`/api/meetings/${record.id}`);
    const open = detail.actions.filter(
      (a: { status: string }) => a.status === "open",
    );
    assert.ok(open.length > 0);
    openActions += open.length;
  }
  assert.equal(openActions, overview.openActions);
  assert.equal(
    (await read("/api/meetings?q=refinancing&tag=CFG")).rows.some(
      (m: { id: string }) => m.id === old.id,
    ),
    true,
  );
  const brief = await read(`/api/meetings/${id(7002)}/brief`);
  assert.equal(brief.previousWithPeople[0].id, old.id);
  assert.equal(brief.previousWithPeople[0].notes, patch.notes);
  assert.match(brief.simulation.label, /Fictional/);
  const same = {
    ...patch,
    version: saved.version,
    title: "Rescheduled synthetic conversation",
    startsAt: "2024-09-11T09:00:00Z",
  };
  const racing = await Promise.all([
    req(`/api/meetings/${old.id}`, "PATCH", same, auth),
    req(`/api/meetings/${old.id}`, "PATCH", same, auth),
  ]);
  assert.deepEqual(racing.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    (await read("/api/meetings?from=2024-09-11&to=2024-09-11")).rows[0].title,
    same.title,
  );
  const v = await read(`/api/meetings/${old.id}`);
  const failed = await req(
    `/api/meetings/${old.id}`,
    "PATCH",
    {
      ...same,
      version: v.version,
      notes: "Must roll back",
      actions: [
        {
          description: "Invalid owner",
          ownerId: id(201),
          dueOn: "2026-09-20",
          status: "open",
        },
      ],
    },
    auth,
  );
  assert.equal(failed.status, 400);
  assert.equal((await read(`/api/meetings/${old.id}`)).version, v.version);
  assert.equal((await read(`/api/meetings/${old.id}`)).notes, patch.notes);
  const limited = await login("viewer"),
    foreign = await login("other");
  assert.equal(
    (
      await req(
        `/api/meetings/${old.id}`,
        "PATCH",
        { ...same, version: v.version },
        limited,
      )
    ).status,
    403,
  );
  assert.equal(
    (await req(`/api/meetings/${old.id}/brief`, "GET", undefined, limited))
      .status,
    200,
  );
  assert.equal(
    (await req(`/api/meetings/${old.id}`, "GET", undefined, foreign)).status,
    404,
  );
  assert.equal(
    (await req(`/api/meetings/${old.id}/brief`, "GET", undefined, foreign))
      .status,
    404,
  );
  assert.equal(
    (await (await req("/api/overview", "GET", undefined, foreign)).json())
      .totalMeetings,
    0,
  );
  assert.equal(
    (await req("/api/meetings?from=2026-02-30", "GET", undefined, auth)).status,
    400,
  );
});
test("Home blocks use scoped records, current time, latest notes and personal ownership", async () => {
  const auth = await login("editor"),
    limited = await login("viewer"),
    foreign = await login("other");
  const fixture = async (
    n: number,
    status: string,
    offset: string,
    team = 11,
  ) => {
    await admin.query(
      "INSERT INTO meetings(org_id,id,team_id,company_id,title,starts_at,status) VALUES($1,$2,$3,$4,$5,now()+$6::interval,$7)",
      [id(1), id(n), id(team), id(1001), `Home fixture ${n}`, offset, status],
    );
  };
  await fixture(9201, "scheduled", "1 hour");
  await fixture(9202, "cancelled", "1 minute");
  await fixture(9203, "completed", "2 minutes");
  await fixture(9204, "scheduled", "-1 hour");
  await fixture(9205, "completed", "-2 hours");
  await fixture(9206, "scheduled", "30 minutes", 12);
  await admin.query(
    "INSERT INTO meeting_notes VALUES($1,$2,$3,1,'Old notes',$4,now()),($1,$2,$3,2,'   ',$4,now())",
    [id(1), id(11), id(9205), id(101)],
  );
  for (const [n, owner, due, status] of [
    [9301, 101, "2020-01-01", "open"],
    [9302, 101, "2099-01-01", "open"],
    [9303, 102, "2019-01-01", "open"],
    [9304, 101, "2018-01-01", "done"],
  ] as const)
    await admin.query(
      "INSERT INTO meeting_actions VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [id(1), id(11), id(9205), id(n), `Action ${n}`, id(owner), due, status],
    );
  const read = async (session: typeof auth) => {
    const response = await req("/api/home", "GET", undefined, session);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    return response.json();
  };
  const home = await read(auth);
  assert.equal(home.upcoming[0].id, id(9201));
  assert.ok(
    home.upcoming.every(
      (m: { id: string }) => ![9202, 9203, 9204, 9206].map(id).includes(m.id),
    ),
  );
  assert.ok(home.awaitingNotes.some((m: { id: string }) => m.id === id(9205)));
  assert.ok(!home.recent.some((m: { id: string }) => m.id === id(9206)));
  assert.ok(home.myActions.some((a: { id: string }) => a.id === id(9301)));
  assert.ok(home.myActions.some((a: { id: string }) => a.id === id(9302)));
  assert.ok(
    !home.myActions.some((a: { id: string }) =>
      [id(9303), id(9304)].includes(a.id),
    ),
  );
  assert.deepEqual(
    home.myActions.map((a: { dueOn: string }) => a.dueOn),
    home.myActions.map((a: { dueOn: string }) => a.dueOn).sort(),
  );
  const viewerHome = await read(limited);
  assert.deepEqual(
    viewerHome.myActions.map((a: { id: string }) => a.id),
    [id(9303)],
  );
  const otherHome = await read(foreign);
  assert.deepEqual(otherHome.totals, {
    upcoming: 0,
    myActions: 0,
    awaitingNotes: 0,
  });
  assert.deepEqual(otherHome.recent, []);
  await req(
    "/api/meetings?from=2000-01-01&to=2000-01-07",
    "GET",
    undefined,
    auth,
  );
  assert.deepEqual((await read(auth)).upcoming, home.upcoming);
  assert.equal(
    (await req(`/api/home?ownerId=${id(102)}`, "GET", undefined, auth)).status,
    400,
  );
  assert.equal((await handle(new Request(origin + "/api/home"))).status, 401);
  // Bounds must not turn the displayed subset into an invented total.
  for (let i = 0; i < 12; i++) {
    await fixture(9400 + i, "scheduled", `${i + 2} days`);
    await admin.query(
      "INSERT INTO meeting_actions VALUES($1,$2,$3,$4,$5,$6,$7,'open')",
      [
        id(1),
        id(11),
        id(9205),
        id(9500 + i),
        `Bounded action ${i}`,
        id(101),
        "2030-01-01",
      ],
    );
  }
  const bounded = await read(auth);
  assert.equal(bounded.upcoming.length, 5);
  assert.equal(bounded.myActions.length, 10);
  assert.equal(bounded.totals.upcoming, home.totals.upcoming + 12);
  assert.equal(bounded.totals.myActions, home.totals.myActions + 12);
  assert.equal(bounded.upcoming[0].id, id(9201));
});
test("synthetic Outlook import is explicit, idempotent and viewer denied", async () => {
  const auth = await login("editor"),
    limited = await login("viewer");
  assert.equal(
    (await req("/api/integrations/outlook/simulate", "POST", {}, limited))
      .status,
    403,
  );
  const responses = await Promise.all([
    req("/api/integrations/outlook/simulate", "POST", {}, auth),
    req("/api/integrations/outlook/simulate", "POST", {}, auth),
  ]);
  assert.deepEqual(
    responses.map((r) => r.status),
    [200, 200],
  );
  const values = await Promise.all(responses.map((r) => r.json()));
  assert.equal(values[0].meetingId, values[1].meetingId);
  const meeting = await (
    await req(`/api/meetings/${values[0].meetingId}`, "GET", undefined, auth)
  ).json();
  assert.equal(meeting.source, "outlook-demo");
  assert.equal(meeting.participants.length, 1);
});
test("runtime is non-owner/non-superuser and unscoped business reads deny all", async () => {
  const r = await pool.query(
    "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
  );
  assert.deepEqual(r.rows[0], { rolsuper: false, rolbypassrls: false });
  assert.equal(
    (await pool.query("SELECT count(*)::int n FROM contacts")).rows[0].n,
    0,
  );
  const policies = await admin.query(
    "SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='contacts'",
  );
  assert.equal(policies.rows[0].relforcerowsecurity, true);
});
test("runtime password cannot authenticate as the database owner", async () => {
  const cfg = JSON.parse(
    await readFile(new URL("../.local/runtime.json", import.meta.url), "utf8"),
  ) as { appUrl: string };
  const escalation = new URL(cfg.appUrl);
  escalation.username = "briefly_owner";
  const client = new pg.Client({
    connectionString: escalation.href,
    connectionTimeoutMillis: 3000,
  });
  try {
    await assert.rejects(client.connect(), { code: "28P01" });
  } finally {
    await client.end();
  }
});
test("server grid search, combined filters, pagination, sorting and organisation/team counts", async () => {
  const first = await (await req("/api/contacts?page=1&pageSize=10")).json();
  const second = await (await req("/api/contacts?page=2&pageSize=10")).json();
  assert.equal(first.total, 30);
  assert.equal(first.rows.length, 10);
  assert(
    !second.rows.some((r: { id: string }) =>
      first.rows.some((a: { id: string }) => a.id === r.id),
    ),
  );
  const filtered = await (
    await req(
      `/api/contacts?group=${id(8101)}&owner=${id(101)}&company=${id(1001)}&q=Elena&sort=company&direction=desc`,
    )
  ).json();
  assert.equal(filtered.total, 1);
  assert.equal(filtered.rows[0].id, id(3000));
  assert.equal(
    (await (await req("/api/contacts", "GET", undefined, other)).json()).total,
    3,
  );
  assert.equal((await req("/api/contacts?pageSize=101")).status, 400);
  assert.equal(
    (await req("/api/contacts?sort=name;DROP%20TABLE%20contacts")).status,
    400,
  );
  assert.equal((await (await req("/api/contacts?q=%25")).json()).total, 0);
});
test("guessed IDs, request workspace overrides and hidden-team profiles do not leak", async () => {
  for (const target of [id(3030), id(3033)])
    assert.equal((await req(`/api/contacts/${target}`)).status, 404);
  assert.equal((await req(`/api/companies/${id(2001)}`)).status, 404);
  assert.equal((await req(`/api/contacts?orgId=${id(2)}`)).status, 400);
  const lookup = await (await req("/api/lookups")).json();
  assert.equal(lookup.companies.length, 3);
  assert.equal(lookup.owners.length, 2);
  const spoof = await (
    await req("/api/contacts", "GET", undefined, editor, {
      "x-organisation-id": id(2),
    })
  ).json();
  assert.equal(spoof.total, 30);
});
test("session token is hashed, anonymous denied, cross-origin and missing CSRF writes denied", async () => {
  const hash = (await import("../src/lib/server/auth.ts")).digest(editor.token);
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int n FROM identity.sessions WHERE token_hash=$1",
        [hash],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (await handle(new Request(origin + "/api/contacts"))).status,
    401,
  );
  assert.equal(
    (
      await req(`/api/contacts/${id(3000)}`, "PATCH", {}, editor, {
        "x-csrf-token": "",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await req("/api/auth/demo", "POST", { persona: "editor" }, editor, {
        origin: "https://evil.invalid",
      })
    ).status,
    403,
  );
});
test("viewer cannot mutate through API or direct scoped SQL", async () => {
  assert.equal(
    (await req(`/api/contacts/${id(3000)}`, "PATCH", {}, viewer)).status,
    403,
  );
  const { scoped } = await import("../src/lib/server/db.ts");
  const n = await scoped(
    viewer.session,
    async (c) =>
      (
        await c.query("UPDATE contacts SET name=$1 WHERE org_id=$2 AND id=$3", [
          "Not allowed",
          id(1),
          id(3000),
        ])
      ).rowCount,
  );
  assert.equal(n, 0);
});
test("database composite foreign keys reject cross-organisation and mismatched employment links", async () => {
  await assert.rejects(
    admin.query(
      "INSERT INTO employments VALUES($1,$2,$3,$4,'Bad','2020-01-01','2020-12-31')",
      [id(1), id(9991), id(3000), id(2001)],
    ),
    { code: "23503" },
  );
  await assert.rejects(
    admin.query(
      "UPDATE meeting_contacts SET employment_id=$1 WHERE org_id=$2 AND meeting_id=$3 AND contact_id=$4",
      [id(5001), id(1), id(7001), id(3000)],
    ),
    { code: "23503" },
  );
  await assert.rejects(
    admin.query("UPDATE contacts SET owner_id=$1 WHERE org_id=$2 AND id=$3", [
      id(201),
      id(1),
      id(3000),
    ]),
    { code: "23503" },
  );
});
test("concurrent updates accept exactly one write, return conflict, increment once and audit once", async () => {
  const before = await (await req(`/api/contacts/${id(3000)}`)).json();
  const row = before.contact;
  const payload = {
    version: row.version,
    name: row.name,
    email: row.email,
    phone: row.phone,
    ownerId: row.ownerId,
  };
  const results = await Promise.all([
    req(`/api/contacts/${row.id}`, "PATCH", { ...payload, phone: "111" }),
    req(`/api/contacts/${row.id}`, "PATCH", { ...payload, phone: "222" }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const current = await (await req(`/api/contacts/${row.id}`)).json();
  assert.equal(current.contact.version, row.version + 1);
  const audit = await admin.query(
    "SELECT * FROM audit_events WHERE entity_id=$1 AND action='contact.updated'",
    [row.id],
  );
  assert.equal(audit.rowCount, 1);
  assert.equal(audit.rows[0].actor_id, id(101));
});
test("contact write rolls back if its audit event cannot be saved", async () => {
  const row = (await (await req(`/api/contacts/${id(3001)}`)).json()).contact;
  await admin.query(
    "CREATE FUNCTION reject_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit sink unavailable'; END $$; CREATE TRIGGER reject_test_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_test_audit()",
  );
  try {
    assert.equal(
      (
        await req(`/api/contacts/${row.id}`, "PATCH", {
          version: row.version,
          name: "Must roll back",
          email: row.email,
          phone: row.phone,
          ownerId: row.ownerId,
        })
      ).status,
      500,
    );
  } finally {
    await admin.query(
      "DROP TRIGGER reject_test_audit ON audit_events; DROP FUNCTION reject_test_audit()",
    );
  }
  const current = (await (await req(`/api/contacts/${row.id}`)).json()).contact;
  assert.equal(current.name, row.name);
  assert.equal(current.version, row.version);
});
test("create contact and meeting links two contacts and internal analyst in every profile", async () => {
  const response = await req("/api/contacts", "POST", {
    name: "Synthetic New Contact",
    email: "new@example.invalid",
    phone: "",
    ownerId: id(101),
    companyId: id(1001),
    title: "Investment Director",
    ratingGroupIds: [id(8102)],
  });
  assert.equal(response.status, 201);
  const row = await response.json();
  const meeting = await req("/api/meetings", "POST", {
    title: "Integration test meeting",
    companyId: id(1001),
    startsAt: new Date().toISOString(),
    contactIds: [row.id, id(3000)],
    internalMemberIds: [id(102)],
  });
  assert.equal(meeting.status, 201);
  const { id: meetingId } = await meeting.json();
  for (const contact of [row.id, id(3000)]) {
    const profile = await (await req(`/api/contacts/${contact}`)).json();
    const m = profile.meetings.find((m: { id: string }) => m.id === meetingId);
    assert.equal(m.participants.length, 2);
    assert.equal(m.internalParticipants[0].title, "Senior Credit Analyst");
  }
  const company = await (await req(`/api/companies/${id(1001)}`)).json();
  assert(company.meetings.some((m: { id: string }) => m.id === meetingId));
});
test("employment history survives company change; prior meeting title/company snapshots stay unchanged", async () => {
  const before = await (await req(`/api/contacts/${id(3000)}`)).json();
  for (const date of ["2026-02-30", "2099-01-01"])
    assert.equal(
      (
        await req(`/api/contacts/${id(3000)}/employment`, "POST", {
          version: before.contact.version,
          companyId: id(1003),
          title: "Director",
          startedOn: date,
        })
      ).status,
      400,
    );
  const response = await req(`/api/contacts/${id(3000)}/employment`, "POST", {
    version: before.contact.version,
    companyId: id(1003),
    title: "Director",
    startedOn: "2026-09-01",
  });
  assert.equal(response.status, 200);
  const after = await (await req(`/api/contacts/${id(3000)}`)).json();
  assert.equal(after.contact.companyId, id(1003));
  assert.equal(after.employments.length, 3);
  assert.deepEqual(after.meetings, before.meetings);
  const old = after.meetings.find((m: { id: string }) => m.id === id(7001));
  assert.equal(
    old.participants.find((p: { name: string }) => p.name === "Elena Brooks")
      .company,
    "Harbour Capital",
  );
  const midnight = await req("/api/meetings", "POST", {
    title: "London employment boundary",
    companyId: id(1003),
    startsAt: "2026-09-01T00:30:00+01:00",
    contactIds: [id(3000)],
    internalMemberIds: [],
  });
  assert.equal(midnight.status, 201);
  const meetingId = (await midnight.json()).id;
  const refreshed = await (await req(`/api/contacts/${id(3000)}`)).json();
  assert.equal(
    refreshed.meetings.find((m: { id: string }) => m.id === meetingId)
      .participants[0].company,
    "Summit Pension Trust",
  );
});
test("meeting with forbidden participant rolls back meeting and audit", async () => {
  const n = (await admin.query("SELECT count(*)::int n FROM meetings")).rows[0]
    .n;
  assert.equal(
    (
      await req("/api/meetings", "POST", {
        title: "Forbidden",
        companyId: id(1001),
        startsAt: new Date().toISOString(),
        contactIds: [id(3033)],
        internalMemberIds: [],
      })
    ).status,
    400,
  );
  assert.equal(
    (await admin.query("SELECT count(*)::int n FROM meetings")).rows[0].n,
    n,
  );
});
test("membership offboarding and idle expiry revoke access; logout and rotation invalidate old token", async () => {
  await admin.query(
    "UPDATE identity.memberships SET active=false WHERE org_id=$1 AND id=$2",
    [id(2), id(201)],
  );
  assert.equal(
    (await req("/api/contacts", "GET", undefined, other)).status,
    401,
  );
  await admin.query(
    "UPDATE identity.memberships SET active=true WHERE org_id=$1 AND id=$2",
    [id(2), id(201)],
  );
  const temp = await login("other");
  const hash = (await import("../src/lib/server/auth.ts")).digest(temp.token);
  await admin.query(
    "UPDATE identity.sessions SET last_seen_at=now()-interval '31 minutes' WHERE token_hash=$1",
    [hash],
  );
  assert.equal((await req("/api/session", "GET", undefined, temp)).status, 401);
  const rotated = await req(
    "/api/auth/demo",
    "POST",
    { persona: "viewer" },
    editor,
  );
  assert.equal(rotated.status, 200);
  assert.equal((await req("/api/session")).status, 401);
  assert.equal((await req("/api/auth/logout", "POST", {}, viewer)).status, 200);
  assert.equal(
    (await req("/api/session", "GET", undefined, viewer)).status,
    401,
  );
});
test("production synthetic login and previously issued synthetic sessions fail closed", async () => {
  const temp = await login("editor");
  Object.assign(process.env, { NODE_ENV: "production" });
  try {
    assert.equal(
      (await req("/api/auth/demo", "POST", { persona: "editor" }, temp)).status,
      403,
    );
    assert.equal(
      (await req("/api/session", "GET", undefined, temp)).status,
      503,
    );
  } finally {
    Object.assign(process.env, { NODE_ENV: "test" });
  }
});
test("connection-pool scope does not leak after queries or exceptions", async () => {
  assert.equal(
    (await pool.query("SELECT count(*)::int n FROM contacts")).rows[0].n,
    0,
  );
});

test("additive history fixtures preserve edits, seed once and expose separate person/company evidence", async () => {
  const before = await admin.query(
    "SELECT id,title,starts_at FROM meetings ORDER BY id",
  );
  await seedUnified(testAdminUrl);
  const once = await admin.query(
    "SELECT id,title,starts_at FROM meetings ORDER BY id",
  );
  await seedUnified(testAdminUrl);
  assert.deepEqual(
    (await admin.query("SELECT id,title,starts_at FROM meetings ORDER BY id"))
      .rows,
    once.rows,
  );
  for (const original of before.rows)
    assert.deepEqual(
      once.rows.find((r) => r.id === original.id),
      original,
    );
  const auth = await login("editor");
  const response = await req(
    `/api/meetings/${id(7002)}/brief`,
    "GET",
    undefined,
    auth,
  );
  assert.equal(response.status, 200);
  const brief = await response.json();
  assert.ok(
    brief.previousWithPeople.some((m: { id: string }) => m.id === id(7101)),
  );
  assert.ok(
    brief.relatedCompany.some((m: { id: string }) => m.id === id(7102)),
  );
  assert.ok(
    brief.previousWithPeople.some(
      (m: { actions: unknown[] }) => m.actions.length > 0,
    ),
  );
});

test("Home layouts are personal, versioned, validated and isolated by organisation and member", async () => {
  const ed = await login("editor"),
    vw = await login("viewer"),
    foreign = await login("other");
  const blocks = (order: string[], hidden: string[] = []) =>
    order.map((id) => ({ id, visible: !hidden.includes(id) }));
  const std = ["upcoming", "myActions", "awaitingNotes", "recent"];
  const swapped = ["myActions", "upcoming", "awaitingNotes", "recent"];
  const get = async (a: typeof ed) => {
    const r = await req("/api/home/layout", "GET", undefined, a);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("cache-control"), "no-store");
    return r.json();
  };
  const patch = (a: typeof ed, data: unknown, extra = {}) =>
    req("/api/home/layout", "PATCH", data, a, extra);
  assert.deepEqual(await get(ed), { version: 0, blocks: blocks(std) });
  assert.equal(
    (await req("/api/home/layout?x=1", "GET", undefined, ed)).status,
    400,
  );
  assert.equal(
    (await req("/api/home/layout", "GET", undefined, undefined)).status,
    401,
  );
  // First save creates version 1; a second create from "no layout" is a conflict.
  const first = await patch(ed, {
    version: 0,
    blocks: blocks(swapped, ["recent"]),
  });
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), {
    version: 1,
    blocks: blocks(swapped, ["recent"]),
  });
  assert.equal(
    (await patch(ed, { version: 0, blocks: blocks(std) })).status,
    409,
  );
  assert.deepEqual(await get(ed), {
    version: 1,
    blocks: blocks(swapped, ["recent"]),
  });
  // Stale update conflicts and changes nothing; the current version updates once.
  assert.equal(
    (await patch(ed, { version: 7, blocks: blocks(std) })).status,
    409,
  );
  assert.equal((await get(ed)).version, 1);
  const reset = await patch(ed, { version: 1, blocks: blocks(std) });
  assert.equal(reset.status, 200);
  assert.equal((await reset.json()).version, 2);
  // Viewers may personalise their own view only; other members keep theirs.
  assert.equal(
    (await patch(vw, { version: 0, blocks: blocks(swapped) })).status,
    200,
  );
  assert.deepEqual(await get(ed), { version: 2, blocks: blocks(std) });
  assert.deepEqual(await get(vw), { version: 1, blocks: blocks(swapped) });
  assert.deepEqual(await get(foreign), { version: 0, blocks: blocks(std) });
  assert.equal(
    (
      await patch(foreign, {
        version: 0,
        blocks: blocks(["recent", ...std.slice(0, 3)]),
      })
    ).status,
    200,
  );
  assert.deepEqual(await get(ed), { version: 2, blocks: blocks(std) });
  // Direct SQL under each scope sees only that member's row; unscoped reads see none.
  const { scoped } = await import("../src/lib/server/db.ts");
  for (const a of [ed, vw, foreign])
    assert.equal(
      await scoped(
        a.session,
        async (c) =>
          (await c.query("SELECT count(*)::int AS n FROM home_layouts")).rows[0]
            .n,
      ),
      1,
    );
  assert.equal(
    (await pool.query("SELECT count(*)::int AS n FROM home_layouts")).rows[0].n,
    0,
  );
  assert.equal(
    await scoped(
      ed.session,
      async (c) =>
        (
          await c.query(
            "UPDATE home_layouts SET version=99 WHERE membership_id<>$1",
            [ed.session.membership.id],
          )
        ).rowCount,
    ),
    0,
  );
  // Invalid payloads, missing CSRF and a foreign Origin are rejected without changing the row.
  const bad: unknown[] = [
    {},
    { version: 2 },
    { blocks: blocks(std) },
    { version: -1, blocks: blocks(std) },
    { version: 1.5, blocks: blocks(std) },
    { version: 2, blocks: blocks(std).slice(1) },
    { version: 2, blocks: [...blocks(std), { id: "recent", visible: true }] },
    {
      version: 2,
      blocks: blocks(["upcoming", "upcoming", "recent", "myActions"]),
    },
    { version: 2, blocks: blocks([...std.slice(0, 3), "admin"]) },
    { version: 2, blocks: blocks(std, std) },
    { version: 2, blocks: blocks(std).map((b) => ({ ...b, visible: "yes" })) },
    { version: 2, blocks: blocks(std).map((b) => ({ ...b, html: "<b>" })) },
    { version: 2, blocks: blocks(std), extra: true },
  ];
  for (const data of bad)
    assert.equal((await patch(ed, data)).status, 400, JSON.stringify(data));
  assert.equal(
    (
      await patch(
        ed,
        { version: 2, blocks: blocks(swapped) },
        { "x-csrf-token": "wrong" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await patch(
        ed,
        { version: 2, blocks: blocks(swapped) },
        { origin: "http://evil.example" },
      )
    ).status,
    403,
  );
  assert.deepEqual(await get(ed), { version: 2, blocks: blocks(std) });
  // Two concurrent saves from the same version: exactly one wins.
  const race = await Promise.all([
    patch(ed, { version: 2, blocks: blocks(swapped) }),
    patch(ed, { version: 2, blocks: blocks(std, ["recent"]) }),
  ]);
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await get(ed)).version, 3);
});
