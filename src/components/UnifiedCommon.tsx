import type { MeetingRow, MeetingDetail } from "@/lib/contracts";
export function meetingDate(value: string) {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
    timeZoneName: "short",
  });
}
export function RouteLink({
  to,
  children,
  primary = false,
}: {
  to: string;
  children: React.ReactNode;
  primary?: boolean;
}) {
  return (
    <a
      className={primary ? "primary route-button" : "secondary route-button"}
      href={`#${to}`}
    >
      {children}
    </a>
  );
}
export function ScreenHead({
  label,
  title,
  text,
  children,
}: {
  label: string;
  title: string;
  text: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{label}</div>
        <h1>{title}</h1>
        <p className="muted">{text}</p>
      </div>
      <div className="heading-actions">{children}</div>
    </div>
  );
}
export function MeetingTags({ tags }: { tags: string[] }) {
  return (
    <span className="tags">
      {tags.map((tag) => (
        <span className="tag" key={tag}>
          {tag}
        </span>
      ))}
    </span>
  );
}
export function MeetingCard({ meeting }: { meeting: MeetingRow }) {
  return (
    <article className="meeting-item">
      <div>
        <small>
          {meetingDate(meeting.startsAt)} · {meeting.status}
        </small>
        <a href={`#meeting/${meeting.id}`}>
          <h3>{meeting.title}</h3>
        </a>
        <p>
          {meeting.company} · {meeting.participantCount} external participants
        </p>
        <MeetingTags tags={meeting.tags} />
      </div>
      <RouteLink to={`brief/${meeting.id}`} primary>
        Open brief
      </RouteLink>
    </article>
  );
}
export function ParticipantCards({ meeting }: { meeting: MeetingDetail }) {
  return (
    <>
      <section className="u-card">
        <h2>External participants</h2>
        {meeting.participants.map((person) => (
          <div className="participant-summary" key={person.contactId}>
            <strong>{person.name}</strong>
            <small>
              {person.title} · {person.company}
            </small>
          </div>
        ))}
        {!meeting.participants.length && (
          <p className="muted">No external participants recorded.</p>
        )}
      </section>
      <section className="u-card">
        <h2>Internal team</h2>
        <p className="muted">
          Fictional participants · titles recorded at the meeting
        </p>
        {meeting.internalParticipants.map((person) => (
          <div className="participant-summary" key={person.membershipId}>
            <strong>{person.name}</strong>
            <small>{person.title}</small>
          </div>
        ))}
        {!meeting.internalParticipants.length && (
          <p className="muted">No internal participants recorded.</p>
        )}
      </section>
    </>
  );
}
