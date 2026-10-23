import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import pg from "pg";
export async function migrate(url: string) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(4319001)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS public.schema_migrations(version integer PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const files = [
      "001-foundation.sql",
      "002-meeting-workspace.sql",
      "003-home-layouts.sql",
    ];
    const existing = await client.query(
      "SELECT version,checksum FROM public.schema_migrations ORDER BY version",
    );
    if (existing.rows.some((r) => r.version > files.length))
      throw new Error("Database schema is newer than this application");
    for (const [index, file] of files.entries()) {
      const version = index + 1;
      const sql = await readFile(
        new URL(`../db/${file}`, import.meta.url),
        "utf8",
      );
      const checksum = createHash("sha256").update(sql).digest("hex");
      const applied = existing.rows.find((r) => r.version === version);
      if (applied && applied.checksum !== checksum)
        throw new Error("Applied migration checksum changed");
      if (!applied) {
        await client.query(sql);
        await client.query(
          "INSERT INTO public.schema_migrations(version,checksum) VALUES($1,$2)",
          [version, checksum],
        );
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}
if (import.meta.main) {
  if (!process.env.ADMIN_DATABASE_URL)
    throw new Error(
      "ADMIN_DATABASE_URL required; never use migration credentials in the web app",
    );
  await migrate(process.env.ADMIN_DATABASE_URL);
  console.log("Migrations applied/verified");
}
