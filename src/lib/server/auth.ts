import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { pool } from "./db.ts";
import { AppError } from "./errors.ts";
import { fixtureId, personas } from "../fixture-ids.ts";
import type { SessionView } from "../contracts.ts";
export const cookieName = "briefly_foundation_session";
export const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export function configuredOrigin() {
  const origin = process.env.APP_ORIGIN;
  if (!origin) throw new AppError(503, "Application origin is not configured");
  return new URL(origin).origin;
}
export function assertOrigin(request: Request) {
  if (request.headers.get("origin") !== configuredOrigin())
    throw new AppError(403, "Request origin rejected");
}
export function demoEnabled() {
  return (
    process.env.AUTH_MODE === "synthetic-local" &&
    process.env.NODE_ENV !== "production" &&
    ["http://127.0.0.1:4319", "http://localhost:4319"].includes(
      configuredOrigin(),
    )
  );
}
export function cookie(token: string, maxAge = 28800) {
  return `${cookieName}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${configuredOrigin().startsWith("https:") ? "; Secure" : ""}`;
}
export function requestToken(request: Request) {
  return (
    request.headers
      .get("cookie")
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1) ?? ""
  );
}
export async function resolveSession(token: string): Promise<SessionView> {
  if (!demoEnabled())
    throw new AppError(
      503,
      "Production identity is not configured; synthetic sessions are disabled",
    );
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new AppError(401, "Sign in required");
  const result = await pool.query(
    `UPDATE identity.sessions s SET last_seen_at=now()
 FROM identity.memberships m,identity.users u,identity.organisations o
 WHERE s.token_hash=$1 AND s.org_id=m.org_id AND s.membership_id=m.id AND m.user_id=u.id
 AND o.id=m.org_id AND m.active AND u.active AND s.expires_at>now() AND s.last_seen_at>now()-interval '30 minutes'
 RETURNING m.id,m.org_id,m.team_id,m.role,u.id AS user_id,u.name,o.name AS org_name,o.accent,o.integration_mode,s.csrf_token`,
    [digest(token)],
  );
  const r = result.rows[0];
  if (!r) throw new AppError(401, "Session expired or access revoked");
  return {
    user: { id: r.user_id, name: r.name },
    membership: { id: r.id, role: r.role, teamId: r.team_id },
    organisation: {
      id: r.org_id,
      name: r.org_name,
      accent: r.accent,
      integrationMode: r.integration_mode,
    },
    csrfToken: r.csrf_token,
  };
}
export async function createDemoSession(persona: unknown, oldToken = "") {
  if (!demoEnabled())
    throw new AppError(
      403,
      "Synthetic sign-in is disabled. An approved identity provider must be configured.",
    );
  if (typeof persona !== "string" || !Object.hasOwn(personas, persona))
    throw new AppError(400, "Choose a synthetic persona");
  const p = personas[persona as keyof typeof personas];
  const token = randomBytes(32).toString("hex"),
    csrf = randomBytes(32).toString("hex");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM identity.sessions WHERE expires_at<=now() OR token_hash=$1",
      [digest(oldToken)],
    );
    const inserted = await client.query(
      `INSERT INTO identity.sessions(token_hash,org_id,membership_id,csrf_token,expires_at)
   SELECT $1,m.org_id,m.id,$4,now()+interval '8 hours' FROM identity.memberships m
   JOIN identity.organisations o ON o.id=m.org_id JOIN identity.users u ON u.id=m.user_id
   WHERE m.org_id=$2 AND m.id=$3 AND m.active AND u.active AND o.synthetic`,
      [digest(token), fixtureId(p.org), fixtureId(p.member), csrf],
    );
    if (!inserted.rowCount)
      throw new AppError(403, "Synthetic identity is unavailable");
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return { token, session: await resolveSession(token) };
}
export async function revokeSession(token: string) {
  await pool.query("DELETE FROM identity.sessions WHERE token_hash=$1", [
    digest(token),
  ]);
}
export function assertCsrf(request: Request, session: SessionView) {
  assertOrigin(request);
  const supplied = Buffer.from(request.headers.get("x-csrf-token") ?? "");
  const expected = Buffer.from(session.csrfToken);
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  )
    throw new AppError(
      403,
      "Request verification failed; reload and try again",
    );
}
export function assertEditor(actor: SessionView) {
  if (actor.membership.role === "viewer")
    throw new AppError(403, "This account has read-only access");
}
