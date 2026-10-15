import { randomUUID } from "node:crypto";
import type pg from "pg";
import type {
  MeetingRow,
  MeetingPage,
  MeetingDetail,
  Overview,
  MeetingBrief,
} from "../contracts.ts";
import { scoped, type Actor } from "./db.ts";
import { assertEditor } from "./auth.ts";
import { audit } from "./contacts.ts";
import { AppError } from "./errors.ts";
import { fields, text, uuid, version } from "./validation.ts";

const projection = `m.id,m.title,m.starts_at AS "startsAt",m.timezone AS "timeZone",m.company_id AS "companyId",co.name AS company,m.version,m.status,m.source,
 ARRAY(SELECT tag FROM meeting_tags t WHERE t.org_id=m.org_id AND t.meeting_id=m.id ORDER BY tag) AS tags,
 (SELECT count(*)::int FROM meeting_contacts p WHERE p.org_id=m.org_id AND p.meeting_id=m.id) AS "participantCount"`;
const joined = `FROM meetings m JOIN companies co ON co.org_id=m.org_id AND co.id=m.company_id`;
function row(r: MeetingRow): MeetingRow {
  return { ...r, startsAt: new Date(r.startsAt).toISOString() };
}
function date(value: unknown, label: string) {
  const result = text(value, label, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(result) ||
    !Number.isFinite(Date.parse(result)) ||
    new Date(result).toISOString().slice(0, 10) !== result
  )
    throw new AppError(400, `${label} must be a valid date`);
  return result;
}
function timestamp(value: unknown) {
  const result = text(value, "Start time", 40);
  date(result.slice(0, 10), "Start date");
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(
      result,
    ) ||
    !Number.isFinite(Date.parse(result))
  )
    throw new AppError(400, "Start time needs a valid timezone timestamp");
  return result;
}
function pageValue(raw: string | null, fallback: number, max: number) {
  if (raw === null) return fallback;
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > max)
    throw new AppError(400, "Invalid pagination");
  return Number(raw);
}
export async function listMeetings(
  actor: Actor,
  query: URLSearchParams,
): Promise<MeetingPage> {
  if (
    [...query.keys()].some(
      (k) =>
        ![
          "q",
          "from",
          "to",
          "status",
          "tag",
          "scope",
          "page",
          "pageSize",
        ].includes(k),
    )
  )
    throw new AppError(400, "Unknown meeting filter");
  const page = pageValue(query.get("page"), 1, 100000),
    pageSize = pageValue(query.get("pageSize"), 10, 100);
  const values: unknown[] = [actor.organisation.id],
    where = ["m.org_id=$1"];
  const param = (v: unknown) => {
    values.push(v);
    return `$${values.length}`;
  };
  const q = text(query.get("q") ?? "", "Search", 200, false);
  if (q) {
    const p = param(`%${q.replace(/[\\%_]/g, "\\$&")}%`);
    where.push(
      `(m.title ILIKE ${p} OR co.name ILIKE ${p} OR EXISTS(SELECT 1 FROM meeting_notes n WHERE n.org_id=m.org_id AND n.meeting_id=m.id AND n.version=(SELECT max(nn.version) FROM meeting_notes nn WHERE nn.org_id=m.org_id AND nn.meeting_id=m.id) AND n.body ILIKE ${p}))`,
    );
  }
  const from = query.get("from"),
    to = query.get("to");
  if (from)
    where.push(
      `m.starts_at>=(${param(date(from, "From"))}::date::timestamp AT TIME ZONE 'Europe/London')`,
    );
  if (to)
    where.push(
      `m.starts_at<((${param(date(to, "To"))}::date+1)::timestamp AT TIME ZONE 'Europe/London')`,
    );
  if (from && to && from > to)
    throw new AppError(400, "Date range is reversed");
  const status = query.get("status");
  if (status) {
    if (!["scheduled", "completed", "cancelled"].includes(status))
      throw new AppError(400, "Invalid meeting status");
    where.push(`m.status=${param(status)}`);
  }
  const tag = query.get("tag");
  const scope = query.get("scope");
  if (scope) {
    if (scope === "upcoming")
      where.push("m.status='scheduled' AND m.starts_at>=now()");
    else if (scope === "open-actions")
      where.push(
        "EXISTS(SELECT 1 FROM meeting_actions a WHERE a.org_id=m.org_id AND a.meeting_id=m.id AND a.status='open')",
      );
    else if (scope === "missing-notes")
      where.push(
        "m.status='completed' AND NOT EXISTS(SELECT 1 FROM meeting_notes n WHERE n.org_id=m.org_id AND n.meeting_id=m.id AND n.version=(SELECT max(nn.version) FROM meeting_notes nn WHERE nn.org_id=m.org_id AND nn.meeting_id=m.id) AND length(trim(n.body))>0)",
      );
    else throw new AppError(400, "Unknown meeting scope");
  }
  if (tag)
    where.push(
      `EXISTS(SELECT 1 FROM meeting_tags t WHERE t.org_id=m.org_id AND t.meeting_id=m.id AND t.tag=${param(text(tag, "Tag", 30))})`,
    );
  return scoped(
    actor,
    async (c) => {
      const total = await c.query(
        `SELECT count(*)::int AS total ${joined} WHERE ${where.join(" AND ")}`,
        values,
      );
      const rows = await c.query<MeetingRow>(
        `SELECT ${projection} ${joined} WHERE ${where.join(" AND ")} ORDER BY m.starts_at,m.id LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, pageSize, (page - 1) * pageSize],
      );
      return {
        rows: rows.rows.map(row),
        total: total.rows[0].total,
        page,
        pageSize,
      };
    },
    true,
  );
}
async function detail(
  c: pg.PoolClient,
  org: string,
  id: string,
): Promise<MeetingDetail> {
  const result = await c.query<MeetingRow & { updatedAt: Date }>(
    `SELECT ${projection},m.updated_at AS "updatedAt" ${joined} WHERE m.org_id=$1 AND m.id=$2`,
    [org, id],
  );
  const m = result.rows[0];
  if (!m) throw new AppError(404, "Meeting not found");
  const notes = await c.query(
    "SELECT body FROM meeting_notes WHERE org_id=$1 AND meeting_id=$2 ORDER BY version DESC LIMIT 1",
    [org, id],
  );
  const participants = await c.query(
    `SELECT contact_id AS "contactId",name_snapshot AS name,title_snapshot AS title,company_snapshot AS company FROM meeting_contacts WHERE org_id=$1 AND meeting_id=$2 ORDER BY name_snapshot`,
    [org, id],
  );
  const internal = await c.query(
    `SELECT membership_id AS "membershipId",name_snapshot AS name,title_snapshot AS title FROM meeting_internal_participants WHERE org_id=$1 AND meeting_id=$2 ORDER BY name_snapshot`,
    [org, id],
  );
  const actions = await c.query(
    `SELECT a.id,a.description,a.owner_id AS "ownerId",u.name AS owner,to_char(a.due_on,'YYYY-MM-DD') AS "dueOn",a.status FROM meeting_actions a JOIN identity.memberships mem ON mem.org_id=a.org_id AND mem.id=a.owner_id JOIN identity.users u ON u.id=mem.user_id WHERE a.org_id=$1 AND a.meeting_id=$2 ORDER BY a.due_on,a.id`,
    [org, id],
  );
  return {
    ...row(m),
    updatedAt: m.updatedAt.toISOString(),
    notes: notes.rows[0]?.body ?? "",
    participants: participants.rows,
    internalParticipants: internal.rows,
    actions: actions.rows,
  };
}
export async function getMeeting(actor: Actor, id: string) {
  uuid(id);
  return scoped(actor, (c) => detail(c, actor.organisation.id, id), true);
}

export async function editMeeting(actor: Actor, id: string, input: unknown) {
  assertEditor(actor);
  uuid(id);
  const f = fields(input, [
    "version",
    "title",
    "startsAt",
    "status",
    "notes",
    "tags",
    "actions",
  ]);
  const expected = version(f.version),
    title = text(f.title, "Title", 200),
    start = timestamp(f.startsAt),
    notes = text(f.notes, "Notes", 8000, false);
  if (!["scheduled", "completed", "cancelled"].includes(String(f.status)))
    throw new AppError(400, "Invalid meeting status");
  if (!Array.isArray(f.tags) || f.tags.length > 12)
    throw new AppError(400, "Choose up to 12 tags");
  const tags = [...new Set(f.tags.map((t) => text(t, "Tag", 30)))];
  if (!Array.isArray(f.actions) || f.actions.length > 20)
    throw new AppError(400, "Choose up to 20 actions");
  const actions = f.actions.map((a) => {
    const v = fields(a, ["id", "description", "ownerId", "dueOn", "status"]);
    if (!["open", "done"].includes(String(v.status)))
      throw new AppError(400, "Invalid action status");
    return {
      id: v.id === undefined ? randomUUID() : uuid(v.id),
      description: text(v.description, "Action", 500),
      owner: uuid(v.ownerId),
      due: date(v.dueOn, "Due date"),
      status: v.status,
    };
  });
  if (new Set(actions.map((a) => a.id)).size !== actions.length)
    throw new AppError(400, "Duplicate action identifier");
  return scoped(actor, async (c) => {
    const org = actor.organisation.id;
    const current = await c.query(
      "SELECT team_id FROM meetings WHERE org_id=$1 AND id=$2",
      [org, id],
    );
    if (!current.rowCount) throw new AppError(404, "Meeting not found");
    const team = current.rows[0].team_id;
    const result = await c.query(
      "UPDATE meetings SET title=$3,starts_at=$4,status=$5,version=version+1,updated_at=now() WHERE org_id=$1 AND id=$2 AND version=$6 RETURNING version",
      [org, id, title, start, f.status, expected],
    );
    if (!result.rowCount)
      throw new AppError(409, "Meeting changed. Reload before saving.");
    const next = result.rows[0].version;
    await c.query(
      "INSERT INTO meeting_notes(org_id,team_id,meeting_id,version,body,author_id) VALUES($1,$2,$3,$4,$5,$6)",
      [org, team, id, next, notes, actor.membership.id],
    );
    await c.query(
      "DELETE FROM meeting_tags WHERE org_id=$1 AND meeting_id=$2",
      [org, id],
    );
    for (const tag of tags)
      await c.query("INSERT INTO meeting_tags VALUES($1,$2,$3,$4)", [
        org,
        team,
        id,
        tag,
      ]);
    await c.query(
      "DELETE FROM meeting_actions WHERE org_id=$1 AND meeting_id=$2",
      [org, id],
    );
    for (const a of actions) {
      const owner = await c.query(
        "SELECT 1 FROM identity.memberships m JOIN identity.users u ON u.id=m.user_id WHERE m.org_id=$1 AND m.team_id=$2 AND m.id=$3 AND m.active AND u.active",
        [org, team, a.owner],
      );
      if (!owner.rowCount) throw new AppError(400, "Action owner unavailable");
      await c.query(
        "INSERT INTO meeting_actions VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [org, team, id, a.id, a.description, a.owner, a.due, a.status],
      );
    }
    await audit(c, actor, id, "meeting.updated", next);
    return { id, version: next };
  });
}

export async function getOverview(actor: Actor): Promise<Overview> {
  return scoped(
    actor,
    async (c) => {
      const org = actor.organisation.id;
      const result = await c.query(
        `SELECT count(*)::int AS "totalMeetings",count(*) FILTER(WHERE status='completed')::int AS "completedMeetings",count(*) FILTER(WHERE status='scheduled' AND starts_at>=now())::int AS "upcomingMeetings",count(*) FILTER(WHERE status='completed' AND NOT EXISTS(SELECT 1 FROM meeting_notes n WHERE n.org_id=m.org_id AND n.meeting_id=m.id AND n.version=(SELECT max(nn.version) FROM meeting_notes nn WHERE nn.org_id=m.org_id AND nn.meeting_id=m.id) AND length(trim(n.body))>0))::int AS "missingNotes" FROM meetings m WHERE org_id=$1`,
        [org],
      );
      const contacts = await c.query(
        "SELECT count(*)::int AS count FROM contacts WHERE org_id=$1",
        [org],
      );
      const actions = await c.query(
        "SELECT count(*)::int AS count FROM meeting_actions WHERE org_id=$1 AND status='open'",
        [org],
      );
      const themes = await c.query(
        "SELECT tag,count(*)::int AS count FROM meeting_tags WHERE org_id=$1 GROUP BY tag ORDER BY count(*) DESC,tag",
        [org],
      );
      const recent = await c.query<MeetingRow>(
        `SELECT ${projection} ${joined} WHERE m.org_id=$1 ORDER BY m.updated_at DESC,m.id LIMIT 8`,
        [org],
      );
      return {
        ...result.rows[0],
        contacts: contacts.rows[0].count,
        openActions: actions.rows[0].count,
        themes: themes.rows,
        recent: recent.rows.map(row),
      };
    },
    true,
  );
}

export async function getBrief(
  actor: Actor,
  id: string,
): Promise<MeetingBrief> {
  uuid(id);
  return scoped(
    actor,
    async (c) => {
      const org = actor.organisation.id,
        meeting = await detail(c, org, id);
      const previousWithPeople: MeetingDetail[] = [],
        relatedCompany: MeetingDetail[] = [];
      const samePerson = `EXISTS(SELECT 1 FROM meeting_contacts p JOIN meeting_contacts target ON target.org_id=p.org_id AND target.contact_id=p.contact_id WHERE p.org_id=m.org_id AND p.meeting_id=m.id AND target.meeting_id=$2)`;
      // Independently bound both buckets: company activity must not hide the last person conversation.
      for (const people of [true, false]) {
        const history = await c.query<{ id: string }>(
          `SELECT m.id FROM meetings m WHERE m.org_id=$1 AND m.id<>$2 AND m.starts_at<$3 AND m.starts_at<=now() AND m.status='completed' AND ${people ? samePerson : `m.company_id=$4 AND NOT ${samePerson}`} ORDER BY m.starts_at DESC,m.id LIMIT 20`,
          people
            ? [org, id, meeting.startsAt]
            : [org, id, meeting.startsAt, meeting.companyId],
        );
        for (const item of history.rows)
          (people ? previousWithPeople : relatedCompany).push(
            await detail(c, org, item.id),
          );
      }
      return {
        meeting,
        previousWithPeople,
        relatedCompany,
        generatedAt: new Date().toISOString(),
        simulation: {
          label:
            "Fictional MCP/news demonstration. No external data retrieved; these are not recent real news reports.",
          signals: [
            {
              headline: `Illustrative sector watch for ${meeting.company}`,
              detail:
                "Example briefing layout: refinancing conditions and investor questions. This fictional signal is not evidence about the company.",
              source: "Synthetic fixture, not Moody's MCP",
              publishedAt: "2026-09-01T09:00:00.000Z",
            },
          ],
        },
      };
    },
    true,
  );
}
