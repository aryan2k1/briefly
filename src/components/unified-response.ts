import type {
  MeetingRow,
  MeetingPage,
  MeetingDetail,
  Overview,
  MeetingBrief,
} from "../lib/contracts.ts";
const invalid = (): never => {
  throw new Error(
    "The server returned an unexpected meeting response. Please reload.",
  );
};
function obj(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalid();
  return value as Record<string, unknown>;
}
function str(value: unknown): string {
  return typeof value === "string" ? value : invalid();
}
function num(value: unknown, min = 0): number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= min
    ? value
    : invalid();
}
function arr<T>(value: unknown, parse: (value: unknown) => T): T[] {
  return Array.isArray(value) ? value.map(parse) : invalid();
}
function time(value: unknown) {
  const result = str(value);
  return Number.isFinite(Date.parse(result)) ? result : invalid();
}
export function parseMeetingRow(value: unknown): MeetingRow {
  const row = obj(value);
  const status = row.status,
    source = row.source;
  if (
    status !== "scheduled" &&
    status !== "completed" &&
    status !== "cancelled"
  )
    return invalid();
  if (source !== "manual" && source !== "outlook-demo") return invalid();
  return {
    id: str(row.id),
    title: str(row.title),
    startsAt: time(row.startsAt),
    timeZone: str(row.timeZone),
    companyId: str(row.companyId),
    company: str(row.company),
    version: num(row.version, 1),
    status,
    source,
    tags: arr(row.tags, str),
    participantCount: num(row.participantCount),
  };
}
export function parseMeetingPage(value: unknown): MeetingPage {
  const row = obj(value);
  return {
    rows: arr(row.rows, parseMeetingRow),
    total: num(row.total),
    page: num(row.page, 1),
    pageSize: num(row.pageSize, 1),
  };
}
export function parseMeetingDetail(value: unknown): MeetingDetail {
  const row = obj(value);
  return {
    ...parseMeetingRow(row),
    notes: str(row.notes),
    updatedAt: time(row.updatedAt),
    participants: arr(row.participants, (value) => {
      const person = obj(value);
      return {
        contactId: str(person.contactId),
        name: str(person.name),
        title: str(person.title),
        company: str(person.company),
      };
    }),
    internalParticipants: arr(row.internalParticipants, (value) => {
      const person = obj(value);
      return {
        membershipId: str(person.membershipId),
        name: str(person.name),
        title: str(person.title),
      };
    }),
    actions: arr(row.actions, (value) => {
      const action = obj(value),
        status = action.status;
      if (status !== "open" && status !== "done") return invalid();
      return {
        id: str(action.id),
        description: str(action.description),
        ownerId: str(action.ownerId),
        owner: str(action.owner),
        dueOn: time(action.dueOn),
        status,
      };
    }),
  };
}
export function parseOverview(value: unknown): Overview {
  const row = obj(value);
  return {
    totalMeetings: num(row.totalMeetings),
    completedMeetings: num(row.completedMeetings),
    upcomingMeetings: num(row.upcomingMeetings),
    contacts: num(row.contacts),
    openActions: num(row.openActions),
    missingNotes: num(row.missingNotes),
    themes: arr(row.themes, (value) => {
      const theme = obj(value);
      return { tag: str(theme.tag), count: num(theme.count) };
    }),
    recent: arr(row.recent, parseMeetingRow),
  };
}
export function parseBriefing(value: unknown): MeetingBrief {
  const row = obj(value),
    simulation = obj(row.simulation);
  return {
    meeting: parseMeetingDetail(row.meeting),
    previousWithPeople: arr(row.previousWithPeople, parseMeetingDetail),
    relatedCompany: arr(row.relatedCompany, parseMeetingDetail),
    generatedAt: time(row.generatedAt),
    simulation: {
      label: str(simulation.label),
      signals: arr(simulation.signals, (value) => {
        const signal = obj(value);
        return {
          headline: str(signal.headline),
          detail: str(signal.detail),
          source: str(signal.source),
          publishedAt: time(signal.publishedAt),
        };
      }),
    },
  };
}
export function parseSavedMeeting(value: unknown): {
  id: string;
  version: number;
} {
  const row = obj(value);
  return { id: str(row.id), version: num(row.version, 1) };
}
export function parseSimulatedImport(value: unknown): {
  message: string;
  meetingId: string;
} {
  const row = obj(value);
  return { message: str(row.message), meetingId: str(row.meetingId) };
}
