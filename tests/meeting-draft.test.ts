import test from "node:test";
import assert from "node:assert/strict";
import {
  draftFingerprint,
  shouldBlockNavigation,
  installMeetingGuard,
  confirmMeetingNavigation,
  readMeetingRouteHash,
} from "../src/components/meeting-draft.ts";

test("draft comparison detects edits, inserted actions and exact reverts", () => {
  const initial = [["notes", "Original"]] as [string, unknown][];
  assert.equal(
    draftFingerprint(initial),
    draftFingerprint([["notes", "Original"]]),
  );
  assert.notEqual(
    draftFingerprint(initial),
    draftFingerprint([["notes", "Original "]]),
  );
  assert.notEqual(
    draftFingerprint(initial),
    draftFingerprint([...initial, ["description-0", ""]]),
  );
  assert.equal(shouldBlockNavigation(false, "#meeting/a", "#home"), false);
  assert.equal(shouldBlockNavigation(true, "#meeting/a", "#meeting/a"), false);
  assert.equal(shouldBlockNavigation(true, "#meeting/a", "#home"), true);
});

test("cancelled hash exit restores route before router, dirty unload warns, saved draft does not", async () => {
  const listeners = new Map<string, EventListener>();
  let dirty = true,
    allow = false,
    prompts = 0,
    stopped = false;
  const location = { href: "http://localhost/#meeting/a" };
  const host = {
    location,
    history: {
      state: null,
      replaceState: (_state: unknown, _title: string, url: string) => {
        location.href = url;
      },
    },
    confirm: () => {
      prompts++;
      return allow;
    },
    addEventListener: (name: string, callback: EventListener) =>
      listeners.set(name, callback),
    removeEventListener: (name: string) => listeners.delete(name),
  } as unknown as Window;
  const cleanup = installMeetingGuard(
    () => dirty,
    host,
    () => false,
    async () => {
      prompts++;
      return allow;
    },
  );
  location.href = "http://localhost/#home";
  assert.equal(
    readMeetingRouteHash(),
    "#meeting/a",
    "router must ignore speculative URL before hashchange",
  );
  listeners.get("hashchange")!({
    stopImmediatePropagation: () => {
      stopped = true;
    },
  } as unknown as Event);
  assert.equal(location.href, "http://localhost/#meeting/a");
  assert.equal(stopped, true);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(await confirmMeetingNavigation(), false);
  let prevented = false;
  listeners.get("beforeunload")!({
    preventDefault: () => {
      prevented = true;
    },
    returnValue: undefined,
  } as unknown as Event);
  assert.equal(prevented, true);
  allow = true;
  assert.equal(await confirmMeetingNavigation(), true);
  dirty = false;
  const before = prompts;
  assert.equal(await confirmMeetingNavigation(), true);
  assert.equal(prompts, before);
  prevented = false;
  listeners.get("beforeunload")!({
    preventDefault: () => {
      prevented = true;
    },
  } as unknown as Event);
  assert.equal(prevented, false);
  cleanup();
  assert.equal(listeners.size, 0);
  assert.equal(await confirmMeetingNavigation(), true);
});

test("pending save rejects navigation even when a draft is otherwise clean", async () => {
  let alerts = 0;
  const host = {
    location: { href: "http://localhost/#meeting/a" },
    alert: () => {
      alerts++;
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as Window;
  const cleanup = installMeetingGuard(
    () => false,
    host,
    () => true,
    async (saving) => {
      assert.equal(saving, true);
      alerts++;
      return true;
    },
  );
  assert.equal(await confirmMeetingNavigation(), false);
  assert.equal(alerts, 1);
  cleanup();
});

test("hash navigation waits for explicit discard and permits committed destination once", async () => {
  let answer: ((value: boolean) => void) | undefined;
  const listeners = new Map<string, EventListener>();
  const location = { href: "http://localhost/#meeting/a" };
  const host = {
    location,
    history: {
      state: null,
      replaceState: (_state: unknown, _title: string, url: string) => {
        location.href = url;
      },
    },
    addEventListener: (name: string, callback: EventListener) =>
      listeners.set(name, callback),
    removeEventListener: (name: string) => listeners.delete(name),
  } as unknown as Window;
  const cleanup = installMeetingGuard(
    () => true,
    host,
    () => false,
    () =>
      new Promise<boolean>((resolve) => {
        answer = resolve;
      }),
  );
  let blocked = 0;
  const event = {
    stopImmediatePropagation: () => {
      blocked++;
    },
  } as unknown as Event;
  location.href = "http://localhost/#home";
  listeners.get("hashchange")!(event);
  assert.equal(location.href, "http://localhost/#meeting/a");
  assert.equal(blocked, 1);
  answer!(true);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(location.href, "http://localhost/#home");
  listeners.get("hashchange")!(event);
  assert.equal(blocked, 1);
  assert.equal(readMeetingRouteHash(), "#home");
  cleanup();
});

test("next-task router notification survives a microtask checkpoint between listeners", async () => {
  let dirty = false;
  const listeners = new Map<string, EventListener>();
  const location = { href: "http://localhost/#meeting/a" };
  const host = {
    location,
    history: {
      state: null,
      replaceState: (_state: unknown, _title: string, url: string) => {
        location.href = url;
      },
    },
    addEventListener: (name: string, callback: EventListener) =>
      listeners.set(name, callback),
    removeEventListener: (name: string) => listeners.delete(name),
  } as unknown as Window;
  const cleanup = installMeetingGuard(
    () => dirty,
    host,
    () => false,
    async () => false,
  );
  let observed = "";
  const routerFirst = () =>
    setTimeout(() => {
      observed = readMeetingRouteHash();
    }, 0);
  const event = { stopImmediatePropagation: () => {} } as unknown as Event;
  location.href = "http://localhost/#home";
  routerFirst();
  assert.equal(
    readMeetingRouteHash(),
    "#home",
    "clean drafts use actual URL immediately",
  );
  // Browsers may checkpoint microtasks between separately invoked listeners.
  // A task, unlike queueMicrotask, cannot sample the snapshot at this point.
  await Promise.resolve();
  assert.equal(observed, "");
  listeners.get("hashchange")!(event);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    observed,
    "#home",
    "clean navigation must publish its new accepted snapshot",
  );
  dirty = true;
  location.href = "http://localhost/#contacts";
  routerFirst();
  await Promise.resolve();
  listeners.get("hashchange")!(event);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    observed,
    "#home",
    "cancelled navigation must not publish speculative destination",
  );
  cleanup();
});
