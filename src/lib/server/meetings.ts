import { randomUUID } from "node:crypto";
import { scoped, type Actor } from "./db.ts";
import { assertEditor } from "./auth.ts";
import { fields, text, uuid } from "./validation.ts";
import { AppError } from "./errors.ts";
import { audit } from "./contacts.ts";
export async function createMeeting(actor: Actor, input: unknown) {
  assertEditor(actor);
  const f = fields(input, [
    "title",
    "companyId",
    "startsAt",
    "contactIds",
    "internalMemberIds",
  ]);
  const title = text(f.title, "Title", 200),
    company = uuid(f.companyId),
    start = text(f.startsAt, "Start time", 40);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(
      start,
    ) ||
    !Number.isFinite(Date.parse(start))
  )
    throw new AppError(
      400,
      "Meeting start needs a valid timestamp with timezone",
    );
  function ids(value: unknown) {
    if (!Array.isArray(value) || value.length > 50)
      throw new AppError(400, "Choose up to 50 participants");
    return [...new Set(value.map((v) => uuid(v)))];
  }
  const contacts = ids(f.contactIds),
    members = ids(f.internalMemberIds);
  if (!contacts.length) throw new AppError(400, "Choose at least one contact");
  return scoped(actor, async (c) => {
    if (
      !(
        await c.query("SELECT 1 FROM companies WHERE org_id=$1 AND id=$2", [
          actor.organisation.id,
          company,
        ])
      ).rowCount
    )
      throw new AppError(400, "Company unavailable");
    const id = randomUUID();
    await c.query(
      "INSERT INTO meetings(org_id,id,team_id,company_id,title,starts_at) VALUES($1,$2,$3,$4,$5,$6)",
      [
        actor.organisation.id,
        id,
        actor.membership.teamId,
        company,
        title,
        start,
      ],
    );
    for (const contact of contacts) {
      const r = await c.query(
        `INSERT INTO meeting_contacts SELECT c.org_id,c.team_id,$3,c.id,e.id,c.name,e.title,co.name
    FROM contacts c JOIN employments e ON e.org_id=c.org_id AND e.contact_id=c.id JOIN companies co ON co.org_id=e.org_id AND co.id=e.company_id
    WHERE c.org_id=$1 AND c.id=$2 AND c.team_id=$4 AND e.started_on<=($5::timestamptz AT TIME ZONE 'Europe/London')::date AND (e.ended_on IS NULL OR e.ended_on>=($5::timestamptz AT TIME ZONE 'Europe/London')::date)`,
        [actor.organisation.id, contact, id, actor.membership.teamId, start],
      );
      if (r.rowCount !== 1)
        throw new AppError(
          400,
          "A contact is unavailable or has no unambiguous employment at the meeting date",
        );
    }
    for (const member of members) {
      const r = await c.query(
        `INSERT INTO meeting_internal_participants SELECT m.org_id,m.team_id,$3,m.id,u.name,m.title FROM identity.memberships m JOIN identity.users u ON u.id=m.user_id WHERE m.org_id=$1 AND m.id=$2 AND m.team_id=$4 AND m.active AND u.active`,
        [actor.organisation.id, member, id, actor.membership.teamId],
      );
      if (!r.rowCount)
        throw new AppError(400, "An internal participant is unavailable");
    }
    await audit(c, actor, id, "meeting.created", 1);
    return { id };
  });
}
