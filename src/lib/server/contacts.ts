import { randomUUID } from "node:crypto";
import type pg from "pg";
import { scoped, type Actor } from "./db.ts";
import { AppError } from "./errors.ts";
import { assertEditor } from "./auth.ts";
import { fields, uuid, text, email, version } from "./validation.ts";
import type {
  ContactRow,
  ContactPage,
  ContactDetail,
  CompanyDetail,
  Lookups,
  MeetingSummary,
} from "../contracts.ts";

const projection = `c.id,c.name,c.email,c.phone,c.version,e.company_id AS "companyId",co.name AS company,e.title,
 c.owner_id AS "ownerId",u.name AS owner,t.name AS team,
 ARRAY(SELECT rg.code FROM contact_rating_groups cg JOIN rating_groups rg ON rg.org_id=cg.org_id AND rg.id=cg.rating_group_id WHERE cg.org_id=c.org_id AND cg.contact_id=c.id ORDER BY rg.code) AS "ratingGroups"`;
const joins = `FROM contacts c
 LEFT JOIN employments e ON e.org_id=c.org_id AND e.contact_id=c.id AND e.ended_on IS NULL
 LEFT JOIN companies co ON co.org_id=e.org_id AND co.id=e.company_id
 JOIN identity.memberships m ON m.org_id=c.org_id AND m.id=c.owner_id
 JOIN identity.users u ON u.id=m.user_id
 JOIN identity.teams t ON t.org_id=c.org_id AND t.id=c.team_id`;

function pageNumber(raw: string | null, fallback: number, max: number) {
  if (raw === null) return fallback;
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > max)
    throw new AppError(400, "Invalid pagination");
  return Number(raw);
}
export async function listContacts(
  actor: Actor,
  query: URLSearchParams,
): Promise<ContactPage> {
  const allowed = [
    "q",
    "group",
    "owner",
    "company",
    "page",
    "pageSize",
    "sort",
    "direction",
  ];
  if ([...query.keys()].some((k) => !allowed.includes(k)))
    throw new AppError(400, "Unknown contact filter");
  const page = pageNumber(query.get("page"), 1, 100000),
    pageSize = pageNumber(query.get("pageSize"), 10, 100);
  const q = text(query.get("q") ?? "", "Search", 200, false);
  const sort = query.get("sort") ?? "name",
    direction = query.get("direction") ?? "asc";
  if (
    !["name", "company", "owner"].includes(sort) ||
    !["asc", "desc"].includes(direction)
  )
    throw new AppError(400, "Invalid sort");
  const values: unknown[] = [actor.organisation.id],
    where = ["c.org_id=$1"];
  function param(value: unknown) {
    values.push(value);
    return `$${values.length}`;
  }
  if (q) {
    const p = param(`%${q.replace(/[\\%_]/g, "\\$&")}%`);
    where.push(
      `(c.name ILIKE ${p} OR c.email ILIKE ${p} OR co.name ILIKE ${p} OR u.name ILIKE ${p})`,
    );
  }
  if (query.get("group"))
    where.push(
      `EXISTS(SELECT 1 FROM contact_rating_groups f WHERE f.org_id=c.org_id AND f.contact_id=c.id AND f.rating_group_id=${param(uuid(query.get("group")))})`,
    );
  if (query.get("owner"))
    where.push(`c.owner_id=${param(uuid(query.get("owner")))}`);
  if (query.get("company"))
    where.push(`e.company_id=${param(uuid(query.get("company")))}`);
  const order = {
    name: "lower(c.name)",
    company: "lower(co.name)",
    owner: "lower(u.name)",
  }[sort as "name" | "company" | "owner"];
  return scoped(
    actor,
    async (client) => {
      // One snapshot keeps the page and its count consistent under concurrent writes.
      const count = await client.query(
        `SELECT count(*)::integer AS total ${joins} WHERE ${where.join(" AND ")}`,
        values,
      );
      const rows = await client.query<ContactRow>(
        `SELECT ${projection} ${joins} WHERE ${where.join(" AND ")} ORDER BY ${order} ${direction} NULLS LAST,c.id ASC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, pageSize, (page - 1) * pageSize],
      );
      return { rows: rows.rows, total: count.rows[0].total, page, pageSize };
    },
    true,
  );
}
async function contactRow(
  client: pg.PoolClient,
  org: string,
  id: string,
): Promise<ContactRow> {
  const result = await client.query<ContactRow>(
    `SELECT ${projection} ${joins} WHERE c.org_id=$1 AND c.id=$2`,
    [org, id],
  );
  if (!result.rows[0]) throw new AppError(404, "Contact not found");
  return result.rows[0];
}
async function meetingRows(
  client: pg.PoolClient,
  org: string,
  condition: string,
  id: string,
): Promise<MeetingSummary[]> {
  const result = await client.query<MeetingSummary>(
    `SELECT m.id,m.title,to_char(m.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "startsAt",
 COALESCE((SELECT json_agg(json_build_object('name',p.name_snapshot,'title',p.title_snapshot,'company',p.company_snapshot) ORDER BY p.name_snapshot) FROM meeting_contacts p WHERE p.org_id=m.org_id AND p.meeting_id=m.id),'[]') AS participants,
 COALESCE((SELECT json_agg(json_build_object('name',p.name_snapshot,'title',p.title_snapshot) ORDER BY p.name_snapshot) FROM meeting_internal_participants p WHERE p.org_id=m.org_id AND p.meeting_id=m.id),'[]') AS "internalParticipants"
 FROM meetings m WHERE m.org_id=$1 AND ${condition} ORDER BY m.starts_at DESC,m.id LIMIT 100`,
    [org, id],
  );
  return result.rows;
}
export async function getContact(
  actor: Actor,
  id: string,
): Promise<ContactDetail> {
  uuid(id);
  return scoped(actor, async (c) => {
    const contact = await contactRow(c, actor.organisation.id, id);
    const history = await c.query(
      `SELECT e.id,e.company_id AS "companyId",co.name AS company,e.title,to_char(e.started_on,'YYYY-MM-DD') AS "startedOn",to_char(e.ended_on,'YYYY-MM-DD') AS "endedOn" FROM employments e JOIN companies co ON co.org_id=e.org_id AND co.id=e.company_id WHERE e.org_id=$1 AND e.contact_id=$2 ORDER BY e.started_on DESC,e.id`,
      [actor.organisation.id, id],
    );
    const meetings = await meetingRows(
      c,
      actor.organisation.id,
      "EXISTS(SELECT 1 FROM meeting_contacts p WHERE p.org_id=m.org_id AND p.meeting_id=m.id AND p.contact_id=$2)",
      id,
    );
    return { contact, employments: history.rows, meetings };
  });
}
export async function getCompany(
  actor: Actor,
  id: string,
): Promise<CompanyDetail> {
  uuid(id);
  return scoped(actor, async (c) => {
    const company = await c.query(
      "SELECT id,name,sector FROM companies WHERE org_id=$1 AND id=$2",
      [actor.organisation.id, id],
    );
    if (!company.rows[0]) throw new AppError(404, "Company not found");
    const contacts = await c.query<ContactRow>(
      `SELECT ${projection} ${joins} WHERE c.org_id=$1 AND e.company_id=$2 ORDER BY c.name,c.id LIMIT 100`,
      [actor.organisation.id, id],
    );
    const meetings = await meetingRows(
      c,
      actor.organisation.id,
      "(m.company_id=$2 OR EXISTS(SELECT 1 FROM meeting_contacts p JOIN employments e ON e.org_id=p.org_id AND e.id=p.employment_id WHERE p.org_id=m.org_id AND p.meeting_id=m.id AND e.company_id=$2))",
      id,
    );
    return { ...company.rows[0], contacts: contacts.rows, meetings };
  });
}
export async function getLookups(actor: Actor): Promise<Lookups> {
  return scoped(actor, async (c) => {
    const companies = await c.query(
      "SELECT id,name FROM companies WHERE org_id=$1 ORDER BY name,id",
      [actor.organisation.id],
    );
    const owners = await c.query(
      `SELECT m.id,u.name FROM identity.memberships m JOIN identity.users u ON u.id=m.user_id WHERE m.org_id=$1 AND m.team_id=$2 AND m.active AND u.active ORDER BY u.name,m.id`,
      [actor.organisation.id, actor.membership.teamId],
    );
    const groups = await c.query(
      "SELECT id,code,name FROM rating_groups WHERE org_id=$1 ORDER BY code",
      [actor.organisation.id],
    );
    return {
      companies: companies.rows,
      owners: owners.rows,
      ratingGroups: groups.rows,
    };
  });
}
async function validOwner(
  c: pg.PoolClient,
  org: string,
  team: string,
  owner: string,
) {
  const r = await c.query(
    "SELECT 1 FROM identity.memberships m JOIN identity.users u ON u.id=m.user_id WHERE m.org_id=$1 AND m.team_id=$2 AND m.id=$3 AND m.active AND u.active",
    [org, team, owner],
  );
  if (!r.rowCount)
    throw new AppError(
      400,
      "Coverage owner must be an active member of this team",
    );
}
export async function audit(
  c: pg.PoolClient,
  actor: Actor,
  entityId: string,
  action: string,
  v: number,
  teamId = actor.membership.teamId,
) {
  await c.query(
    "INSERT INTO audit_events(org_id,id,team_id,actor_id,entity_id,action,version) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [
      actor.organisation.id,
      randomUUID(),
      teamId,
      actor.membership.id,
      entityId,
      action,
      v,
    ],
  );
}
export async function editContact(
  actor: Actor,
  id: string,
  input: unknown,
): Promise<ContactRow> {
  assertEditor(actor);
  uuid(id);
  const f = fields(input, ["version", "name", "email", "phone", "ownerId"]);
  const update = {
    version: version(f.version),
    name: text(f.name, "Name", 200),
    email: email(f.email),
    phone: text(f.phone, "Phone", 50, false),
    owner: uuid(f.ownerId, "Owner"),
  };
  return scoped(actor, async (c) => {
    const current = await c.query(
      "SELECT team_id FROM contacts WHERE org_id=$1 AND id=$2",
      [actor.organisation.id, id],
    );
    if (!current.rowCount) throw new AppError(404, "Contact not found");
    await validOwner(
      c,
      actor.organisation.id,
      current.rows[0].team_id,
      update.owner,
    );
    const changed = await c.query(
      "UPDATE contacts SET name=$3,email=$4,phone=$5,owner_id=$6,version=version+1,updated_at=now() WHERE org_id=$1 AND id=$2 AND version=$7 RETURNING version",
      [
        actor.organisation.id,
        id,
        update.name,
        update.email,
        update.phone,
        update.owner,
        update.version,
      ],
    );
    if (!changed.rowCount)
      throw new AppError(
        409,
        "Another user changed this contact. Reload before saving.",
      );
    await audit(
      c,
      actor,
      id,
      "contact.updated",
      changed.rows[0].version,
      current.rows[0].team_id,
    );
    return contactRow(c, actor.organisation.id, id);
  });
}
export async function createContact(
  actor: Actor,
  input: unknown,
): Promise<ContactRow> {
  assertEditor(actor);
  const f = fields(input, [
    "name",
    "email",
    "phone",
    "ownerId",
    "companyId",
    "title",
    "ratingGroupIds",
  ]);
  const name = text(f.name, "Name", 200),
    mail = email(f.email),
    phone = text(f.phone, "Phone", 50, false),
    owner = uuid(f.ownerId),
    company = uuid(f.companyId),
    title = text(f.title, "Title", 200);
  if (!Array.isArray(f.ratingGroupIds) || f.ratingGroupIds.length > 20)
    throw new AppError(400, "Choose up to 20 Ratings Groups");
  const groups = [...new Set(f.ratingGroupIds.map((v) => uuid(v)))];
  return scoped(actor, async (c) => {
    await validOwner(c, actor.organisation.id, actor.membership.teamId, owner);
    if (
      !(
        await c.query("SELECT 1 FROM companies WHERE org_id=$1 AND id=$2", [
          actor.organisation.id,
          company,
        ])
      ).rowCount
    )
      throw new AppError(400, "Company is unavailable");
    for (const group of groups)
      if (
        !(
          await c.query(
            "SELECT 1 FROM rating_groups WHERE org_id=$1 AND id=$2",
            [actor.organisation.id, group],
          )
        ).rowCount
      )
        throw new AppError(400, "Ratings Group is unavailable");
    const id = randomUUID();
    await c.query(
      "INSERT INTO contacts(org_id,id,team_id,owner_id,name,email,phone) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        actor.organisation.id,
        id,
        actor.membership.teamId,
        owner,
        name,
        mail,
        phone,
      ],
    );
    await c.query(
      "INSERT INTO employments(org_id,id,contact_id,company_id,title,started_on) VALUES($1,$2,$3,$4,$5,CURRENT_DATE)",
      [actor.organisation.id, randomUUID(), id, company, title],
    );
    for (const group of groups)
      await c.query("INSERT INTO contact_rating_groups VALUES($1,$2,$3)", [
        actor.organisation.id,
        id,
        group,
      ]);
    await audit(c, actor, id, "contact.created", 1);
    return contactRow(c, actor.organisation.id, id);
  });
}
export async function changeEmployment(
  actor: Actor,
  id: string,
  input: unknown,
) {
  assertEditor(actor);
  uuid(id);
  const f = fields(input, ["version", "companyId", "title", "startedOn"]);
  const v = version(f.version),
    company = uuid(f.companyId),
    title = text(f.title, "Title", 200);
  const date = text(f.startedOn, "Start date", 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date
  )
    throw new AppError(400, "Use a valid YYYY-MM-DD date");
  if (date > new Date().toISOString().slice(0, 10))
    throw new AppError(
      400,
      "Future employment changes are not supported; record the move when it takes effect",
    );
  return scoped(actor, async (c) => {
    await contactRow(c, actor.organisation.id, id);
    if (
      !(
        await c.query("SELECT 1 FROM companies WHERE org_id=$1 AND id=$2", [
          actor.organisation.id,
          company,
        ])
      ).rowCount
    )
      throw new AppError(400, "Company is unavailable");
    const old = await c.query(
      "SELECT started_on::text FROM employments WHERE org_id=$1 AND contact_id=$2 AND ended_on IS NULL",
      [actor.organisation.id, id],
    );
    if (old.rows[0] && date <= old.rows[0].started_on)
      throw new AppError(
        400,
        "New employment must start after the current employment",
      );
    const changed = await c.query(
      "UPDATE contacts SET version=version+1,updated_at=now() WHERE org_id=$1 AND id=$2 AND version=$3 RETURNING version,team_id",
      [actor.organisation.id, id, v],
    );
    if (!changed.rowCount)
      throw new AppError(
        409,
        "Contact changed; reload before changing employment",
      );
    await c.query(
      "UPDATE employments SET ended_on=$3::date-1 WHERE org_id=$1 AND contact_id=$2 AND ended_on IS NULL",
      [actor.organisation.id, id, date],
    );
    await c.query("INSERT INTO employments VALUES($1,$2,$3,$4,$5,$6,NULL)", [
      actor.organisation.id,
      randomUUID(),
      id,
      company,
      title,
      date,
    ]);
    await audit(
      c,
      actor,
      id,
      "employment.changed",
      changed.rows[0].version,
      changed.rows[0].team_id,
    );
    return contactRow(c, actor.organisation.id, id);
  });
}
