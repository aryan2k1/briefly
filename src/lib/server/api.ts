import { randomUUID } from "node:crypto";
import { AppError } from "./errors.ts";
import {
  assertOrigin,
  assertCsrf,
  createDemoSession,
  resolveSession,
  revokeSession,
  requestToken,
  cookie,
} from "./auth.ts";
import {
  listContacts,
  getContact,
  getCompany,
  getLookups,
  createContact,
  editContact,
  changeEmployment,
} from "./contacts.ts";
import { createMeeting } from "./meetings.ts";
import {
  listMeetings,
  getMeeting,
  editMeeting,
  getOverview,
  getBrief,
} from "./meeting-workspace.ts";
import { simulateOutlook } from "./outlook-demo.ts";
import { getHome } from "./home.ts";
import { fields } from "./validation.ts";
async function body(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new AppError(415, "Use application/json");
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(400, "JSON body required");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 16384) {
        await reader.cancel();
        throw new AppError(413, "Request is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError(400, "Invalid JSON");
  }
}
export async function handle(request: Request): Promise<Response> {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
    Vary: "Cookie",
    "X-Content-Type-Options": "nosniff",
  });
  const reply = (data: unknown, status = 200) =>
    Response.json(data, { status, headers });
  try {
    const url = new URL(request.url),
      path = url.pathname.replace(/\/$/, ""),
      method = request.method,
      token = requestToken(request);
    if (path === "/api/auth/demo" && method === "POST") {
      assertOrigin(request);
      const f = fields(await body(request), ["persona"]);
      const created = await createDemoSession(f.persona, token);
      headers.set("Set-Cookie", cookie(created.token));
      return reply(created.session);
    }
    const actor = await resolveSession(token);
    if (!["GET", "HEAD"].includes(method)) assertCsrf(request, actor);
    if (path === "/api/session" && method === "GET") return reply(actor);
    if (path === "/api/auth/logout" && method === "POST") {
      await revokeSession(token);
      headers.set("Set-Cookie", cookie("", 0));
      return reply({ ok: true });
    }
    if (path === "/api/lookups" && method === "GET")
      return reply(await getLookups(actor));
    if (path === "/api/contacts" && method === "GET")
      return reply(await listContacts(actor, url.searchParams));
    if (path === "/api/contacts" && method === "POST")
      return reply(await createContact(actor, await body(request)), 201);
    if (path === "/api/meetings" && method === "POST")
      return reply(await createMeeting(actor, await body(request)), 201);
    if (path === "/api/meetings" && method === "GET")
      return reply(await listMeetings(actor, url.searchParams));
    if (path === "/api/overview" && method === "GET")
      return reply(await getOverview(actor));
    if (path === "/api/home" && method === "GET") {
      if (url.searchParams.size)
        throw new AppError(400, "Home does not accept filters");
      return reply(await getHome(actor));
    }
    if (path === "/api/integrations/outlook/simulate" && method === "POST") {
      fields(await body(request), []);
      return reply(await simulateOutlook(actor));
    }
    const brief = path.match(/^\/api\/meetings\/([^/]+)\/brief$/);
    if (brief && method === "GET")
      return reply(await getBrief(actor, brief[1]));
    const meeting = path.match(/^\/api\/meetings\/([^/]+)$/);
    if (meeting && method === "GET")
      return reply(await getMeeting(actor, meeting[1]));
    if (meeting && method === "PATCH")
      return reply(await editMeeting(actor, meeting[1], await body(request)));
    const contact = path.match(/^\/api\/contacts\/([^/]+)$/);
    if (contact && method === "GET")
      return reply(await getContact(actor, contact[1]));
    if (contact && method === "PATCH")
      return reply(await editContact(actor, contact[1], await body(request)));
    const employment = path.match(/^\/api\/contacts\/([^/]+)\/employment$/);
    if (employment && method === "POST")
      return reply(
        await changeEmployment(actor, employment[1], await body(request)),
      );
    const company = path.match(/^\/api\/companies\/([^/]+)$/);
    if (company && method === "GET")
      return reply(await getCompany(actor, company[1]));
    throw new AppError(404, "Endpoint not found");
  } catch (error) {
    if (error instanceof AppError)
      return reply({ error: error.message }, error.status);
    const code = (error as { code?: string }).code;
    if (["23503", "23505", "23514", "22007", "22008"].includes(code ?? ""))
      return reply(
        {
          error:
            "The change conflicts with data integrity rules. Check the fields and reload.",
        },
        400,
      );
    if (code === "40001")
      return reply(
        {
          error:
            "The record changed during your request. Reload and try again.",
        },
        409,
      );
    const incident = randomUUID();
    console.error("Request failed", { incident, code: code ?? "unknown" });
    return reply(
      { error: `Request could not be completed. Reference: ${incident}` },
      500,
    );
  }
}
