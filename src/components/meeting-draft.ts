import { showDraftDialog } from "./draft-dialog.ts";
/** Exact control comparison means reverting edits removes the warning. */
export function draftFingerprint(entries: Iterable<[string, unknown]>) {
  return JSON.stringify(
    Array.from(entries, ([key, value]) => [key, String(value)]),
  );
}
export function shouldBlockNavigation(
  dirty: boolean,
  current: string,
  next: string,
) {
  return dirty && current !== next;
}
let checkDraft: (() => Promise<boolean>) | undefined;
let acceptedHash: (() => string) | undefined;
/** Router snapshots must not read a speculative URL before hashchange is guarded. */
export function readMeetingRouteHash() {
  return acceptedHash?.() ?? window.location.hash;
}
export async function confirmMeetingNavigation() {
  return checkDraft?.() ?? true;
}
/** Install only while an editable meeting is mounted. No draft is stored externally. */
export function installMeetingGuard(
  isDirty: () => boolean,
  host: Window = window,
  isSaving: () => boolean = () => false,
  ask: (saving: boolean) => Promise<boolean> = showDraftDialog,
) {
  let accepted = host.location.href;
  let alive = true;
  let pending = false;
  let allowed: string | undefined;
  const readAcceptedHash = () =>
    isDirty() || isSaving()
      ? new URL(accepted).hash
      : new URL(host.location.href).hash;
  acceptedHash = readAcceptedHash;
  const confirm = async () => {
    if (pending) return false;
    if (!isDirty() && !isSaving()) return true;
    pending = true;
    const saving = isSaving();
    try {
      const answer = await ask(saving);
      return alive && !saving && !isSaving() && answer;
    } finally {
      pending = false;
    }
  };
  checkDraft = confirm;
  const propose = (destination: string) => {
    void confirm().then((discard) => {
      if (!discard || !alive) return;
      allowed = destination;
      host.location.href = destination;
    });
  };
  const click = (event: MouseEvent) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const element = event.target;
    if (!(element instanceof Element)) return;
    const anchor = element.closest("a[href]");
    if (
      !(anchor instanceof HTMLAnchorElement) ||
      anchor.hasAttribute("download") ||
      (anchor.target && anchor.target !== "_self")
    )
      return;
    const next = new URL(anchor.href, accepted);
    const current = new URL(accepted);
    if (
      next.origin !== current.origin ||
      next.pathname !== current.pathname ||
      next.search !== current.search ||
      next.hash === "#main"
    )
      return;
    if (!shouldBlockNavigation(isDirty() || isSaving(), accepted, next.href))
      return;
    // Block default navigation and React handlers before the speculative URL exists.
    event.preventDefault();
    event.stopImmediatePropagation();
    propose(next.href);
  };
  const hash = (event: HashChangeEvent) => {
    if (allowed === host.location.href) {
      accepted = host.location.href;
      allowed = undefined;
      return;
    }
    if (
      shouldBlockNavigation(
        isDirty() || isSaving(),
        accepted,
        host.location.href,
      )
    ) {
      const destination = host.location.href;
      host.history.replaceState(host.history.state, "", accepted);
      event.stopImmediatePropagation();
      propose(destination);
      return;
    }
    accepted = host.location.href;
  };
  const unload = (event: BeforeUnloadEvent) => {
    if (!isDirty() && !isSaving()) return;
    event.preventDefault();
    event.returnValue = "";
  };
  host.addEventListener("hashchange", hash, true);
  host.addEventListener("click", click, true);
  host.addEventListener("beforeunload", unload);
  return () => {
    alive = false;
    host.removeEventListener("hashchange", hash, true);
    host.removeEventListener("click", click, true);
    host.removeEventListener("beforeunload", unload);
    if (checkDraft === confirm) checkDraft = undefined;
    if (acceptedHash === readAcceptedHash) acceptedHash = undefined;
  };
}
