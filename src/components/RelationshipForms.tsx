import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  ContactDetail,
  ContactRow,
  Lookups,
  SessionView,
} from "@/lib/contracts";
import { ApiError, errorMessage, request, unauthorized } from "./api";
import { parseContactPage, parseContactRow, parseCreatedId } from "./response";
import { useResource } from "./useResource";

type Props = {
  contact: ContactDetail;
  lookups: Lookups;
  session: SessionView;
  onClose: () => void;
  onSaved: () => void;
  onExpired: () => void;
  onReload: () => void;
};
function useSave(
  session: SessionView,
  onSaved: () => void,
  onExpired: () => void,
) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [conflict, setConflict] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function save<T>(
    path: string,
    body: unknown,
    parser: (value: unknown) => T,
  ) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setConflict(false);
    try {
      await request(path, parser, {
        method: "POST",
        body,
        csrfToken: session.csrfToken,
      });
      if (mounted.current) onSaved();
    } catch (error) {
      if (mounted.current) {
        if (unauthorized(error)) onExpired();
        else {
          setError(errorMessage(error));
          setConflict(error instanceof ApiError && error.status === 409);
        }
      }
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return { busy, error, conflict, save };
}
function Modal({
  title,
  busy,
  onClose,
  children,
}: {
  title: string;
  busy: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      className="edit-dialog"
      ref={dialog}
      aria-labelledby="relationship-title"
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onClose();
      }}
    >
      <div className="dialog-heading">
        <div>
          <div className="eyebrow">Relationship record</div>
          <h2 id="relationship-title">{title}</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close form"
          disabled={busy}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
function Feedback({
  error,
  conflict,
  onReload,
}: {
  error: string;
  conflict: boolean;
  onReload: () => void;
}) {
  return error ? (
    <div className="error" role="alert">
      <p>{error}</p>
      {conflict && (
        <>
          <p>The record has changed. Your draft has not overwritten it.</p>
          <button className="secondary" type="button" onClick={onReload}>
            Discard draft & reload latest record
          </button>
        </>
      )}
    </div>
  ) : null;
}
export function EmploymentForm(props: Props) {
  const { contact, lookups, session, onClose, onSaved, onExpired, onReload } =
    props;
  const save = useSave(session, onSaved, onExpired);
  const today = new Date().toLocaleDateString("en-CA");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void save.save(
      `/api/contacts/${encodeURIComponent(contact.contact.id)}/employment`,
      {
        version: contact.contact.version,
        companyId: String(form.get("companyId")),
        title: String(form.get("title")).trim(),
        startedOn: String(form.get("startedOn")),
      },
      parseContactRow,
    );
  }
  return (
    <Modal title="Update employment" busy={save.busy} onClose={onClose}>
      <p className="muted">
        Record a new role for {contact.contact.name}. Previous employment and
        meeting-time titles remain in the relationship history.
      </p>
      <form onSubmit={submit}>
        <div className="form-grid">
          <label>
            Company
            <select
              name="companyId"
              required
              defaultValue={contact.contact.companyId ?? ""}
            >
              <option value="" disabled>
                Select a company
              </option>
              {lookups.companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Job title
            <input
              name="title"
              required
              maxLength={160}
              defaultValue={contact.contact.title ?? ""}
            />
          </label>
          <label>
            Effective date
            <input
              name="startedOn"
              type="date"
              required
              max={today}
              defaultValue={today}
            />
          </label>
        </div>
        <Feedback {...save} onReload={onReload} />
        <div className="dialog-actions">
          <button
            type="button"
            className="secondary"
            disabled={save.busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="primary" disabled={save.busy}>
            {save.busy ? "Saving…" : "Save employment change"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function MeetingForm(
  props: Omit<Props, "contact"> & { contact?: ContactDetail },
) {
  const { contact, lookups, session, onClose, onSaved, onExpired, onReload } =
    props;
  const save = useSave(session, onSaved, onExpired);
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ContactRow[]>(
    contact ? [contact.contact] : [],
  );
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  const contacts = useResource(
    `/api/contacts?${new URLSearchParams({ q: query, page: String(page), pageSize: "5", sort: "name", direction: "asc" })}`,
    0,
    onExpired,
    parseContactPage,
  );
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void save.save(
      "/api/meetings",
      {
        title: String(form.get("title")).trim(),
        companyId: String(form.get("companyId")),
        startsAt: new Date(String(form.get("startsAt"))).toISOString(),
        contactIds: selected.map((person) => person.id),
        internalMemberIds: form.getAll("internalMemberIds").map(String),
      },
      parseCreatedId,
    );
  }
  return (
    <Modal title="New meeting" busy={save.busy} onClose={onClose}>
      <p className="muted">
        Create a CRM meeting with selected participants. This does not send
        calendar invitations or connect to Outlook.
      </p>
      <form onSubmit={submit}>
        <div className="form-grid">
          <label>
            Meeting title
            <input name="title" required maxLength={200} />
          </label>
          <label>
            Start · your browser’s local time
            <input name="startsAt" type="datetime-local" required />
          </label>
          <label>
            Primary company
            <select
              name="companyId"
              required
              defaultValue={contact?.contact.companyId ?? ""}
            >
              <option value="" disabled>
                Select a company
              </option>
              {lookups.companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <fieldset className="participant-field">
          <legend>External participants · {selected.length} selected</legend>
          {!selected.length && (
            <p className="muted">
              Select at least one contact before creating the meeting.
            </p>
          )}
          <div className="active-filters">
            {selected.map((person) => (
              <span className="tag" key={person.id}>
                {person.name}
                {person.id !== contact?.contact.id && (
                  <button
                    type="button"
                    aria-label={`Remove ${person.name}`}
                    onClick={() =>
                      setSelected((current) =>
                        current.filter((item) => item.id !== person.id),
                      )
                    }
                  >
                    {" "}
                    ×
                  </button>
                )}
              </span>
            ))}
          </div>
          <label className="search-label">
            Find a contact
            <input
              type="search"
              placeholder="Search name, company or email…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          {contacts.loading && <p role="status">Finding contacts…</p>}
          {contacts.error && (
            <p role="alert" className="error">
              {contacts.error}
            </p>
          )}
          {contacts.value?.rows.map((person) => (
            <label className="participant-option" key={person.id}>
              <input
                type="checkbox"
                checked={selected.some((item) => item.id === person.id)}
                disabled={person.id === contact?.contact.id}
                onChange={(event) =>
                  setSelected((current) =>
                    event.target.checked
                      ? [...current, person]
                      : current.filter((item) => item.id !== person.id),
                  )
                }
              />
              <span>
                {person.name}
                <small>
                  {person.title} · {person.company}
                </small>
              </span>
            </label>
          ))}
          {contacts.value && !contacts.value.rows.length && (
            <p className="muted">No contacts found for this search.</p>
          )}
          <div className="participant-paging">
            <button
              type="button"
              className="secondary"
              disabled={page === 1 || contacts.loading}
              onClick={() => setPage((value) => value - 1)}
            >
              Previous
            </button>
            <small>Page {page}</small>
            <button
              type="button"
              className="secondary"
              disabled={
                contacts.loading ||
                !contacts.value ||
                page * contacts.value.pageSize >= contacts.value.total
              }
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </button>
          </div>
        </fieldset>
        <fieldset className="participant-field">
          <legend>Internal participants · fictional</legend>
          {lookups.owners.map((owner) => (
            <label className="participant-option" key={owner.id}>
              <input
                type="checkbox"
                name="internalMemberIds"
                value={owner.id}
                defaultChecked={owner.id === session.membership.id}
              />
              <span>{owner.name}</span>
            </label>
          ))}
        </fieldset>
        <Feedback {...save} onReload={onReload} />
        <div className="dialog-actions">
          <button
            type="button"
            className="secondary"
            disabled={save.busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="primary"
            disabled={save.busy || selected.length === 0}
          >
            {save.busy ? "Saving…" : "Create linked meeting"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
