"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import type {
  ContactDetail,
  ContactRow,
  Lookups,
  SessionView,
} from "@/lib/contracts";
import { errorMessage, request, unauthorized } from "./api";
import { useResource } from "./useResource";
import ContactsGrid from "./ContactsGrid";
import Profile, { type Selection } from "./Profile";
import ContactForm from "./ContactForm";
import { EmploymentForm, MeetingForm } from "./RelationshipForms";
import { parseSession, parseLookups, parseOk } from "./response";
import UnifiedContent from "./UnifiedContent";
import {
  confirmMeetingNavigation,
  readMeetingRouteHash,
} from "./meeting-draft";

const destinations = [
  ["calendar", "Home"],
  ["overview", "Team overview"],
  ["contacts", "Contacts"],
  ["meetings", "Meetings"],
  ["briefings", "Briefings"],
  ["ask", "Search"],
  ["connections", "Connections"],
];
const readRoute = () => {
  const route = readMeetingRouteHash().slice(1);
  return !route || route === "main" ? "calendar" : route;
};
function subscribeRoute(listener: () => void) {
  // Read only after the guard has accepted or restored the URL. Window event
  // listener ordering must not leave a clean navigation on the previous screen.
  let active = true;
  const changed = () =>
    setTimeout(() => {
      if (active) listener();
    }, 0);
  window.addEventListener("hashchange", changed);
  return () => {
    active = false;
    window.removeEventListener("hashchange", changed);
  };
}

export default function Workspace() {
  const route = useSyncExternalStore(
    subscribeRoute,
    readRoute,
    () => "calendar",
  );
  const drawer = useRef<HTMLDialogElement>(null);
  const [session, setSession] = useState<SessionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [lookupAttempt, setLookupAttempt] = useState(0);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [editing, setEditing] = useState<ContactDetail | "new" | null>(null);
  const [activity, setActivity] = useState<{
    kind: "employment" | "meeting";
    contact: ContactDetail;
  } | null>(null);
  const lock = useRef(false);
  const profileTrigger = useRef<HTMLElement | null>(null);
  const changed = useCallback((message: string) => {
    setRevision((value) => value + 1);
    setNotice(message);
  }, []);
  useEffect(() => {
    const focus = () => {
      drawer.current?.close();
      document.getElementById("main")?.focus({ preventScroll: true });
    };
    window.addEventListener("hashchange", focus);
    return () => window.removeEventListener("hashchange", focus);
  }, []);
  const sessionExpired = useCallback(() => {
    setSession(null);
    setSelection(null);
    setEditing(null);
    setActivity(null);
    setNotice("Your local session expired. Choose a demo persona to continue.");
  }, []);
  const lookups = useResource<Lookups>(
    session ? "/api/lookups" : null,
    `${session?.membership.id ?? ""}:${lookupAttempt}`,
    sessionExpired,
    parseLookups,
  );
  useEffect(() => {
    const controller = new AbortController();
    request<SessionView>("/api/session", parseSession, {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) setSession(result);
      })
      .catch((error) => {
        if (!controller.signal.aborted && !unauthorized(error))
          setNotice(errorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);
  async function login(persona: "editor" | "viewer" | "other") {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setNotice("");
    try {
      const result = await request<SessionView>(
        "/api/auth/demo",
        parseSession,
        {
          method: "POST",
          body: { persona },
        },
      );
      setActivity(null);
      setSession(result);
      setRevision((value) => value + 1);
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function logout() {
    if (!session || lock.current) return;
    if (!(await confirmMeetingNavigation())) return;
    lock.current = true;
    setBusy(true);
    try {
      await request("/api/auth/logout", parseOk, {
        method: "POST",
        body: {},
        csrfToken: session.csrfToken,
      });
      setSession(null);
      setSelection(null);
      setEditing(null);
      setActivity(null);
      setNotice("");
    } catch (error) {
      if (unauthorized(error)) sessionExpired();
      else setNotice(errorMessage(error));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function saved(contact: ContactRow) {
    setEditing(null);
    setSelection({ kind: "contact", id: contact.id });
    setRevision((value) => value + 1);
    setNotice(
      "Contact saved. The directory and linked profile are up to date.",
    );
  }
  if (loading)
    return (
      <main className="loading-screen">
        <div className="brand">
          Briefly<span>.</span>
        </div>
        <p role="status">Opening your workspace…</p>
      </main>
    );
  if (!session)
    return (
      <main className="login">
        <section className="login-story">
          <div className="brand">
            Briefly<span>.</span>
          </div>
          <div>
            <div className="eyebrow">Relationship intelligence</div>
            <h1>Relationship workspace</h1>
            <p>Manage contacts, prepare for meetings and track follow-ups.</p>
          </div>
          <div className="login-foot">LOCAL FOUNDATION / SYNTHETIC DATA</div>
        </section>
        <section className="login-options">
          <div>
            <span className="pill">Synthetic demonstration</span>
            <h2>Choose a workspace role</h2>
            <p className="muted">
              Choose a fictional persona to explore linked contacts, company
              history and role-based editing.
            </p>
            <button
              className="persona"
              disabled={busy}
              onClick={() => void login("editor")}
            >
              <span className="persona-icon">✎</span>
              <span>
                <strong>Relationship editor</strong>
                <small>Create contacts and update coverage</small>
              </span>
              <span>→</span>
            </button>
            <button
              className="persona"
              disabled={busy}
              onClick={() => void login("viewer")}
            >
              <span className="persona-icon">◉</span>
              <span>
                <strong>Read-only viewer</strong>
                <small>Explore the same workspace without editing</small>
              </span>
              <span>→</span>
            </button>
            <button
              className="persona"
              disabled={busy}
              onClick={() => void login("other")}
            >
              <span className="persona-icon">▦</span>
              <span>
                <strong>Separate workspace</strong>
                <small>Explore a different organisation’s records</small>
              </span>
              <span>→</span>
            </button>
            {busy && <p role="status">Opening your workspace…</p>}
            {notice && (
              <p className="error" role="alert">
                {notice}
              </p>
            )}
            <p className="login-disclosure">
              Local demonstration only. No Microsoft identity, Outlook, Moody’s
              data or AI service is connected. All people and records are
              synthetic.
            </p>
          </div>
        </section>
      </main>
    );
  const editable = session.membership.role !== "viewer";
  const accent = /^#[0-9a-f]{6}$/i.test(session.organisation.accent)
    ? session.organisation.accent
    : "#2962ff";
  return (
    <div className="workspace" style={{ "--accent": accent } as CSSProperties}>
      <a
        href="#main"
        className="skip"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        Skip to main content
      </a>
      <header className="topbar">
        <button
          className="burger-button"
          aria-label="Open navigation"
          aria-haspopup="dialog"
          onClick={() => drawer.current?.showModal()}
        >
          ☰
        </button>
        <a className="brand" href="#calendar">
          Briefly<span>.</span>
        </a>
        <span className="workspace-label">{session.organisation.name}</span>
        <span className="pill dark">Synthetic workspace</span>
        <div className="user">
          <span className="avatar">
            {session.user.name
              .split(" ")
              .map((value) => value[0])
              .slice(0, 2)
              .join("")}
          </span>
          <span>
            {session.user.name}
            <small>{session.membership.role} · Synthetic persona</small>
          </span>
          <button
            className="signout"
            disabled={busy}
            onClick={() => void logout()}
          >
            Switch persona
          </button>
        </div>
      </header>
      <dialog
        ref={drawer}
        className="navigation-drawer"
        aria-label="Workspace navigation"
      >
        <div className="drawer-heading">
          <span className="brand">
            Briefly<span>.</span>
          </span>
          <button
            className="icon-button"
            aria-label="Close navigation"
            onClick={() => drawer.current?.close()}
          >
            ×
          </button>
        </div>
        <p className="drawer-workspace">
          {session.organisation.name}
          <br />
          Synthetic local workspace
        </p>
        <nav>
          {destinations.map(([target, label]) => (
            <a
              key={target}
              href={`#${target}`}
              aria-current={
                route.split("?")[0] === target ||
                (target === "meetings" &&
                  (route.startsWith("meeting/") || route === "meetings/new")) ||
                (target === "briefings" && route.startsWith("brief/"))
                  ? "page"
                  : undefined
              }
              onClick={() => drawer.current?.close()}
            >
              {label}
              <span>→</span>
            </a>
          ))}
        </nav>
        <p className="drawer-disclosure">
          Outlook, MCP and AI demonstrations are simulated.
        </p>
      </dialog>
      <div className="mobile-context">
        {session.organisation.name} · {session.user.name} · Synthetic data
      </div>
      <div className="workspace-nav">
        <span className="nav-active">
          {destinations.find(
            ([target]) => target === route.split("?")[0],
          )?.[1] ??
            (route.startsWith("brief/")
              ? "Meeting briefing"
              : route === "meetings/new"
                ? "New meeting"
                : route.startsWith("meeting/")
                  ? "Meeting record"
                  : "Workspace")}
        </span>
        <span className="nav-context">Relationship intelligence</span>
        <span className="nav-right">
          {editable ? "Editing enabled" : "Read-only access"}
        </span>
      </div>
      <main id="main" tabIndex={-1}>
        <UnifiedContent
          key={session.membership.id}
          route={route}
          lookups={lookups.value}
          lookupError={lookups.error}
          retryLookups={() => setLookupAttempt((value) => value + 1)}
          session={session}
          revision={revision}
          onExpired={sessionExpired}
          onChanged={changed}
        />
        <section hidden={route !== "contacts"} aria-label="Contact workspace">
          <div className="page-heading">
            <div>
              <div className="eyebrow">Directory</div>
              <h1>Contacts</h1>
              <p className="muted">
                Find and manage contacts, rating groups and coverage ownership.
              </p>
            </div>
            <div className="heading-actions">
              <button
                className="secondary"
                disabled={lookups.loading}
                onClick={() => {
                  setRevision((value) => value + 1);
                  if (lookups.error) setLookupAttempt((value) => value + 1);
                }}
              >
                ↻ Refresh
              </button>
              {editable && (
                <button
                  className="primary"
                  disabled={!lookups.value}
                  onClick={() => setEditing("new")}
                >
                  ＋ New contact
                </button>
              )}
            </div>
          </div>
          {!editable && (
            <div className="readonly-note">
              Read-only access. You can view contacts and company profiles; an
              editor can update them.
            </div>
          )}
          {lookups.error && (
            <p className="error" role="alert">
              {lookups.error}
            </p>
          )}
          {lookups.loading && !lookups.value && (
            <p role="status" className="empty">
              Loading workspace reference data…
            </p>
          )}
          {lookups.value && (
            <div
              className={`contact-layout ${selection ? "with-profile" : ""}`}
            >
              <ContactsGrid
                lookups={lookups.value}
                revision={revision}
                onExpired={sessionExpired}
                onSelect={(value) => {
                  profileTrigger.current =
                    document.activeElement instanceof HTMLElement
                      ? document.activeElement
                      : null;
                  setSelection(value);
                }}
                selectedId={
                  selection?.kind === "contact" ? selection.id : undefined
                }
              />
              {selection && (
                <Profile
                  selection={selection}
                  revision={revision}
                  onExpired={sessionExpired}
                  onSelect={setSelection}
                  onClose={() => {
                    setSelection(null);
                    profileTrigger.current?.focus();
                  }}
                  onEdit={setEditing}
                  onEmployment={(contact) =>
                    setActivity({ kind: "employment", contact })
                  }
                  onMeeting={(contact) =>
                    setActivity({ kind: "meeting", contact })
                  }
                  editable={editable}
                />
              )}
            </div>
          )}
        </section>
        <footer className="workspace-footer">
          <span>
            Synthetic records · Access limited to your workspace permissions
          </span>
          <span>Briefly</span>
        </footer>
      </main>
      {editing && lookups.value && editable && (
        <ContactForm
          contact={editing === "new" ? undefined : editing}
          lookups={lookups.value}
          session={session}
          onClose={() => setEditing(null)}
          onSaved={saved}
          onExpired={sessionExpired}
          onReload={() => {
            setEditing(null);
            setRevision((value) => value + 1);
          }}
        />
      )}
      {activity &&
        lookups.value &&
        editable &&
        (() => {
          const Form =
            activity.kind === "employment" ? EmploymentForm : MeetingForm;
          return (
            <Form
              contact={activity.contact}
              lookups={lookups.value}
              session={session}
              onClose={() => setActivity(null)}
              onExpired={sessionExpired}
              onReload={() => {
                setActivity(null);
                setRevision((value) => value + 1);
              }}
              onSaved={() => {
                setActivity(null);
                setRevision((value) => value + 1);
                setNotice(
                  activity.kind === "employment"
                    ? "Employment updated. Historical meeting titles have been preserved."
                    : "Meeting created and linked to all selected participants. No invitations were sent.",
                );
              }}
            />
          );
        })()}
      <div className="toast" role="status" aria-live="polite">
        {notice && (
          <>
            <span>{notice}</span>
            <button
              aria-label="Dismiss notification"
              onClick={() => setNotice("")}
            >
              ×
            </button>
          </>
        )}
      </div>
    </div>
  );
}
