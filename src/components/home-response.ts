import {
  homeBlockIds,
  type HomeData,
  type HomeLayout,
  type HomeLayoutBlock,
  type HomeMeeting,
} from "../lib/home-contracts.ts";
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Home data could not be read. Please retry.");
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string")
    throw new Error("Home data could not be read. Please retry.");
  return value;
}
function date(value: unknown): string {
  const result = text(value);
  if (!Number.isFinite(Date.parse(result)))
    throw new Error("Home contains an invalid date. Please retry.");
  return result;
}
function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("Home contains an invalid count. Please retry.");
  return value;
}
function list<T>(value: unknown, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(value))
    throw new Error("Home data could not be read. Please retry.");
  return value.map(parse);
}
function meeting(value: unknown): HomeMeeting {
  const row = object(value);
  return {
    id: text(row.id),
    title: text(row.title),
    company: text(row.company),
    startsAt: date(row.startsAt),
    updatedAt: date(row.updatedAt),
  };
}
export function parseHomeLayout(value: unknown): HomeLayout {
  const row = object(value);
  if (
    typeof row.version !== "number" ||
    !Number.isSafeInteger(row.version) ||
    row.version < 0 ||
    !Array.isArray(row.blocks) ||
    row.blocks.length !== homeBlockIds.length
  )
    throw new Error("Home layout could not be read. Please retry.");
  const blocks = row.blocks.map((item): HomeLayoutBlock => {
    const b = object(item);
    const id = homeBlockIds.find((known) => known === b.id);
    if (!id || typeof b.visible !== "boolean")
      throw new Error("Home layout could not be read. Please retry.");
    return { id, visible: b.visible };
  });
  if (new Set(blocks.map((b) => b.id)).size !== blocks.length)
    throw new Error("Home layout could not be read. Please retry.");
  return { version: row.version, blocks };
}
export function parseHome(value: unknown): HomeData {
  const row = object(value),
    totals = object(row.totals);
  return {
    today: date(row.today),
    upcoming: list(row.upcoming, meeting),
    awaitingNotes: list(row.awaitingNotes, meeting),
    recent: list(row.recent, meeting),
    myActions: list(row.myActions, (value) => {
      const action = object(value);
      return {
        id: text(action.id),
        meetingId: text(action.meetingId),
        meetingTitle: text(action.meetingTitle),
        company: text(action.company),
        description: text(action.description),
        dueOn: date(action.dueOn),
      };
    }),
    totals: {
      upcoming: count(totals.upcoming),
      myActions: count(totals.myActions),
      awaitingNotes: count(totals.awaitingNotes),
    },
  };
}
