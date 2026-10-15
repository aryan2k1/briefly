import test from "node:test";
import assert from "node:assert/strict";
import {
  parseMeetingRow,
  parseMeetingPage,
  parseMeetingDetail,
  parseOverview,
  parseBriefing,
  parseSavedMeeting,
  parseSimulatedImport,
} from "../src/components/unified-response.ts";
const row = {
  id: "meeting-1",
  title: "Synthetic conversation",
  startsAt: "2026-09-10T10:00:00Z",
  timeZone: "Europe/London",
  companyId: "company-1",
  company: "Example company",
  version: 1,
  status: "scheduled",
  source: "manual",
  tags: ["Liquidity"],
  participantCount: 2,
};
const detail = {
  ...row,
  notes: "Stored discussion",
  updatedAt: "2026-09-09T12:00:00Z",
  participants: [
    {
      contactId: "p1",
      name: "Person",
      title: "Historical analyst title",
      company: "Company then",
    },
  ],
  internalParticipants: [
    { membershipId: "u1", name: "Internal", title: "Senior analyst" },
  ],
  actions: [
    {
      id: "a1",
      description: "Send methodology",
      ownerId: "u1",
      owner: "Internal",
      dueOn: "2026-09-11",
      status: "open",
    },
  ],
};
test("unified parsers reject malformed endpoint envelopes", () => {
  for (const parser of [
    parseMeetingRow,
    parseMeetingPage,
    parseMeetingDetail,
    parseOverview,
    parseBriefing,
    parseSavedMeeting,
    parseSimulatedImport,
  ])
    for (const input of [null, [], {}, true, "success"])
      assert.throws(() => parser(input), /unexpected meeting response/);
});
test("meeting rows and page bounds validate before rendering", () => {
  assert.deepEqual(parseMeetingRow(row), row);
  for (const change of [
    { status: "unknown" },
    { source: "live" },
    { version: 0 },
    { startsAt: "not-a-date" },
    { tags: [12] },
    { participantCount: -1 },
  ])
    assert.throws(() => parseMeetingRow({ ...row, ...change }));
  assert.equal(
    parseMeetingPage({ rows: [row], total: 1, page: 1, pageSize: 10 }).total,
    1,
  );
  for (const change of [
    { rows: [{}] },
    { total: -1 },
    { page: 0 },
    { pageSize: 0 },
  ])
    assert.throws(() =>
      parseMeetingPage({
        rows: [row],
        total: 1,
        page: 1,
        pageSize: 10,
        ...change,
      }),
    );
});
test("meeting detail validates historical snapshots and follow-ups", () => {
  assert.equal(
    parseMeetingDetail(detail).participants[0].title,
    "Historical analyst title",
  );
  for (const change of [
    { notes: null },
    { participants: [{ contactId: "p1" }] },
    { internalParticipants: [{ name: "Internal" }] },
    { actions: [{ ...detail.actions[0], status: "completed" }] },
    { actions: [{ ...detail.actions[0], dueOn: "not-a-date" }] },
  ])
    assert.throws(() => parseMeetingDetail({ ...detail, ...change }));
});
test("overview and briefing validate every source branch", () => {
  const overview = {
    totalMeetings: 1,
    completedMeetings: 0,
    upcomingMeetings: 1,
    contacts: 2,
    openActions: 1,
    missingNotes: 0,
    themes: [{ tag: "Liquidity", count: 1 }],
    recent: [row],
  };
  assert.equal(parseOverview(overview).recent.length, 1);
  assert.throws(() =>
    parseOverview({ ...overview, themes: [{ tag: "Liquidity", count: -1 }] }),
  );
  const briefing = {
    meeting: detail,
    previousWithPeople: [detail],
    relatedCompany: [],
    generatedAt: "2026-09-09T12:00:00Z",
    simulation: {
      label: "Fictional fixture",
      signals: [
        {
          headline: "Fictional news",
          detail: "Synthetic context",
          source: "Fixture source",
          publishedAt: "2026-09-08T09:00:00Z",
        },
      ],
    },
  };
  assert.equal(
    parseBriefing(briefing).previousWithPeople[0].actions[0].id,
    "a1",
  );
  assert.throws(() => parseBriefing({ ...briefing, relatedCompany: [{}] }));
  assert.throws(() =>
    parseBriefing({
      ...briefing,
      simulation: {
        label: "Fixture",
        signals: [{ headline: "Missing provenance" }],
      },
    }),
  );
  assert.deepEqual(parseSavedMeeting({ id: "meeting-1", version: 2 }), {
    id: "meeting-1",
    version: 2,
  });
  assert.deepEqual(
    parseSimulatedImport({
      message: "Imported fixture",
      meetingId: "meeting-1",
    }),
    { message: "Imported fixture", meetingId: "meeting-1" },
  );
});
