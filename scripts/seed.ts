import pg from "pg";
import { fixtureId as id } from "../src/lib/fixture-ids.ts";
export async function seed(url: string) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(4319002)");
    const existing = await c.query(
      "SELECT id,synthetic FROM identity.organisations",
    );
    if (existing.rowCount) {
      if (existing.rows.some((r) => !r.synthetic))
        throw new Error("Refusing to seed a non-synthetic database");
      await c.query("COMMIT");
      return;
    }
    await c.query(
      "INSERT INTO identity.organisations VALUES($1,'Northstar Demo','#005eb8','disabled',true),($2,'Cedar Demo','#236b55','disabled',true)",
      [id(1), id(2)],
    );
    for (const [org, team, name] of [
      [1, 11, "Investor relationships"],
      [1, 12, "Restricted research"],
      [2, 21, "Cedar relationships"],
    ] as const)
      await c.query("INSERT INTO identity.teams VALUES($1,$2,$3)", [
        id(org),
        id(team),
        name,
      ]);
    for (const [org, member, team, role, name, title] of [
      [1, 101, 11, "editor", "Alex Morgan", "Relationship Manager"],
      [1, 102, 11, "viewer", "Jordan Patel", "Senior Credit Analyst"],
      [1, 103, 12, "editor", "Taylor Chen", "Research Director"],
      [2, 201, 21, "editor", "Sam Ellis", "Coverage Manager"],
    ] as const) {
      await c.query("INSERT INTO identity.users VALUES($1,$2,$3,true)", [
        id(member),
        `synthetic:${member}`,
        name,
      ]);
      await c.query(
        "INSERT INTO identity.memberships VALUES($1,$2,$2,$3,$4,$5,true)",
        [id(org), id(member), id(team), role, title],
      );
    }
    for (const [org, key, name, sector] of [
      [1, 1001, "Atlas Investment Partners", "Investment management"],
      [1, 1002, "Harbour Capital", "Investment management"],
      [1, 1003, "Summit Pension Trust", "Pension fund"],
      [2, 2001, "Cedar Institutional Partners", "Investment management"],
    ] as const)
      await c.query("INSERT INTO companies VALUES($1,$2,$3,$4)", [
        id(org),
        id(key),
        name,
        sector,
      ]);
    for (const org of [1, 2])
      for (const [n, code, name] of [
        [1, "CFG", "Corporate Finance"],
        [2, "FIG", "Financial Institutions"],
        [3, "SOV", "Sovereign"],
      ] as const)
        await c.query("INSERT INTO rating_groups VALUES($1,$2,$3,$4)", [
          id(org),
          id(org * 100 + n + 8000),
          code,
          name,
        ]);
    const first = [
      "Elena",
      "Marcus",
      "Priya",
      "Daniel",
      "Sofia",
      "Oliver",
      "Amara",
      "Hugo",
      "Nadia",
      "Felix",
    ];
    const last = ["Brooks", "Reed", "Shah", "Clarke"];
    for (let n = 0; n < 36; n++) {
      const org = n < 33 ? 1 : 2,
        team = n < 30 ? 11 : n < 33 ? 12 : 21,
        owner = n < 30 ? 101 : n < 33 ? 103 : 201,
        company = org === 1 ? 1001 + (n % 3) : 2001;
      await c.query(
        "INSERT INTO contacts(org_id,id,team_id,owner_id,name,email,phone) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          id(org),
          id(3000 + n),
          id(team),
          id(owner),
          `${first[n % 10]} ${last[Math.floor(n / 10)]}`,
          `contact${n}@example.invalid`,
          `+44 20 7946 ${String(n).padStart(4, "0")}`,
        ],
      );
      await c.query(
        "INSERT INTO employments VALUES($1,$2,$3,$4,$5,'2025-01-01',NULL)",
        [
          id(org),
          id(5000 + n),
          id(3000 + n),
          id(company),
          n % 2 ? "Portfolio Manager" : "Senior Investment Analyst",
        ],
      );
      await c.query("INSERT INTO contact_rating_groups VALUES($1,$2,$3)", [
        id(org),
        id(3000 + n),
        id(org * 100 + 1 + (n % 3) + 8000),
      ]);
    }
    await c.query(
      "INSERT INTO employments VALUES($1,$2,$3,$4,'Investment Analyst','2021-01-01','2024-12-31')",
      [id(1), id(6000), id(3000), id(1002)],
    );
    for (const [meeting, date, title] of [
      [7001, "2024-09-10T09:00:00Z", "Earlier credit outlook discussion"],
      [7002, "2026-09-16T10:00:00Z", "Upcoming portfolio and sector review"],
    ] as const) {
      await c.query(
        "INSERT INTO meetings(org_id,id,team_id,company_id,title,starts_at) VALUES($1,$2,$3,$4,$5,$6)",
        [
          id(1),
          id(meeting),
          id(11),
          id(meeting === 7001 ? 1002 : 1001),
          title,
          date,
        ],
      );
      for (const n of [0, 1])
        await c.query(
          "INSERT INTO meeting_contacts VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            id(1),
            id(11),
            id(meeting),
            id(3000 + n),
            id(meeting === 7001 && n === 0 ? 6000 : 5000 + n),
            `${first[n]} Brooks`,
            meeting === 7001 && n === 0
              ? "Investment Analyst"
              : n
                ? "Portfolio Manager"
                : "Senior Investment Analyst",
            meeting === 7001 || n === 1
              ? "Harbour Capital"
              : "Atlas Investment Partners",
          ],
        );
      for (const member of [101, 102])
        await c.query(
          "INSERT INTO meeting_internal_participants VALUES($1,$2,$3,$4,$5,$6)",
          [
            id(1),
            id(11),
            id(meeting),
            id(member),
            member === 101 ? "Alex Morgan" : "Jordan Patel",
            member === 101 ? "Relationship Manager" : "Senior Credit Analyst",
          ],
        );
    }
    await c.query("COMMIT");
  } catch (error) {
    await c.query("ROLLBACK");
    throw error;
  } finally {
    await c.end();
  }
}
if (import.meta.main) {
  if (!process.env.ADMIN_DATABASE_URL)
    throw new Error("ADMIN_DATABASE_URL required");
  await seed(process.env.ADMIN_DATABASE_URL);
  console.log("Synthetic fixtures seeded (existing data preserved)");
}
