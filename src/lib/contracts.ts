export type Role = "admin" | "editor" | "viewer";
export interface SessionView {
  user: { id: string; name: string };
  membership: { id: string; role: Role; teamId: string };
  organisation: {
    id: string;
    name: string;
    accent: string;
    integrationMode: string;
  };
  csrfToken: string;
}
export interface ContactRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  version: number;
  companyId: string | null;
  company: string | null;
  title: string | null;
  ownerId: string;
  owner: string;
  team: string;
  ratingGroups: string[];
}
export interface ContactPage {
  rows: ContactRow[];
  total: number;
  page: number;
  pageSize: number;
}
export interface Lookups {
  companies: { id: string; name: string }[];
  owners: { id: string; name: string }[];
  ratingGroups: { id: string; code: string; name: string }[];
}
export interface MeetingSummary {
  id: string;
  title: string;
  startsAt: string;
  participants: { name: string; title: string; company: string }[];
  internalParticipants: { name: string; title: string }[];
}
export interface ContactDetail {
  contact: ContactRow;
  employments: {
    id: string;
    companyId: string;
    company: string;
    title: string;
    startedOn: string;
    endedOn: string | null;
  }[];
  meetings: MeetingSummary[];
}
export interface CompanyDetail {
  id: string;
  name: string;
  sector: string;
  contacts: ContactRow[];
  meetings: MeetingSummary[];
}
export interface ContactEdit {
  version: number;
  name: string;
  email: string;
  phone: string;
  ownerId: string;
}
export interface ContactCreate {
  name: string;
  email: string;
  phone: string;
  ownerId: string;
  companyId: string;
  title: string;
  ratingGroupIds: string[];
}

export interface MeetingRow {
  id: string;
  title: string;
  startsAt: string;
  timeZone: string;
  companyId: string;
  company: string;
  version: number;
  status: "scheduled" | "completed" | "cancelled";
  source: "manual" | "outlook-demo";
  tags: string[];
  participantCount: number;
}
export interface MeetingPage {
  rows: MeetingRow[];
  total: number;
  page: number;
  pageSize: number;
}
export interface MeetingAction {
  id: string;
  description: string;
  ownerId: string;
  owner: string;
  dueOn: string;
  status: "open" | "done";
}
export interface MeetingDetail extends MeetingRow {
  notes: string;
  participants: {
    contactId: string;
    name: string;
    title: string;
    company: string;
  }[];
  internalParticipants: { membershipId: string; name: string; title: string }[];
  actions: MeetingAction[];
  updatedAt: string;
}
export interface Overview {
  totalMeetings: number;
  completedMeetings: number;
  upcomingMeetings: number;
  contacts: number;
  openActions: number;
  missingNotes: number;
  themes: { tag: string; count: number }[];
  recent: MeetingRow[];
}
export interface MeetingBrief {
  meeting: MeetingDetail;
  previousWithPeople: MeetingDetail[];
  relatedCompany: MeetingDetail[];
  generatedAt: string;
  simulation: {
    label: string;
    signals: {
      headline: string;
      detail: string;
      source: string;
      publishedAt: string;
    }[];
  };
}
