import { useEffect, useRef, useState, type FormEvent } from "react";
import type { MeetingDetail, Lookups } from "@/lib/contracts";
import type { UnifiedProps } from "./UnifiedScreens";
import { useResource } from "./useResource";
import { parseMeetingDetail, parseSavedMeeting } from "./unified-response";
import { request, ApiError, errorMessage, unauthorized } from "./api";
import { draftFingerprint, installMeetingGuard } from "./meeting-draft";
import { showDraftDialog } from "./draft-dialog";
import {
  ScreenHead,
  RouteLink,
  ParticipantCards,
  MeetingTags,
  meetingDate,
} from "./UnifiedCommon";
function localInput(iso: string) {
  const d = new Date(iso),
    p = (value: number) => String(value).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function MeetingEditor({
  meeting,
  lookups,
  ...props
}: UnifiedProps & { meeting: MeetingDetail; lookups: Lookups }) {
  const [extra, setExtra] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [conflict, setConflict] = useState(false);
  const [dirty, setDirty] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const baseline = useRef("");
  const dirtyRef = useRef(false);
  function inspectDraft() {
    if (!form.current) return;
    const changed =
      draftFingerprint(new FormData(form.current)) !== baseline.current;
    dirtyRef.current = changed;
    setDirty(changed);
  }
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const editable = props.session.membership.role !== "viewer";
  useEffect(() => {
    if (!editable || !form.current) return;
    baseline.current = draftFingerprint(new FormData(form.current));
    return installMeetingGuard(
      () => dirtyRef.current,
      window,
      () => lock.current,
    );
  }, [editable]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (lock.current) return;
    const f = new FormData(e.currentTarget),
      str = (key: string) => String(f.get(key) ?? "").trim();
    const submittedFingerprint = draftFingerprint(f);
    const actions = Array.from(
      { length: meeting.actions.length + extra },
      (_, i) => ({
        ...(meeting.actions[i] ? { id: meeting.actions[i].id } : {}),
        description: str(`description-${i}`),
        ownerId: str(`owner-${i}`),
        dueOn: str(`due-${i}`),
        status: str(`status-${i}`),
      }),
    ).filter((a) => a.description);
    lock.current = true;
    setBusy(true);
    setError("");
    setConflict(false);
    try {
      await request(
        `/api/meetings/${encodeURIComponent(meeting.id)}`,
        parseSavedMeeting,
        {
          method: "PATCH",
          csrfToken: props.session.csrfToken,
          body: {
            version: meeting.version,
            title: str("title"),
            startsAt: new Date(str("startsAt")).toISOString(),
            status: str("status"),
            notes: str("notes"),
            tags: [
              ...new Set(
                str("tags")
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean),
              ),
            ],
            actions,
          },
        },
      );
      if (mounted.current) {
        dirtyRef.current = false;
        baseline.current = submittedFingerprint;
        setDirty(false);
        props.onChanged(
          "Meeting saved. Calendar, overview, profiles and future briefs use the updated record.",
        );
      }
    } catch (error) {
      if (!mounted.current) return;
      if (unauthorized(error)) props.onExpired();
      else {
        setError(errorMessage(error));
        setConflict(error instanceof ApiError && error.status === 409);
      }
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <form ref={form} onChange={inspectDraft} onSubmit={(e) => void submit(e)}>
      <fieldset
        disabled={busy}
        style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
      >
        <section className="u-card">
          <h2>Meeting details</h2>
          {editable ? (
            <div className="form-grid">
              <label>
                Meeting title
                <input
                  name="title"
                  required
                  maxLength={200}
                  defaultValue={meeting.title}
                />
              </label>
              <label>
                Start · your browser’s local time
                <input
                  type="datetime-local"
                  name="startsAt"
                  required
                  defaultValue={localInput(meeting.startsAt)}
                />
              </label>
              <label>
                Status
                <select name="status" defaultValue={meeting.status}>
                  <option value="scheduled">Scheduled</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </label>
              <label>
                Discussion tags · comma separated
                <input
                  name="tags"
                  maxLength={500}
                  defaultValue={meeting.tags.join(", ")}
                  placeholder="Liquidity, ESG, outlook"
                />
              </label>
            </div>
          ) : (
            <>
              <p>
                {meeting.title}
                <br />
                {meetingDate(meeting.startsAt)} · {meeting.status}
              </p>
              <MeetingTags tags={meeting.tags} />
            </>
          )}
          <p className="record-meta">
            Source:{" "}
            {meeting.source === "outlook-demo"
              ? "Simulated Outlook import"
              : "Manual CRM record"}{" "}
            · Meeting timezone: {meeting.timeZone} · Version {meeting.version}
          </p>
        </section>
        <section className="u-card">
          <h2>Discussion record</h2>
          {editable ? (
            <label>
              Meeting notes
              <textarea
                name="notes"
                rows={8}
                maxLength={8000}
                defaultValue={meeting.notes}
                placeholder="Record the conversation, key questions and agreed next steps…"
              />
            </label>
          ) : (
            <p className="preserve-text">
              {meeting.notes || "No notes have been recorded for this meeting."}
            </p>
          )}
          <p className="muted">
            Stored notes become evidence for later pre-meeting briefs.
          </p>
        </section>
        <section className="u-card">
          <div className="section-heading">
            <h2>Follow-up items</h2>
            {editable && (
              <button
                type="button"
                className="secondary"
                disabled={meeting.actions.length + extra >= 20}
                onClick={() => {
                  dirtyRef.current = true;
                  setDirty(true);
                  setExtra((value) => value + 1);
                  requestAnimationFrame(inspectDraft);
                }}
              >
                ＋ Add follow-up
              </button>
            )}
          </div>
          {Array.from({ length: meeting.actions.length + extra }, (_, i) => {
            const action = meeting.actions[i];
            return (
              <div className="action-editor" key={action?.id ?? `new-${i}`}>
                {editable ? (
                  <>
                    <label>
                      Action
                      <input
                        name={`description-${i}`}
                        required
                        maxLength={500}
                        defaultValue={action?.description}
                      />
                    </label>
                    <div className="action-fields">
                      <label>
                        Owner
                        <select
                          required
                          name={`owner-${i}`}
                          defaultValue={action?.ownerId ?? ""}
                        >
                          <option value="" disabled>
                            Select an owner
                          </option>
                          {lookups.owners.map((owner) => (
                            <option key={owner.id} value={owner.id}>
                              {owner.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Due date
                        <input
                          required
                          type="date"
                          name={`due-${i}`}
                          defaultValue={action?.dueOn.slice(0, 10)}
                        />
                      </label>
                      <label>
                        State
                        <select
                          name={`status-${i}`}
                          defaultValue={action?.status ?? "open"}
                        >
                          <option value="open">Open</option>
                          <option value="done">Done</option>
                        </select>
                      </label>
                    </div>
                    {!action && i === meeting.actions.length + extra - 1 && (
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => {
                          setExtra((value) => Math.max(0, value - 1));
                          requestAnimationFrame(inspectDraft);
                        }}
                      >
                        Remove last unsaved follow-up
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <strong>{action?.description}</strong>
                    <small>
                      {action?.owner} · Due {action?.dueOn.slice(0, 10)} ·{" "}
                      {action?.status}
                    </small>
                  </>
                )}
              </div>
            );
          })}
          {!meeting.actions.length && !extra && (
            <p className="muted">No follow-up items recorded.</p>
          )}
        </section>
        {error && (
          <div className="error" role="alert">
            <p>{error}</p>
            {conflict && (
              <>
                <p>
                  Another change was saved first. Your draft has not overwritten
                  it.
                </p>
                <button
                  type="button"
                  className="secondary"
                  onClick={async () => {
                    if (!(await showDraftDialog())) return;
                    dirtyRef.current = false;
                    setDirty(false);
                    props.onChanged(
                      "Latest meeting loaded. Reapply any intended changes.",
                    );
                  }}
                >
                  Discard draft & reload latest version
                </button>
              </>
            )}
          </div>
        )}
        {editable && (
          <div className="meeting-save">
            <p role="status" aria-live="polite">
              {busy
                ? "Saving meeting…"
                : error
                  ? "Not saved. Your draft is still here."
                  : dirty
                    ? "Unsaved changes"
                    : "All changes saved"}
            </p>
            <small>
              Updated {meetingDate(meeting.updatedAt)} · Changes are saved with
              an audit record.
            </small>
            <button className="primary" disabled={busy || !dirty}>
              {busy ? "Saving…" : "Save meeting & follow-ups"}
            </button>
          </div>
        )}
      </fieldset>
    </form>
  );
}
export function MeetingScreen({
  id,
  lookups,
  ...props
}: UnifiedProps & { id: string; lookups: Lookups }) {
  const resource = useResource(
    `/api/meetings/${encodeURIComponent(id)}`,
    props.revision,
    props.onExpired,
    parseMeetingDetail,
  );
  const meeting = resource.value;
  return (
    <>
      <ScreenHead
        label="Meeting CRM"
        title={meeting?.title ?? "Meeting record"}
        text={
          meeting
            ? `${meeting.company} · ${meetingDate(meeting.startsAt)}`
            : "Loading the authorised meeting record…"
        }
      >
        <RouteLink to="meetings">All meetings</RouteLink>
        <RouteLink to={`brief/${id}`} primary>
          Open brief
        </RouteLink>
      </ScreenHead>
      {resource.loading && (
        <p className="empty" role="status">
          Loading meeting details…
        </p>
      )}
      {resource.error && (
        <p className="error" role="alert">
          {resource.error}
        </p>
      )}
      {meeting && (
        <div className="meeting-detail-layout">
          <MeetingEditor
            key={`${meeting.id}-${meeting.version}`}
            meeting={meeting}
            lookups={lookups}
            {...props}
          />
          <aside>
            <ParticipantCards meeting={meeting} />
            <section className="u-card">
              <h2>One shared relationship record</h2>
              <p className="muted">
                Participant names, titles and companies are historical
                snapshots. Current employment changes do not rewrite this
                meeting.
              </p>
              <RouteLink to="contacts">Contact workspace</RouteLink>
            </section>
          </aside>
        </div>
      )}
    </>
  );
}
