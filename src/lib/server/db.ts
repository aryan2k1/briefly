import pg from "pg";
import type { SessionView } from "../contracts.ts";
export type Actor = SessionView;
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 8,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 10000,
});
pool.on("error", () => console.error("Database pool connection failed"));
export async function scoped<T>(
  actor: Actor,
  operation: (client: pg.PoolClient) => Promise<T>,
  repeatableRead = false,
): Promise<T> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const client = await pool.connect();
  try {
    await client.query(
      repeatableRead ? "BEGIN ISOLATION LEVEL REPEATABLE READ" : "BEGIN",
    );
    await client.query(
      "SELECT set_config('briefly.org',$1,true),set_config('briefly.team',$2,true),set_config('briefly.role',$3,true),set_config('briefly.member',$4,true)",
      [
        actor.organisation.id,
        actor.membership.teamId,
        actor.membership.role,
        actor.membership.id,
      ],
    );
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
