import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHome, parseHomeLayout } from "../src/components/home-response.ts";
const empty = {
  today: "2026-09-14",
  upcoming: [],
  myActions: [],
  awaitingNotes: [],
  recent: [],
  totals: { upcoming: 0, myActions: 0, awaitingNotes: 0 },
};
test("Home parser accepts an empty authorised workspace", () =>
  assert.deepEqual(parseHome(empty), empty));
test("Home parser rejects malformed lists, dates and counts", () => {
  for (const value of [
    null,
    { ...empty, myActions: {} },
    { ...empty, today: "bad" },
    { ...empty, totals: { ...empty.totals, myActions: -1 } },
    { ...empty, myActions: [{ id: "1" }] },
  ])
    assert.throws(() => parseHome(value));
});
const layout = {
  version: 0,
  blocks: ["upcoming", "myActions", "awaitingNotes", "recent"].map((id) => ({
    id,
    visible: true,
  })),
};
test("Home layout parser accepts the default and a reordered layout", () => {
  assert.deepEqual(parseHomeLayout(layout), layout);
  const reordered = { version: 3, blocks: [...layout.blocks].reverse() };
  assert.deepEqual(parseHomeLayout(reordered), reordered);
});
test("Home layout parser rejects unknown, duplicate, missing and malformed blocks", () => {
  const [a, b, c, d] = layout.blocks;
  for (const value of [
    null,
    { ...layout, version: -1 },
    { ...layout, version: 1.5 },
    { ...layout, blocks: {} },
    { ...layout, blocks: [a, b, c] },
    { ...layout, blocks: [a, a, c, d] },
    { ...layout, blocks: [a, b, c, { id: "admin", visible: true }] },
    { ...layout, blocks: [a, b, c, { id: "recent", visible: "yes" }] },
  ])
    assert.throws(() => parseHomeLayout(value));
});
