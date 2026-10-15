import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  ContactCreate,
  ContactDetail,
  ContactEdit,
  ContactRow,
  Lookups,
  SessionView,
} from "@/lib/contracts";
import { ApiError, errorMessage, request, unauthorized } from "./api";
import { parseContactRow } from "./response";

export default function ContactForm({
  contact,
  lookups,
  session,
  onClose,
  onSaved,
  onExpired,
  onReload,
}: {
  contact?: ContactDetail;
  lookups: Lookups;
  session: SessionView;
  onClose: () => void;
  onSaved: (contact: ContactRow) => void;
  onExpired: () => void;
  onReload: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const submitting = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    dialog.current?.showModal();
    return () => {
      mounted.current = false;
    };
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = new FormData(event.currentTarget);
    const field = (key: string) => String(form.get(key) ?? "").trim();
    const shared = {
      name: field("name"),
      email: field("email"),
      phone: field("phone"),
      ownerId: field("ownerId"),
    };
    const body: ContactEdit | ContactCreate = contact
      ? { ...shared, version: contact.contact.version }
      : {
          ...shared,
          companyId: field("companyId"),
          title: field("title"),
          ratingGroupIds: form.getAll("ratingGroupIds").map(String),
        };
    submitting.current = true;
    setBusy(true);
    setError("");
    setConflict(false);
    try {
      const result = await request<ContactRow>(
        contact
          ? `/api/contacts/${encodeURIComponent(contact.contact.id)}`
          : "/api/contacts",
        parseContactRow,
        {
          method: contact ? "PATCH" : "POST",
          body,
          csrfToken: session.csrfToken,
        },
      );
      if (mounted.current) onSaved(result);
    } catch (error) {
      if (mounted.current) {
        if (unauthorized(error)) onExpired();
        else {
          setError(errorMessage(error));
          setConflict(error instanceof ApiError && error.status === 409);
        }
      }
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <dialog
      className="edit-dialog"
      ref={dialog}
      aria-labelledby="form-title"
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onClose();
      }}
    >
      <div className="dialog-heading">
        <div>
          <div className="eyebrow">Relationship directory</div>
          <h2 id="form-title">
            {contact ? "Edit contact" : "Create a contact"}
          </h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close contact form"
          disabled={busy}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <p className="muted">
        {contact
          ? "Update communication details and ownership. Employment history stays linked to the company record."
          : "Link a person to their company, ratings coverage and relationship owner."}
      </p>
      <form onSubmit={(event) => void submit(event)}>
        <div className="form-grid">
          <label>
            Full name
            <input
              name="name"
              required
              maxLength={160}
              defaultValue={contact?.contact.name}
            />
          </label>
          <label>
            Email address
            <input
              name="email"
              type="email"
              required
              maxLength={254}
              defaultValue={contact?.contact.email}
            />
          </label>
          <label>
            Phone number
            <input
              name="phone"
              type="tel"
              maxLength={80}
              defaultValue={contact?.contact.phone}
            />
          </label>
          <label>
            Coverage owner
            <select
              name="ownerId"
              required
              defaultValue={contact?.contact.ownerId ?? ""}
            >
              <option value="" disabled>
                Select an owner
              </option>
              {lookups.owners.map((owner) => (
                <option value={owner.id} key={owner.id}>
                  {owner.name}
                </option>
              ))}
            </select>
          </label>
          {!contact && (
            <>
              <label>
                Company
                <select name="companyId" required defaultValue="">
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
                <input name="title" required maxLength={160} />
              </label>
              <fieldset className="group-field">
                <legend>Ratings Groups</legend>
                <div className="checkboxes">
                  {lookups.ratingGroups.map((group) => (
                    <label className="checkbox" key={group.id}>
                      <input
                        type="checkbox"
                        name="ratingGroupIds"
                        value={group.id}
                      />
                      <span>
                        {group.code}
                        <small>{group.name}</small>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </>
          )}
        </div>
        {error && (
          <div className="error" role="alert">
            <p>{error}</p>
            {conflict && (
              <>
                <p>
                  Your draft has not overwritten the newer record. Reload the
                  latest version before trying again.
                </p>
                <button type="button" className="secondary" onClick={onReload}>
                  Discard draft & reload latest record
                </button>
              </>
            )}
          </div>
        )}
        <div className="dialog-actions">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : contact ? "Save changes" : "Create contact"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
