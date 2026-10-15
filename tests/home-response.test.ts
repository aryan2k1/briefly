import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHome } from "../src/components/home-response.ts";
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
