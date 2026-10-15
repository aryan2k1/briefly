import type { HomeData, HomeMeeting } from "../home-contracts.ts";
import { scoped, type Actor } from "./db.ts";

const meetingFields = `m.id,m.title,co.name AS company,m.starts_at AS "startsAt",m.updated_at AS "updatedAt"`;
const meetingJoin = `FROM meetings m JOIN companies co ON co.org_id=m.org_id AND co.id=m.company_id`;
const upcoming = `m.status='scheduled' AND m.starts_at>=now()`;
const missingNotes = `m.status='completed' AND NOT EXISTS (
  SELECT 1 FROM meeting_notes n WHERE n.org_id=m.org_id AND n.meeting_id=m.id
  AND n.version=(SELECT max(nn.version) FROM meeting_notes nn WHERE nn.org_id=m.org_id AND nn.meeting_id=m.id)
  AND length(trim(n.body))>0)`;
function meeting(row: HomeMeeting): HomeMeeting {
  return {
    ...row,
    startsAt: new Date(row.startsAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

// No calendar filter or client-provided ownership: all blocks share one authorised snapshot.
export async function getHome(actor: Actor): Promise<HomeData> {
  return scoped(
    actor,
    async (c) => {
      const org = actor.organisation.id;
      const counts = await c.query(
        `SELECT
      to_char(now() AT TIME ZONE 'Europe/London','YYYY-MM-DD') AS today,
      count(*) FILTER(WHERE ${upcoming})::int AS upcoming,
      count(*) FILTER(WHERE ${missingNotes})::int AS "awaitingNotes"
      ${meetingJoin} WHERE m.org_id=$1`,
        [org],
      );
      const next = await c.query<HomeMeeting>(
        `SELECT ${meetingFields} ${meetingJoin} WHERE m.org_id=$1 AND ${upcoming} ORDER BY m.starts_at,m.id LIMIT 5`,
        [org],
      );
      const missing = await c.query<HomeMeeting>(
        `SELECT ${meetingFields} ${meetingJoin} WHERE m.org_id=$1 AND ${missingNotes} ORDER BY m.starts_at DESC,m.id LIMIT 5`,
        [org],
      );
      const recent = await c.query<HomeMeeting>(
        `SELECT ${meetingFields} ${meetingJoin} WHERE m.org_id=$1 ORDER BY m.updated_at DESC,m.id LIMIT 5`,
        [org],
      );
      const actionCount = await c.query(
        `SELECT count(*)::int AS total FROM meeting_actions a JOIN meetings m ON m.org_id=a.org_id AND m.id=a.meeting_id WHERE a.org_id=$1 AND a.owner_id=$2 AND a.status='open'`,
        [org, actor.membership.id],
      );
      const actions = await c.query(
        `SELECT a.id,a.meeting_id AS "meetingId",m.title AS "meetingTitle",co.name AS company,a.description,to_char(a.due_on,'YYYY-MM-DD') AS "dueOn"
      FROM meeting_actions a JOIN meetings m ON m.org_id=a.org_id AND m.id=a.meeting_id
      JOIN companies co ON co.org_id=m.org_id AND co.id=m.company_id
      WHERE a.org_id=$1 AND a.owner_id=$2 AND a.status='open'
      ORDER BY a.due_on ASC NULLS LAST,a.id LIMIT 10`,
        [org, actor.membership.id],
      );
      return {
        today: counts.rows[0].today,
        upcoming: next.rows.map(meeting),
        myActions: actions.rows,
        awaitingNotes: missing.rows.map(meeting),
        recent: recent.rows.map(meeting),
        totals: {
          upcoming: counts.rows[0].upcoming,
          myActions: actionCount.rows[0].total,
          awaitingNotes: counts.rows[0].awaitingNotes,
        },
      };
    },
    true,
  );
}
