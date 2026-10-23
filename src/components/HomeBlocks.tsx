import { useState, type ReactNode } from "react";
import type { SessionView } from "../lib/contracts";
import {
  defaultHomeBlocks,
  type HomeBlockId,
  type HomeData,
  type HomeLayout,
  type HomeLayoutBlock,
} from "../lib/home-contracts";
import { ApiError, errorMessage, request, unauthorized } from "./api";
import { useResource } from "./useResource";
import { parseHome, parseHomeLayout } from "./home-response";
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
const blockTitles: Record<HomeBlockId, string> = {
  upcoming: "Upcoming meetings",
  myActions: "My follow-ups",
  awaitingNotes: "Meetings awaiting notes",
  recent: "Recent meeting activity",
};
function renderBlock(
  id: HomeBlockId,
  data: HomeData,
  session: SessionView,
): ReactNode {
  switch (id) {
    case "upcoming":
      return (
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
      );
    case "myActions":
      return (
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
      );
    case "awaitingNotes":
      return (
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
      );
    case "recent":
      return (
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
      );
  }
}
function moved(blocks: HomeLayoutBlock[], index: number, by: number) {
  const next = [...blocks],
    target = index + by;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
function LayoutEditor({
  session,
  layout,
  onSaved,
  onClose,
  onStale,
}: {
  session: SessionView;
  layout: HomeLayout;
  onSaved: (layout: HomeLayout) => void;
  onClose: () => void;
  onStale: () => void;
}) {
  const [draft, setDraft] = useState(layout.blocks);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState(false);
  const save = async (blocks: HomeLayoutBlock[]) => {
    setSaving(true);
    setMessage("");
    try {
      const saved = await request("/api/home/layout", parseHomeLayout, {
        method: "PATCH",
        body: { version: layout.version, blocks },
        csrfToken: session.csrfToken,
      });
      onSaved(saved);
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) setConflict(true);
      else if (unauthorized(error)) onStale();
      else setMessage(errorMessage(error));
      setSaving(false);
    }
  };
  const visibleCount = draft.filter((b) => b.visible).length;
  return (
    <section className="u-card" aria-labelledby="layout-heading">
      <h2 id="layout-heading">Customise Home</h2>
      <p className="muted">
        Reorder or hide blocks. This changes only your own view; the records
        shown are unaffected.
      </p>
      <ol className="layout-list">
        {draft.map((b, index) => (
          <li key={b.id} className="layout-row">
            <span>
              {blockTitles[b.id]}
              {!b.visible && <span className="tag"> Hidden</span>}
            </span>
            <button
              className="secondary"
              disabled={saving || index === 0}
              aria-label={`Move ${blockTitles[b.id]} up`}
              onClick={() => setDraft(moved(draft, index, -1))}
            >
              Up
            </button>
            <button
              className="secondary"
              disabled={saving || index === draft.length - 1}
              aria-label={`Move ${blockTitles[b.id]} down`}
              onClick={() => setDraft(moved(draft, index, 1))}
            >
              Down
            </button>
            <button
              className="secondary"
              disabled={saving || (b.visible && visibleCount === 1)}
              aria-pressed={b.visible}
              aria-label={`${b.visible ? "Hide" : "Show"} ${blockTitles[b.id]}`}
              onClick={() =>
                setDraft(
                  draft.map((x) =>
                    x.id === b.id ? { ...x, visible: !x.visible } : x,
                  ),
                )
              }
            >
              {b.visible ? "Hide" : "Show"}
            </button>
          </li>
        ))}
      </ol>
      <div role="status">
        {saving && "Saving layout…"}
        {message && <span className="error">{message}</span>}
        {conflict && (
          <span className="error">
            Your layout was changed elsewhere. Reload the saved layout, then
            repeat your change.{" "}
            <button className="secondary" onClick={onStale}>
              Reload layout
            </button>
          </span>
        )}
      </div>
      <p>
        <button disabled={saving || conflict} onClick={() => save(draft)}>
          Save layout
        </button>{" "}
        <button
          className="secondary"
          disabled={saving || conflict}
          onClick={() => save(defaultHomeBlocks())}
        >
          Reset to default
        </button>{" "}
        <button className="secondary" disabled={saving} onClick={onClose}>
          Cancel
        </button>
      </p>
    </section>
  );
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
  const [layoutRetry, setLayoutRetry] = useState(0);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState<HomeLayout | null>(null);
  const resource = useResource(
    "/api/home",
    revision + retry,
    onExpired,
    parseHome,
  );
  const layoutResource = useResource(
    "/api/home/layout",
    `${revision}:${layoutRetry}`,
    onExpired,
    parseHomeLayout,
  );
  if (resource.loading || layoutResource.loading)
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
  // A layout that fails to load must not hide the records: fall back to the default order.
  const layout: HomeLayout = saved ??
    layoutResource.value ?? { version: 0, blocks: defaultHomeBlocks() };
  return (
    <>
      {layoutResource.error && (
        <section className="u-card">
          <p className="error" role="alert">
            Your saved layout could not be loaded, so the default is shown.
          </p>
        </section>
      )}
      {editing ? (
        <LayoutEditor
          session={session}
          layout={layout}
          onSaved={setSaved}
          onClose={() => setEditing(false)}
          onStale={() => {
            setSaved(null);
            setEditing(false);
            setLayoutRetry((n) => n + 1);
          }}
        />
      ) : (
        !layoutResource.error && (
          <p>
            <button className="secondary" onClick={() => setEditing(true)}>
              Customise Home
            </button>
          </p>
        )
      )}
      {layout.blocks
        .filter((b) => b.visible)
        .map((b) => (
          <div key={b.id}>{renderBlock(b.id, data, session)}</div>
        ))}
    </>
  );
}
