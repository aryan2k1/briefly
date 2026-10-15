export interface HomeMeeting {
  id: string;
  title: string;
  company: string;
  startsAt: string;
  updatedAt: string;
}
export interface HomeAction {
  id: string;
  meetingId: string;
  meetingTitle: string;
  company: string;
  description: string;
  dueOn: string;
}
export interface HomeData {
  today: string;
  upcoming: HomeMeeting[];
  myActions: HomeAction[];
  awaitingNotes: HomeMeeting[];
  recent: HomeMeeting[];
  totals: { upcoming: number; myActions: number; awaitingNotes: number };
}
