import pg from "pg";
import { fixtureId as id } from "../src/lib/fixture-ids.ts";

/** Adds new fictional conversations only. Never updates an existing record. */
export async function seedUnified(url: string) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(4319003)");
    const orgs = await c.query(
      "SELECT id,synthetic FROM identity.organisations",
    );
    if (orgs.rows.some((o) => !o.synthetic))
      throw new Error(
        "Refusing synthetic fixtures in a non-synthetic database",
      );
    if (!orgs.rows.some((o) => o.id === id(1))) {
      await c.query("COMMIT");
      return;
    }
    for (const example of [
      {
        key: 7101,
        contact: 3000,
        title: "Synthetic prior conversation: refinancing priorities",
        date: "2026-09-03T10:00:00Z",
        notes:
          "Fictional demonstration notes: the investor asked about refinancing pressure in lower-rated corporates, covenant flexibility and the impact of higher funding costs. Alex agreed to follow up with an approved sector summary.",
        tag: "CFG",
      },
      {
        key: 7102,
        contact: 3003,
        title: "Synthetic company-team conversation: bank funding",
        date: "2026-09-04T13:00:00Z",
        notes:
          "Fictional demonstration notes: another colleague from the same institution discussed bank funding, deposit stability and liquidity buffers. The team requested a separate FIG analyst discussion.",
        tag: "FIG",
      },
    ]) {
      if (
        (
          await c.query("SELECT 1 FROM meetings WHERE org_id=$1 AND id=$2", [
            id(1),
            id(example.key),
          ])
        ).rowCount
      )
        continue;
      const matches = await c.query(
        `SELECT c.id,c.name,e.id AS employment_id,e.title,co.id AS company_id,co.name AS company FROM contacts c JOIN employments e ON e.org_id=c.org_id AND e.contact_id=c.id JOIN companies co ON co.org_id=e.org_id AND co.id=e.company_id WHERE c.org_id=$1 AND c.id=$2 AND c.team_id=$3 AND e.started_on<=($4::timestamptz AT TIME ZONE 'Europe/London')::date AND (e.ended_on IS NULL OR e.ended_on>=($4::timestamptz AT TIME ZONE 'Europe/London')::date)`,
        [id(1), id(example.contact), id(11), example.date],
      );
      if (matches.rowCount !== 1) continue;
      const p = matches.rows[0];
      await c.query(
        "INSERT INTO meetings(org_id,id,team_id,company_id,title,starts_at,status) VALUES($1,$2,$3,$4,$5,$6,'completed')",
        [
          id(1),
          id(example.key),
          id(11),
          p.company_id,
          example.title,
          example.date,
        ],
      );
      await c.query(
        "INSERT INTO meeting_contacts VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          id(1),
          id(11),
          id(example.key),
          p.id,
          p.employment_id,
          p.name,
          p.title,
          p.company,
        ],
      );
      await c.query(
        `INSERT INTO meeting_internal_participants SELECT m.org_id,m.team_id,$2,m.id,u.name,m.title FROM identity.memberships m JOIN identity.users u ON u.id=m.user_id WHERE m.org_id=$1 AND m.id IN ($3,$4)`,
        [id(1), id(example.key), id(101), id(102)],
      );
      await c.query(
        "INSERT INTO meeting_notes(org_id,team_id,meeting_id,version,body,author_id) VALUES($1,$2,$3,1,$4,$5)",
        [id(1), id(11), id(example.key), example.notes, id(101)],
      );
      await c.query("INSERT INTO meeting_tags VALUES($1,$2,$3,$4)", [
        id(1),
        id(11),
        id(example.key),
        example.tag,
      ]);
      await c.query(
        "INSERT INTO meeting_actions VALUES($1,$2,$3,$4,$5,$6,'2026-09-17','open')",
        [
          id(1),
          id(11),
          id(example.key),
          id(example.key + 100),
          "Send the requested permitted sector summary (fictional action)",
          id(101),
        ],
      );
      await c.query(
        "INSERT INTO audit_events(org_id,id,team_id,actor_id,entity_id,action,version) VALUES($1,$2,$3,$4,$5,'fixture.unified-created',1)",
        [id(1), id(example.key + 200), id(11), id(101), id(example.key)],
      );
    }
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    await c.end();
  }
}
