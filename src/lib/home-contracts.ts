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
export const homeBlockIds = [
  "upcoming",
  "myActions",
  "awaitingNotes",
  "recent",
] as const;
export type HomeBlockId = (typeof homeBlockIds)[number];
export interface HomeLayoutBlock {
  id: HomeBlockId;
  visible: boolean;
}
// version 0 means no saved layout: the default order is in effect.
export interface HomeLayout {
  version: number;
  blocks: HomeLayoutBlock[];
}
export const defaultHomeBlocks = (): HomeLayoutBlock[] =>
  homeBlockIds.map((id) => ({ id, visible: true }));
export interface HomeData {
  today: string;
  upcoming: HomeMeeting[];
  myActions: HomeAction[];
  awaitingNotes: HomeMeeting[];
  recent: HomeMeeting[];
  totals: { upcoming: number; myActions: number; awaitingNotes: number };
}
