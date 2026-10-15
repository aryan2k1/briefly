import type {
  CompanyDetail,
  ContactDetail,
  ContactPage,
  ContactRow,
  Lookups,
  MeetingSummary,
  SessionView,
} from "../lib/contracts.ts";
export type Parser<T> = (value: unknown) => T;
function invalid(): never {
  throw new Error(
    "The server returned an unexpected response. Please reload or contact support.",
  );
}
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  return typeof value === "string" ? value : invalid();
}
function nullable(value: unknown): string | null {
  return value === null ? null : text(value);
}
function integer(value: unknown, minimum = 0): number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum
    ? value
    : invalid();
}
function list<T>(value: unknown, parser: Parser<T>): T[] {
  return Array.isArray(value) ? value.map(parser) : invalid();
}
function timestamp(value: unknown): string {
  const result = text(value);
  if (!Number.isFinite(Date.parse(result))) invalid();
  return result;
}
function named(value: unknown) {
  const row = object(value);
  return { id: text(row.id), name: text(row.name) };
}
export function parseSession(value: unknown): SessionView {
  const row = object(value),
    membership = object(row.membership),
    org = object(row.organisation);
  const role = membership.role;
  if (role !== "admin" && role !== "editor" && role !== "viewer")
    return invalid();
  return {
    user: named(row.user),
    membership: {
      id: text(membership.id),
      role,
      teamId: text(membership.teamId),
    },
    organisation: {
      id: text(org.id),
      name: text(org.name),
      accent: text(org.accent),
      integrationMode: text(org.integrationMode),
    },
    csrfToken: text(row.csrfToken),
  };
}
export function parseContactRow(value: unknown): ContactRow {
  const row = object(value);
  return {
    id: text(row.id),
    name: text(row.name),
    email: text(row.email),
    phone: text(row.phone),
    version: integer(row.version, 1),
    companyId: nullable(row.companyId),
    company: nullable(row.company),
    title: nullable(row.title),
    ownerId: text(row.ownerId),
    owner: text(row.owner),
    team: text(row.team),
    ratingGroups: list(row.ratingGroups, text),
  };
}
export function parseContactPage(value: unknown): ContactPage {
  const row = object(value);
  return {
    rows: list(row.rows, parseContactRow),
    total: integer(row.total),
    page: integer(row.page, 1),
    pageSize: integer(row.pageSize, 1),
  };
}
export function parseLookups(value: unknown): Lookups {
  const row = object(value);
  return {
    companies: list(row.companies, named),
    owners: list(row.owners, named),
    ratingGroups: list(row.ratingGroups, (value) => {
      const group = object(value);
      return { ...named(group), code: text(group.code) };
    }),
  };
}
export function parseMeetingSummary(value: unknown): MeetingSummary {
  const row = object(value);
  return {
    id: text(row.id),
    title: text(row.title),
    startsAt: timestamp(row.startsAt),
    participants: list(row.participants, (value) => {
      const person = object(value);
      return {
        name: text(person.name),
        title: text(person.title),
        company: text(person.company),
      };
    }),
    internalParticipants: list(row.internalParticipants, (value) => {
      const person = object(value);
      return { name: text(person.name), title: text(person.title) };
    }),
  };
}
export function parseContactDetail(value: unknown): ContactDetail {
  const row = object(value);
  return {
    contact: parseContactRow(row.contact),
    employments: list(row.employments, (value) => {
      const job = object(value);
      return {
        id: text(job.id),
        companyId: text(job.companyId),
        company: text(job.company),
        title: text(job.title),
        startedOn: timestamp(job.startedOn),
        endedOn: job.endedOn === null ? null : timestamp(job.endedOn),
      };
    }),
    meetings: list(row.meetings, parseMeetingSummary),
  };
}
export function parseCompanyDetail(value: unknown): CompanyDetail {
  const row = object(value);
  return {
    id: text(row.id),
    name: text(row.name),
    sector: text(row.sector),
    contacts: list(row.contacts, parseContactRow),
    meetings: list(row.meetings, parseMeetingSummary),
  };
}
export function parseProfile(value: unknown): ContactDetail | CompanyDetail {
  const row = object(value);
  return "contact" in row ? parseContactDetail(row) : parseCompanyDetail(row);
}
export function parseOk(value: unknown): { ok: true } {
  if (object(value).ok !== true) return invalid();
  return { ok: true };
}
export function parseCreatedId(value: unknown): { id: string } {
  return { id: text(object(value).id) };
}
