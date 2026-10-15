import { useState, type ReactNode } from "react";
import type { SessionView } from "../lib/contracts";
import { useResource } from "./useResource";
import { parseHome } from "./home-response";
import { meetingDate, RouteLink } from "./UnifiedCommon";

function HomeBlock({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="u-card">
      <h2>{title}</h2>
      <p className="muted">{description}</p>
      {children}
    </section>
  );
}
function dueDate(value: string) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/London",
  });
}
export function HomeBlocks({
  session,
  revision,
  onExpired,
}: {
  session: SessionView;
  revision: number;
  onExpired: () => void;
}) {
  const [retry, setRetry] = useState(0);
  const resource = useResource(
    "/api/home",
    revision + retry,
    onExpired,
    parseHome,
  );
  if (resource.loading)
    return (
      <section className="u-card">
        <p role="status">Loading upcoming meetings and follow-ups…</p>
      </section>
    );
  if (resource.error)
    return (
      <section className="u-card">
        <p className="error" role="alert">
          {resource.error}
        </p>
        <button className="secondary" onClick={() => setRetry((n) => n + 1)}>
          Retry Home
        </button>
      </section>
    );
  const data = resource.value;
  if (!data) return null;
  return (
    <>
      <HomeBlock
        title="Upcoming meetings"
        description={`Next ${data.upcoming.length} of ${data.totals.upcoming} scheduled meetings in your accessible workspace, across all weeks.`}
      >
        {data.upcoming.map((m, index) => (
          <article className="home-item" key={m.id}>
            {index === 0 && <span className="tag">Next meeting</span>}
            <h3>
              <a href={`#meeting/${m.id}`}>{m.title}</a>
            </h3>
            <p>{m.company}</p>
            <small>{meetingDate(m.startsAt)}</small>
            <p>
              <RouteLink to={`brief/${m.id}`}>Open brief</RouteLink>
            </p>
          </article>
        ))}
        {!data.upcoming.length && (
          <p>
            {session.membership.role === "viewer"
              ? "No upcoming scheduled meetings. Browse Contacts or ask a team editor to add a meeting."
              : "No upcoming scheduled meetings. Browse Contacts or create a meeting to begin preparing."}
          </p>
        )}
        <RouteLink to="meetings?scope=upcoming">
          View upcoming meetings
        </RouteLink>
      </HomeBlock>
      <HomeBlock
        title="My follow-ups"
        description={`Open actions assigned to you, earliest due first. Showing ${data.myActions.length} of ${data.totals.myActions}.`}
      >
        {data.myActions.map((a) => (
          <article className="home-item" key={a.id}>
            <h3>
              <a href={`#meeting/${a.meetingId}`}>{a.description}</a>
            </h3>
            <p>
              {a.company} · {a.meetingTitle}
            </p>
            <span className="tag">
              {a.dueOn < data.today
                ? "Overdue"
                : a.dueOn === data.today
                  ? "Due today"
                  : "Due"}{" "}
              · {dueDate(a.dueOn)}
            </span>
          </article>
        ))}
        {!data.myActions.length && (
          <p>You have no open follow-ups assigned to you.</p>
        )}
        {data.totals.myActions > data.myActions.length && (
          <p className="muted">
            Your ten earliest due actions are shown. Open a meeting to update
            its actions.
          </p>
        )}
      </HomeBlock>
      <HomeBlock
        title="Meetings awaiting notes"
        description={`Completed meetings with no current notes in your accessible workspace. Showing ${data.awaitingNotes.length} of ${data.totals.awaitingNotes}.`}
      >
        {data.awaitingNotes.map((m) => (
          <article className="home-item" key={m.id}>
            <h3>
              <a href={`#meeting/${m.id}`}>{m.title}</a>
            </h3>
            <p>{m.company}</p>
            <small>{meetingDate(m.startsAt)}</small>
            <p>
              <RouteLink to={`meeting/${m.id}`}>
                {session.membership.role === "viewer"
                  ? "View meeting"
                  : "Add notes"}
              </RouteLink>
            </p>
          </article>
        ))}
        {!data.awaitingNotes.length && (
          <p>No completed meetings are awaiting notes.</p>
        )}
        <RouteLink to="meetings?scope=missing-notes">
          View meetings awaiting notes
        </RouteLink>
      </HomeBlock>
      <HomeBlock
        title="Recent meeting activity"
        description="The five most recently updated meeting records in your accessible workspace."
      >
        {data.recent.map((m) => (
          <article className="home-item" key={m.id}>
            <h3>
              <a href={`#meeting/${m.id}`}>{m.title}</a>
            </h3>
            <p>{m.company}</p>
            <small>Updated {meetingDate(m.updatedAt)}</small>
          </article>
        ))}
        {!data.recent.length && <p>No meeting records yet.</p>}
      </HomeBlock>
    </>
  );
}
