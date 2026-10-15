import test from "node:test";
import assert from "node:assert/strict";
import {
  parseSession,
  parseContactRow,
  parseContactPage,
  parseLookups,
  parseContactDetail,
  parseCompanyDetail,
  parseCreatedId,
  parseOk,
} from "../src/components/response.ts";
const contact = {
  id: "p1",
  name: "Fictional Person",
  email: "person@example.test",
  phone: "",
  version: 1,
  companyId: "c1",
  company: "Example",
  title: "Analyst",
  ownerId: "u1",
  owner: "Owner",
  team: "Team",
  ratingGroups: ["CFG"],
};
test("all endpoint parsers reject malformed top-level success values", () => {
  for (const parser of [
    parseSession,
    parseContactRow,
    parseContactPage,
    parseLookups,
    parseContactDetail,
    parseCompanyDetail,
    parseCreatedId,
    parseOk,
  ])
    for (const value of [null, [], {}, "success", true])
      assert.throws(() => parser(value), /unexpected response/);
});
test("session role and nested organisation/CSRF fields are validated", () => {
  const value = {
    user: { id: "u1", name: "User" },
    membership: { id: "m1", role: "editor", teamId: "t1" },
    organisation: {
      id: "o1",
      name: "Org",
      accent: "#2962ff",
      integrationMode: "synthetic",
    },
    csrfToken: "token",
  };
  assert.equal(parseSession(value).membership.role, "editor");
  assert.throws(() => parseSession({ ...value, csrfToken: undefined }));
  assert.throws(() =>
    parseSession({
      ...value,
      membership: { ...value.membership, role: "superuser" },
    }),
  );
  assert.throws(() => parseSession({ ...value, organisation: { id: "o1" } }));
});
test("contact rows and pages validate nested rows, versions, nullable fields and pagination", () => {
  assert.deepEqual(parseContactRow(contact), contact);
  assert.equal(
    parseContactRow({ ...contact, companyId: null, company: null, title: null })
      .companyId,
    null,
  );
  for (const change of [
    { version: 0 },
    { version: 1.5 },
    { ratingGroups: [1] },
    { email: null },
    { companyId: undefined },
  ])
    assert.throws(() => parseContactRow({ ...contact, ...change }));
  assert.equal(
    parseContactPage({ rows: [contact], total: 1, page: 1, pageSize: 10 }).rows
      .length,
    1,
  );
  for (const change of [
    { rows: [{}] },
    { total: -1 },
    { page: 0 },
    { pageSize: 0 },
  ])
    assert.throws(() =>
      parseContactPage({
        rows: [contact],
        total: 1,
        page: 1,
        pageSize: 10,
        ...change,
      }),
    );
});
test("lookup and profile child records are checked before rendering", () => {
  assert.equal(
    parseLookups({
      companies: [{ id: "c1", name: "Example" }],
      owners: [],
      ratingGroups: [{ id: "g1", name: "Corporate", code: "CFG" }],
    }).ratingGroups[0].code,
    "CFG",
  );
  assert.throws(() =>
    parseLookups({ companies: [], owners: [], ratingGroups: [{ id: "g1" }] }),
  );
  const meeting = {
    id: "m1",
    title: "Conversation",
    startsAt: "2026-09-09T10:00:00Z",
    participants: [
      { name: "Person", title: "Then-title", company: "Then-company" },
    ],
    internalParticipants: [{ name: "Owner", title: "Analyst" }],
  };
  const detail = {
    contact,
    employments: [
      {
        id: "e1",
        companyId: "c1",
        company: "Example",
        title: "Analyst",
        startedOn: "2026-01-01",
        endedOn: null,
      },
    ],
    meetings: [meeting],
  };
  assert.equal(
    parseContactDetail(detail).meetings[0].participants[0].title,
    "Then-title",
  );
  assert.throws(() =>
    parseContactDetail({
      ...detail,
      meetings: [{ ...meeting, startsAt: "bad-date" }],
    }),
  );
  assert.throws(() =>
    parseContactDetail({
      ...detail,
      meetings: [{ ...meeting, participants: [{ name: "Person" }] }],
    }),
  );
  assert.equal(
    parseCompanyDetail({
      id: "c1",
      name: "Example",
      sector: "Finance",
      contacts: [contact],
      meetings: [meeting],
    }).contacts.length,
    1,
  );
  assert.throws(() =>
    parseCompanyDetail({
      id: "c1",
      name: "Example",
      sector: "Finance",
      contacts: [null],
      meetings: [],
    }),
  );
});
