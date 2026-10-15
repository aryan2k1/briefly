import { randomUUID } from "node:crypto";
import { scoped, type Actor } from "./db.ts";
import { assertEditor } from "./auth.ts";
import { audit } from "./contacts.ts";
import { AppError } from "./errors.ts";

// This is an explicitly requested synthetic fixture, never a Graph connection.
export async function simulateOutlook(actor: Actor) {
  assertEditor(actor);
  return scoped(actor, async (c) => {
    const org = actor.organisation.id,
      team = actor.membership.teamId;
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `outlook-demo:${org}:${team}`,
    ]);
    const existing = await c.query(
      "SELECT id FROM meetings WHERE org_id=$1 AND team_id=$2 AND external_key='synthetic-outlook-example-v1'",
      [org, team],
    );
    if (existing.rowCount)
      return {
        meetingId: existing.rows[0].id,
        message:
          "Existing synthetic Outlook example opened. No real calendar was contacted and no duplicate was created.",
      };
    const synthetic = await c.query(
      "SELECT synthetic FROM identity.organisations WHERE id=$1",
      [org],
    );
    if (!synthetic.rows[0]?.synthetic)
      throw new AppError(403, "Synthetic organisation required");
    const contact = await c.query(
      `SELECT c.id,c.name,c.team_id,e.id AS employment_id,e.title,co.id AS company_id,co.name AS company FROM contacts c JOIN employments e ON e.org_id=c.org_id AND e.contact_id=c.id JOIN companies co ON co.org_id=e.org_id AND co.id=e.company_id WHERE c.org_id=$1 AND c.team_id=$2 AND e.ended_on IS NULL AND e.started_on<=CURRENT_DATE ORDER BY c.id LIMIT 1`,
      [org, team],
    );
    const p = contact.rows[0];
    if (!p)
      throw new AppError(
        400,
        "Create a contact with current employment before this demonstration",
      );
    const id = randomUUID();
    await c.query(
      `INSERT INTO meetings(org_id,id,team_id,company_id,title,starts_at,source,external_key) VALUES($1,$2,$3,$4,'Synthetic Outlook example: investor catch-up',now()+interval '2 days','outlook-demo','synthetic-outlook-example-v1')`,
      [org, id, team, p.company_id],
    );
    await c.query(
      "INSERT INTO meeting_contacts VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [org, team, id, p.id, p.employment_id, p.name, p.title, p.company],
    );
    await c.query(
      `INSERT INTO meeting_internal_participants SELECT m.org_id,m.team_id,$3,m.id,u.name,m.title FROM identity.memberships m JOIN identity.users u ON u.id=m.user_id WHERE m.org_id=$1 AND m.id=$2 AND m.active AND u.active`,
      [org, actor.membership.id, id],
    );
    await audit(c, actor, id, "meeting.outlook-demo-imported", 1);
    return {
      meetingId: id,
      message:
        "Synthetic Outlook example saved to this CRM. No Microsoft account, calendar or invitation was accessed.",
    };
  });
}
