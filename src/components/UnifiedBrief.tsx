import { useState } from "react";
import type { MeetingDetail } from "@/lib/contracts";
import type { UnifiedProps } from "./UnifiedScreens";
import { useResource } from "./useResource";
import { parseBriefing } from "./unified-response";
import {
  ScreenHead,
  RouteLink,
  ParticipantCards,
  MeetingTags,
  meetingDate,
} from "./UnifiedCommon";
function Conversation({
  meeting,
  retrievedAt,
}: {
  meeting: MeetingDetail;
  retrievedAt: string;
}) {
  return (
    <article className="conversation-evidence">
      <div className="section-heading">
        <div>
          <h3>{meeting.title}</h3>
          <small>
            {meetingDate(meeting.startsAt)} · {meeting.company}
          </small>
        </div>
        <a href={`#meeting/${meeting.id}`}>Source record ↗</a>
      </div>
      <p className="preserve-text">
        {meeting.notes ||
          "A meeting is recorded, but no discussion notes are available. No conversation details have been inferred."}
      </p>
      <MeetingTags tags={meeting.tags} />
      <details className="evidence-source">
        <summary>CRM provenance</summary>
        <p>
          Record {meeting.id}
          <br />
          Version {meeting.version} · Updated {meetingDate(meeting.updatedAt)}
          <br />
          Retrieved {meetingDate(retrievedAt)}
        </p>
      </details>
    </article>
  );
}
export function BriefScreen({ id, ...props }: UnifiedProps & { id: string }) {
  const resource = useResource(
    `/api/meetings/${encodeURIComponent(id)}/brief`,
    props.revision,
    props.onExpired,
    parseBriefing,
  );
  const brief = resource.value;
  const previousActions = brief
    ? [
        ...new Map(
          [
            brief.meeting,
            ...brief.previousWithPeople,
            ...brief.relatedCompany,
          ].flatMap((meeting) =>
            meeting.actions
              .filter((action) => action.status === "open")
              .map(
                (action) =>
                  [
                    `${meeting.id}/${action.id}`,
                    {
                      action,
                      meetingId: meeting.id,
                      meetingTitle: meeting.title,
                    },
                  ] as const,
              ),
          ),
        ).values(),
      ]
    : [];
  const [preview, setPreview] = useState(false);
  return (
    <>
      <ScreenHead
        label="Pre-meeting intelligence"
        title={brief?.meeting.company ?? "Your meeting brief"}
        text={
          brief
            ? `${brief.meeting.title} · ${meetingDate(brief.meeting.startsAt)}`
            : "Retrieving permitted relationship records…"
        }
      >
        <RouteLink to={`meeting/${id}`}>Meeting record</RouteLink>
        <RouteLink to="briefings">All briefings</RouteLink>
      </ScreenHead>
      {resource.loading && (
        <p className="empty" role="status">
          Preparing the brief from stored meeting history…
        </p>
      )}
      {resource.error && (
        <p className="error" role="alert">
          {resource.error}
        </p>
      )}
      {brief && (
        <>
          <div className="brief-disclosure">
            <span className="pill">
              Deterministic preparation · No live AI model
            </span>
            <small>
              CRM records retrieved {meetingDate(brief.generatedAt)} · Fictional
              workspace data
            </small>
          </div>
          <div className="meeting-detail-layout">
            <section>
              <article className="u-card">
                <div className="eyebrow">Meeting preparation</div>
                <h2>{brief.meeting.title}</h2>
                <p>
                  {brief.meeting.company} · {brief.meeting.participants.length}{" "}
                  external participants · {brief.meeting.status}
                </p>
                <MeetingTags tags={brief.meeting.tags} />
                <p className="muted brief-intro">
                  Review the previous discussion, close outstanding actions and
                  confirm current priorities. This suggested structure is a
                  fixed demo template, not an inferred meeting objective.
                </p>
                <a href={`#meeting/${id}`}>View meeting source →</a>
              </article>
              <article className="u-card">
                <h2>Last conversations with the same people</h2>
                <p className="muted">
                  Up to 20 recent completed meetings with shared participants,
                  before this meeting.
                </p>
                {brief.previousWithPeople.map((meeting) => (
                  <Conversation
                    key={meeting.id}
                    meeting={meeting}
                    retrievedAt={brief.generatedAt}
                  />
                ))}
                {!brief.previousWithPeople.length && (
                  <p className="empty">
                    No earlier completed conversation with these participants is
                    recorded.
                  </p>
                )}
              </article>
              <article className="u-card">
                <h2>Related company / team conversations</h2>
                <p className="muted">
                  Up to 20 recent completed meetings at this company, with
                  different participants and within your permitted team.
                </p>
                {brief.relatedCompany.map((meeting) => (
                  <Conversation
                    key={meeting.id}
                    meeting={meeting}
                    retrievedAt={brief.generatedAt}
                  />
                ))}
                {!brief.relatedCompany.length && (
                  <p className="empty">
                    No separate company conversation is available in your
                    permitted history.
                  </p>
                )}
              </article>
              <article className="u-card">
                <h2>Open follow-ups across the relationship</h2>
                <p className="muted">
                  From this meeting and the authorised earlier conversations
                  shown above.
                </p>
                {previousActions.map(({ action, meetingId, meetingTitle }) => (
                  <div
                    className="participant-summary"
                    key={`${meetingId}/${action.id}`}
                  >
                    <strong>{action.description}</strong>
                    <small>
                      {action.owner} · Due {action.dueOn.slice(0, 10)}
                    </small>
                    <a href={`#meeting/${meetingId}`}>
                      {meetingTitle} · Source meeting →
                    </a>
                  </div>
                ))}
                {!previousActions.length && (
                  <p className="muted">
                    No open follow-up items are recorded in the retrieved
                    conversations.
                  </p>
                )}
              </article>
              <article className="u-card">
                <span className="pill">Simulated MCP / fictional news</span>
                <h2 className="brief-section-title">
                  Company & sector context
                </h2>
                <p className="muted">
                  {brief.simulation.label} These examples do not describe real
                  companies, ratings, research or current news.
                </p>
                <button
                  className="secondary"
                  aria-expanded={preview}
                  onClick={() => setPreview((value) => !value)}
                >
                  {preview
                    ? "Hide simulated enrichment"
                    : "Preview simulated enrichment"}
                </button>
                {preview && (
                  <div>
                    {brief.simulation.signals.map((signal, index) => (
                      <section className="simulation-signal" key={index}>
                        <h3>{signal.headline}</h3>
                        <p>{signal.detail}</p>
                        <details className="evidence-source">
                          <summary>Fictional source and date</summary>
                          <p>
                            {signal.source}
                            <br />
                            Fixture publication date:{" "}
                            {meetingDate(signal.publishedAt)}
                            <br />
                            Included in this preview:{" "}
                            {meetingDate(brief.generatedAt)}
                            <br />
                            No live retrieval performed.
                          </p>
                        </details>
                      </section>
                    ))}
                    {!brief.simulation.signals.length && (
                      <p className="muted">
                        No simulated company signals are available for this
                        meeting.
                      </p>
                    )}
                  </div>
                )}
              </article>
            </section>
            <aside>
              <ParticipantCards meeting={brief.meeting} />
              <section className="u-card meeting-spotlight">
                <h2>Meeting notes and follow-ups</h2>
                <p>
                  Save notes and owned follow-ups after the meeting. They remain
                  linked to the participants and company.
                </p>
                <RouteLink to={`meeting/${id}`} primary>
                  Open discussion record
                </RouteLink>
              </section>
            </aside>
          </div>
        </>
      )}
    </>
  );
}
