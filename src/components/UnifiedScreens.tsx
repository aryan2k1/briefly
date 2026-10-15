import { useEffect, useRef, useState, type FormEvent } from "react";
import type { SessionView } from "@/lib/contracts";
import { useResource } from "./useResource";
import { HomeBlocks } from "./HomeBlocks";
import {
  parseMeetingPage,
  parseOverview,
  parseSimulatedImport,
} from "./unified-response";
import { request, errorMessage, unauthorized } from "./api";
import { MeetingCard, RouteLink, ScreenHead } from "./UnifiedCommon";

export type UnifiedProps = {
  session: SessionView;
  revision: number;
  onExpired: () => void;
  onChanged: (message: string) => void;
};
export function londonDay(value: Date) {
  return value.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}
export function firstWeek() {
  const value = new Date(`${londonDay(new Date())}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
  return value.toISOString().slice(0, 10);
}
export function moveDay(day: string, amount: number) {
  const value = new Date(`${day}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}
function LoadState({ loading, error }: { loading: boolean; error?: string }) {
  return (
    <>
      {loading && (
        <p className="empty" role="status">
          Loading authorised meeting records…
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
export function CalendarScreen({
  week,
  setWeek,
  ...props
}: UnifiedProps & { week: string; setWeek: (value: string) => void }) {
  const [page, setPage] = useState(1);
  const query = new URLSearchParams({
    from: week,
    to: moveDay(week, 6),
    page: String(page),
    pageSize: "100",
  });
  const resource = useResource(
    `/api/meetings?${query}`,
    props.revision,
    props.onExpired,
    parseMeetingPage,
  );
  const rows = resource.value?.rows ?? [];
  const change = (amount: number) => {
    setPage(1);
    setWeek(moveDay(week, amount));
  };
  return (
    <>
      <ScreenHead
        label="Workspace"
        title="Home"
        text="Your upcoming meetings, preparation and follow-ups."
      >
        {props.session.membership.role !== "viewer" && (
          <RouteLink to="meetings/new" primary>
            New meeting
          </RouteLink>
        )}
        <RouteLink to="contacts">Find a contact</RouteLink>
      </ScreenHead>
      <div className="calendar-layout home-layout">
        <section className="u-card calendar-card">
          <div className="section-heading">
            <div>
              <h2>Calendar</h2>
              <small>
                {new Date(`${week}T12:00:00Z`).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}{" "}
                · London time
              </small>
            </div>
            <div className="week-controls">
              <button
                className="secondary"
                aria-label="Previous week"
                onClick={() => change(-7)}
              >
                ←
              </button>
              <button
                className="secondary"
                onClick={() => {
                  setPage(1);
                  setWeek(firstWeek());
                }}
              >
                This week
              </button>
              <button
                className="secondary"
                aria-label="Next week"
                onClick={() => change(7)}
              >
                →
              </button>
            </div>
          </div>
          <LoadState {...resource} />
          {resource.value && (
            <>
              <div className="calendar-week">
                {Array.from({ length: 7 }, (_, i) => {
                  const day = moveDay(week, i),
                    events = rows.filter(
                      (m) => londonDay(new Date(m.startsAt)) === day,
                    );
                  return (
                    <div
                      className={`calendar-day ${day === londonDay(new Date()) ? "current-day" : ""}`}
                      key={day}
                    >
                      <div className="day-label">
                        {["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"][i]}
                        <strong>{Number(day.slice(-2))}</strong>
                      </div>
                      {events.map((m) => (
                        <a
                          className={`calendar-event ${m.status === "cancelled" ? "cancelled" : ""}`}
                          href={`#brief/${m.id}`}
                          key={m.id}
                        >
                          <small>
                            {new Date(m.startsAt).toLocaleTimeString("en-GB", {
                              hour: "2-digit",
                              minute: "2-digit",
                              timeZone: "Europe/London",
                            })}
                          </small>
                          <strong>{m.company}</strong>
                          <span>{m.title}</span>
                          <small>{m.status} · Open brief →</small>
                        </a>
                      ))}
                      {!events.length && (
                        <span className="no-events">No meetings</span>
                      )}
                    </div>
                  );
                })}
              </div>
              {resource.value.total > 100 && (
                <div className="pagination">
                  <span>
                    Showing calendar results {page} of{" "}
                    {Math.ceil(resource.value.total / 100)}
                  </span>
                  <button
                    className="secondary"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Previous results
                  </button>
                  <button
                    className="secondary"
                    disabled={page * 100 >= resource.value.total}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    More results
                  </button>
                </div>
              )}
            </>
          )}
        </section>
        <aside>
          <HomeBlocks {...props} />
        </aside>
      </div>
    </>
  );
}
export function OverviewScreen(props: UnifiedProps) {
  const resource = useResource(
    "/api/overview",
    props.revision,
    props.onExpired,
    parseOverview,
  );
  const overview = resource.value;
  return (
    <>
      <ScreenHead
        label="Team activity"
        title="Team overview"
        text="Monitor meeting activity, coverage and outstanding work."
      />
      <LoadState {...resource} />
      {overview && (
        <>
          <div className="overview-metrics">
            {[
              ["All meetings", overview.totalMeetings, "meetings"],
              [
                "Completed",
                overview.completedMeetings,
                "meetings?status=completed",
              ],
              [
                "Upcoming",
                overview.upcomingMeetings,
                "meetings?scope=upcoming",
              ],
              ["Contacts", overview.contacts, "contacts"],
              [
                "Open follow-ups",
                overview.openActions,
                "meetings?scope=open-actions",
              ],
              [
                "Missing notes",
                overview.missingNotes,
                "meetings?scope=missing-notes",
              ],
            ].map(([label, value, to]) => (
              <a href={`#${to}`} className="metric-card" key={label}>
                <small>{label}</small>
                <strong>{value}</strong>
                <span>
                  {label === "Open follow-ups"
                    ? "View meetings with open actions →"
                    : "Explore →"}
                </span>
              </a>
            ))}
          </div>
          <div className="calendar-layout">
            <section className="u-card">
              <div className="section-heading">
                <h2>Recent meeting activity</h2>
                <RouteLink to="meetings">All meetings</RouteLink>
              </div>
              {overview.recent.map((m) => (
                <MeetingCard meeting={m} key={m.id} />
              ))}
              {!overview.recent.length && (
                <p className="empty">
                  No meeting records are available in your workspace.
                </p>
              )}
            </section>
            <aside>
              <section className="u-card">
                <h2>Conversation themes</h2>
                <p className="muted">
                  Discussion tags are distinct from contact Ratings Groups.
                </p>
                {overview.themes.map((theme) => (
                  <a
                    href={`#meetings?tag=${encodeURIComponent(theme.tag)}`}
                    className="theme-row"
                    key={theme.tag}
                  >
                    <span className="tag">{theme.tag}</span>
                    <strong>{theme.count} meetings</strong>
                  </a>
                ))}
                {!overview.themes.length && (
                  <p className="muted">
                    Add tags to meeting records to see themes here.
                  </p>
                )}
              </section>
              <section className="u-card">
                <h2>Outstanding work</h2>
                <p className="muted">
                  {overview.missingNotes} completed meetings need notes.{" "}
                  {overview.openActions} follow-ups remain open.
                </p>
                <RouteLink to="meetings?scope=missing-notes">
                  Meetings awaiting notes
                </RouteLink>
                <RouteLink to="meetings?scope=open-actions">
                  Meetings with open follow-ups
                </RouteLink>
              </section>
            </aside>
          </div>
        </>
      )}
    </>
  );
}
export function MeetingList({
  initialStatus = "",
  initialTag = "",
  initialScope = "",
  briefings = false,
  ...props
}: UnifiedProps & {
  briefings?: boolean;
  initialStatus?: string;
  initialTag?: string;
  initialScope?: string;
}) {
  const [q, setQ] = useState(""),
    [status, setStatus] = useState(initialStatus),
    [tag, setTag] = useState(initialTag),
    [scope, setScope] = useState(initialScope),
    [page, setPage] = useState(1);
  const params = new URLSearchParams({
    q,
    status,
    tag,
    scope,
    page: String(page),
    pageSize: "10",
  });
  const resource = useResource(
    `/api/meetings?${params}`,
    props.revision,
    props.onExpired,
    parseMeetingPage,
  );
  return (
    <>
      <ScreenHead
        label={briefings ? "Meeting preparation" : "Meeting records"}
        title={briefings ? "Briefings" : "Meetings"}
        text={
          briefings
            ? "Prepare for meetings using previous conversations and company context."
            : "Review meetings and manage notes, participants and actions."
        }
      >
        {props.session.membership.role !== "viewer" && (
          <RouteLink to="meetings/new">New meeting</RouteLink>
        )}
      </ScreenHead>
      <section className="u-card">
        <div className="meeting-filters">
          <label>
            Discussion tag
            <input
              value={tag}
              placeholder="All tags"
              onChange={(e) => {
                setTag(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <label>
            Meeting scope
            <select
              value={scope}
              onChange={(e) => {
                setScope(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All meetings</option>
              <option value="upcoming">Upcoming</option>
              <option value="open-actions">With open actions</option>
              <option value="missing-notes">Missing notes</option>
            </select>
          </label>
          <label>
            Search title, company or notes
            <input
              type="search"
              value={q}
              placeholder="Search meeting records…"
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <label>
            Status
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All statuses</option>
              <option value="scheduled">Scheduled</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
        </div>
        <LoadState {...resource} />
        {resource.value?.rows.map((m) => (
          <MeetingCard key={m.id} meeting={m} />
        ))}
        {resource.value && !resource.value.rows.length && (
          <div className="empty">
            <p>
              No meetings match this view. Clear the filters to see all
              available meetings.
            </p>
            <button
              className="secondary"
              onClick={() => {
                setQ("");
                setTag("");
                setScope("");
                setStatus("");
                setPage(1);
              }}
            >
              Clear filters
            </button>
          </div>
        )}
        <div className="pagination">
          <span>{resource.value?.total ?? "—"} matching meetings</span>
          <div>
            <button
              className="secondary"
              disabled={resource.loading || page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <span>Page {page}</span>
            <button
              className="secondary"
              disabled={
                resource.loading ||
                !resource.value ||
                page * 10 >= resource.value.total
              }
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
export function Connections(props: UnifiedProps) {
  const mounted = useRef(true),
    lock = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [meetingId, setMeetingId] = useState("");
  async function simulate() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      const result = await request(
        "/api/integrations/outlook/simulate",
        parseSimulatedImport,
        { method: "POST", body: {}, csrfToken: props.session.csrfToken },
      );
      if (!mounted.current) return;
      setMessage(result.message);
      setMeetingId(result.meetingId);
      props.onChanged(
        "Simulated Outlook meeting is available in the shared calendar and CRM.",
      );
    } catch (error) {
      if (!mounted.current) return;
      if (unauthorized(error)) props.onExpired();
      else setMessage(errorMessage(error));
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <>
      <ScreenHead
        label="Workspace settings"
        title="Connections"
        text="View connection status and manage available integrations."
      />
      <div className="connection-grid">
        <section className="u-card">
          <span className="pill">Simulated connector</span>
          <h2>Microsoft Outlook</h2>
          <p className="muted">
            Import one fictional meeting into the authorised CRM. Replaying this
            example reuses the same meeting; no calendar account is connected.
          </p>
          {props.session.membership.role === "viewer" ? (
            <p className="readonly-note">
              Read-only viewers can inspect imported meetings. An editor
              performs the import.
            </p>
          ) : (
            <button
              className="primary"
              disabled={busy}
              onClick={() => void simulate()}
            >
              {busy ? "Importing…" : "Import simulated Outlook meeting"}
            </button>
          )}
          {message && (
            <p className="import-feedback" role="status">
              {message}
            </p>
          )}
          {meetingId && (
            <RouteLink to={`meeting/${meetingId}`}>
              Open imported meeting →
            </RouteLink>
          )}
        </section>
        <section className="u-card">
          <span className="pill">Simulated data · Not connected</span>
          <h2>Moody’s MCP & recent news</h2>
          <p className="muted">
            Briefing pages include fictional company and sector signals with
            source labels and dates. No licensed research or live news is
            retrieved.
          </p>
          <RouteLink to="briefings">Preview a briefing</RouteLink>
        </section>
        <section className="u-card">
          <span className="pill">Stored records · No AI connection</span>
          <h2>Meeting history and search</h2>
          <p className="muted">
            Previous-conversation sections are assembled from permitted stored
            records. Keyword search retrieves matching notes. No live language
            model is connected.
          </p>
          <RouteLink to="ask">Search stored meeting notes</RouteLink>
        </section>
      </div>
    </>
  );
}
export function NotesSearch(props: UnifiedProps) {
  const [query, setQuery] = useState(""),
    [page, setPage] = useState(1);
  const resource = useResource(
    query
      ? `/api/meetings?${new URLSearchParams({ q: query, page: String(page), pageSize: "10" })}`
      : null,
    props.revision,
    props.onExpired,
    parseMeetingPage,
  );
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPage(1);
    setQuery(String(new FormData(e.currentTarget).get("q") ?? "").trim());
  }
  return (
    <>
      <ScreenHead
        label="Meeting records"
        title="Search"
        text="Find information in recorded meeting notes."
      />
      <section className="u-card">
        <form className="notes-search" onSubmit={submit}>
          <label>
            Topic, company or phrase
            <input
              name="q"
              type="search"
              required
              placeholder="For example: liquidity"
            />
          </label>
          <button className="primary">Search</button>
        </form>
        <p className="muted">
          Search matches stored meeting titles, companies and notes. It does not
          use a live AI model.
        </p>
        {!query && (
          <p className="empty">
            Enter a topic, company or phrase to find matching meetings.
          </p>
        )}
        <LoadState {...resource} />
        {resource.value?.rows.map((m) => (
          <MeetingCard key={m.id} meeting={m} />
        ))}
        {resource.value && !resource.value.rows.length && (
          <p className="empty">
            No matching meeting records found. Try a shorter phrase or a
            different topic.
          </p>
        )}
        {resource.value && resource.value.total > 10 && (
          <div className="pagination">
            <button
              className="secondary"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <span>Page {page}</span>
            <button
              className="secondary"
              disabled={page * 10 >= resource.value.total}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        )}
      </section>
    </>
  );
}
