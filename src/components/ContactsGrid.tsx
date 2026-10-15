import { useEffect, useState } from "react";
import type { ContactPage, Lookups } from "@/lib/contracts";
import { Groups, type Selection } from "./Profile";
import { useResource } from "./useResource";
import { parseContactPage } from "./response";

type Filters = {
  q: string;
  group: string;
  owner: string;
  company: string;
  page: number;
  sort: "name" | "company" | "owner";
  direction: "asc" | "desc";
};
const initial: Filters = {
  q: "",
  group: "",
  owner: "",
  company: "",
  page: 1,
  sort: "name",
  direction: "asc",
};
export default function ContactsGrid({
  lookups,
  revision,
  onExpired,
  onSelect,
  selectedId,
}: {
  lookups: Lookups;
  revision: number;
  onExpired: () => void;
  onSelect: (selection: Selection) => void;
  selectedId?: string;
}) {
  const [filters, setFilters] = useState<Filters>(initial);
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(
      () => setFilters((current) => ({ ...current, q: search, page: 1 })),
      250,
    );
    return () => clearTimeout(timer);
  }, [search]);
  const query = new URLSearchParams({
    ...filters,
    page: String(filters.page),
    pageSize: "10",
  });
  const resource = useResource<ContactPage>(
    `/api/contacts?${query}`,
    revision,
    onExpired,
    parseContactPage,
  );
  const page = resource.value;
  const pageCount = page
    ? Math.max(1, Math.ceil(page.total / page.pageSize))
    : 1;
  function filter(key: "group" | "owner" | "company", value: string) {
    setFilters((current) => ({ ...current, [key]: value, page: 1 }));
  }
  function sort(key: Filters["sort"]) {
    setFilters((current) => ({
      ...current,
      sort: key,
      direction:
        current.sort === key && current.direction === "asc" ? "desc" : "asc",
      page: 1,
    }));
  }
  const active = [
    {
      key: "group" as const,
      label: lookups.ratingGroups.find((group) => group.id === filters.group)
        ?.code,
    },
    {
      key: "owner" as const,
      label: lookups.owners.find((owner) => owner.id === filters.owner)?.name,
    },
    {
      key: "company" as const,
      label: lookups.companies.find((company) => company.id === filters.company)
        ?.name,
    },
  ].filter((item) => item.label);
  return (
    <section className="directory" aria-label="Contacts directory">
      <div className="directory-bar">
        <div className="directory-tab">
          All contacts <span className="count">{page?.total ?? "—"}</span>
        </div>
        <span className="subtle">
          Live database queries · Local synthetic records
        </span>
      </div>
      <div className="filters">
        <label className="search-label">
          <span>Search contacts</span>
          <input
            type="search"
            placeholder="Search name, company, email or owner…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label>
          Ratings Group
          <select
            value={filters.group}
            onChange={(event) => filter("group", event.target.value)}
          >
            <option value="">All groups</option>
            {lookups.ratingGroups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.code}
              </option>
            ))}
          </select>
        </label>
        <label>
          Coverage owner
          <select
            value={filters.owner}
            onChange={(event) => filter("owner", event.target.value)}
          >
            <option value="">All owners</option>
            {lookups.owners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Company
          <select
            value={filters.company}
            onChange={(event) => filter("company", event.target.value)}
          >
            <option value="">All companies</option>
            {lookups.companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {(active.length > 0 || search) && (
        <div className="active-filters">
          {active.map((item) => (
            <button
              key={item.key}
              className="filter-chip"
              onClick={() => filter(item.key, "")}
            >
              {item.label} <span aria-hidden="true">×</span>
              <span className="sr-only"> Remove filter</span>
            </button>
          ))}
          <button
            className="text-button"
            onClick={() => {
              setSearch("");
              setFilters(initial);
            }}
          >
            Clear all filters
          </button>
        </div>
      )}
      <div
        className="table-scroll"
        tabIndex={0}
        aria-label="Contact table; scroll horizontally for more columns"
        aria-busy={resource.loading}
      >
        <table>
          <thead>
            <tr>
              {(
                [
                  ["name", "Contact"],
                  ["company", "Company"],
                ] as const
              ).map(([key, label]) => (
                <th
                  key={key}
                  aria-sort={
                    filters.sort === key
                      ? filters.direction === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <button onClick={() => sort(key)}>
                    {label}{" "}
                    <span aria-hidden="true">
                      {filters.sort === key
                        ? filters.direction === "asc"
                          ? "↑"
                          : "↓"
                        : "↕"}
                    </span>
                  </button>
                </th>
              ))}
              <th>Ratings Groups</th>
              <th
                aria-sort={
                  filters.sort === "owner"
                    ? filters.direction === "asc"
                      ? "ascending"
                      : "descending"
                    : "none"
                }
              >
                <button onClick={() => sort("owner")}>
                  Coverage owner{" "}
                  <span aria-hidden="true">
                    {filters.sort === "owner"
                      ? filters.direction === "asc"
                        ? "↑"
                        : "↓"
                      : "↕"}
                  </span>
                </button>
              </th>
              <th>Email & phone</th>
            </tr>
          </thead>
          <tbody>
            {page?.rows.map((contact) => (
              <tr
                key={contact.id}
                className={contact.id === selectedId ? "selected" : ""}
              >
                <td>
                  <button
                    className="contact-name"
                    onClick={() =>
                      onSelect({ kind: "contact", id: contact.id })
                    }
                  >
                    <span className="avatar">
                      {contact.name
                        .split(" ")
                        .map((x) => x[0])
                        .slice(0, 2)
                        .join("")}
                    </span>
                    <span>
                      {contact.name}
                      <small>{contact.title ?? "No current title"}</small>
                    </span>
                  </button>
                </td>
                <td>
                  {contact.companyId ? (
                    <button
                      className="text-button company-link"
                      onClick={() =>
                        onSelect({ kind: "company", id: contact.companyId! })
                      }
                    >
                      {contact.company}
                    </button>
                  ) : (
                    "Not linked"
                  )}
                </td>
                <td>
                  <Groups values={contact.ratingGroups} />
                </td>
                <td>
                  <span className="owner-name">{contact.owner}</span>
                  <small>{contact.team}</small>
                </td>
                <td>
                  {contact.email}
                  <small>{contact.phone || "Not provided"}</small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {resource.loading && (
        <p className="empty" role="status">
          Loading contacts…
        </p>
      )}
      {resource.error && (
        <div className="error" role="alert">
          {resource.error}
          <p>Change a filter or refresh the workspace to retry.</p>
        </div>
      )}
      {page && !page.rows.length && (
        <div className="empty">
          <strong>No contacts match this view.</strong>
          <p>Try another search or clear the filters.</p>
        </div>
      )}
      <div className="pagination">
        <span>
          {page && page.rows.length
            ? `${(page.page - 1) * page.pageSize + 1}–${(page.page - 1) * page.pageSize + page.rows.length} of ${page.total} contacts`
            : page
              ? `${page.total} contacts`
              : "Loading results"}
        </span>
        <div>
          <button
            className="secondary"
            disabled={resource.loading || filters.page <= 1}
            onClick={() =>
              setFilters((current) => ({ ...current, page: current.page - 1 }))
            }
          >
            ← Previous
          </button>
          <span className="page-label">
            Page {filters.page}
            {page ? ` of ${pageCount}` : ""}
          </span>
          <button
            className="secondary"
            disabled={resource.loading || !page || filters.page >= pageCount}
            onClick={() =>
              setFilters((current) => ({ ...current, page: current.page + 1 }))
            }
          >
            Next →
          </button>
        </div>
      </div>
    </section>
  );
}
