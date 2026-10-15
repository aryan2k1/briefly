import { useEffect, useRef } from "react";
import type {
  CompanyDetail,
  ContactDetail,
  MeetingSummary,
} from "@/lib/contracts";
import { useResource } from "./useResource";
import { parseContactDetail, parseCompanyDetail } from "./response";

export type Selection = { kind: "contact" | "company"; id: string };
export function Groups({ values }: { values: string[] }) {
  return (
    <span className="tags">
      {values.map((group) => (
        <span className="tag" key={group}>
          {group}
        </span>
      ))}
    </span>
  );
}
function Meetings({ meetings }: { meetings: MeetingSummary[] }) {
  return (
    <section className="profile-section">
      <h3>
        Linked meetings <span className="count">{meetings.length}</span>
      </h3>
      {!meetings.length && (
        <p className="muted">No meetings linked to this record.</p>
      )}
      {meetings.map((meeting) => (
        <article className="timeline-item" key={meeting.id}>
          <small>
            {new Date(meeting.startsAt).toLocaleString("en-GB", {
              dateStyle: "medium",
              timeStyle: "short",
              timeZone: "Europe/London",
            })}{" "}
            · London
          </small>
          <h4>
            <a href={`#meeting/${meeting.id}`}>{meeting.title}</a>
          </h4>
          <a href={`#brief/${meeting.id}`}>Open meeting brief →</a>
          <p className="label">External participants · recorded snapshot</p>
          {meeting.participants.map((person, i) => (
            <p key={i}>
              {person.name}
              <small>
                {person.title} · {person.company}
              </small>
            </p>
          ))}
          <p className="label">Internal participants · fictional</p>
          {meeting.internalParticipants.map((person, i) => (
            <p key={i}>
              {person.name}
              <small>{person.title}</small>
            </p>
          ))}
        </article>
      ))}
    </section>
  );
}

export default function Profile({
  selection,
  revision,
  onExpired,
  onSelect,
  onClose,
  onEdit,
  onEmployment,
  onMeeting,
  editable,
}: {
  selection: Selection;
  revision: number;
  onExpired: () => void;
  onSelect: (selection: Selection) => void;
  onClose: () => void;
  onEdit: (contact: ContactDetail) => void;
  onEmployment: (contact: ContactDetail) => void;
  onMeeting: (contact: ContactDetail) => void;
  editable: boolean;
}) {
  const path = `/api/${selection.kind === "contact" ? "contacts" : "companies"}/${encodeURIComponent(selection.id)}`;
  const resource = useResource<ContactDetail | CompanyDetail>(
    path,
    revision,
    onExpired,
    selection.kind === "contact" ? parseContactDetail : parseCompanyDetail,
  );
  const detail = resource.value;
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
    if (window.matchMedia("(max-width: 850px)").matches)
      panel.current?.scrollIntoView({ block: "start" });
  }, [selection.id, selection.kind]);
  return (
    <aside
      ref={panel}
      tabIndex={-1}
      className="profile"
      aria-label="Relationship details"
    >
      <div className="profile-top">
        <span className="eyebrow">
          {selection.kind === "contact" ? "Contact profile" : "Company profile"}
        </span>
        <button
          className="icon-button"
          aria-label="Close profile"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {resource.loading && (
        <p role="status" className="empty">
          Loading relationship details…
        </p>
      )}
      {resource.error && (
        <p role="alert" className="error">
          {resource.error}
        </p>
      )}
      {detail && "contact" in detail ? (
        <>
          <div className="profile-heading">
            <div className="avatar large">
              {detail.contact.name
                .split(" ")
                .map((x) => x[0])
                .slice(0, 2)
                .join("")}
            </div>
            <h2>{detail.contact.name}</h2>
            <p className="muted">
              {detail.contact.title ?? "No current title"}
            </p>
            {detail.contact.companyId && (
              <button
                className="text-button"
                onClick={() =>
                  onSelect({ kind: "company", id: detail.contact.companyId! })
                }
              >
                {detail.contact.company} ↗
              </button>
            )}
            <Groups values={detail.contact.ratingGroups} />
            {editable && (
              <div className="profile-actions">
                <button
                  className="secondary full"
                  onClick={() => onEdit(detail)}
                >
                  Edit contact details
                </button>
                <button
                  className="secondary full"
                  onClick={() => onEmployment(detail)}
                >
                  Update employment
                </button>
                <button
                  className="primary full"
                  onClick={() => onMeeting(detail)}
                >
                  Book a linked meeting
                </button>
              </div>
            )}
          </div>
          <section className="profile-section">
            <h3>Contact & coverage</h3>
            <dl>
              <dt>Email</dt>
              <dd>{detail.contact.email}</dd>
              <dt>Phone</dt>
              <dd>{detail.contact.phone || "Not provided"}</dd>
              <dt>Coverage owner</dt>
              <dd>{detail.contact.owner}</dd>
              <dt>Team</dt>
              <dd>{detail.contact.team}</dd>
            </dl>
          </section>
          <section className="profile-section">
            <h3>Employment history</h3>
            {detail.employments.map((job) => (
              <div className="timeline-item" key={job.id}>
                <button
                  className="text-button"
                  onClick={() =>
                    onSelect({ kind: "company", id: job.companyId })
                  }
                >
                  {job.company} ↗
                </button>
                <p>
                  {job.title}
                  <small>
                    {job.startedOn} — {job.endedOn ?? "Present"}
                  </small>
                </p>
              </div>
            ))}
            {!detail.employments.length && (
              <p className="muted">No employment history recorded.</p>
            )}
          </section>
          <Meetings meetings={detail.meetings} />
        </>
      ) : detail && "sector" in detail ? (
        <>
          <div className="profile-heading">
            <div className="avatar large">▦</div>
            <h2>{detail.name}</h2>
            <p className="muted">{detail.sector}</p>
          </div>
          <section className="profile-section">
            <h3>
              Linked contacts{" "}
              <span className="count">{detail.contacts.length}</span>
            </h3>
            {detail.contacts.map((contact) => (
              <div className="timeline-item" key={contact.id}>
                <button
                  className="text-button"
                  onClick={() => onSelect({ kind: "contact", id: contact.id })}
                >
                  {contact.name} ↗
                </button>
                <p className="muted">{contact.title}</p>
                <Groups values={contact.ratingGroups} />
              </div>
            ))}
            {!detail.contacts.length && (
              <p className="muted">No linked contacts available.</p>
            )}
          </section>
          <Meetings meetings={detail.meetings} />
        </>
      ) : null}
    </aside>
  );
}
