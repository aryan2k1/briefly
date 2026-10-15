import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import pg from "pg";
import { migrate } from "./migrate.ts";
import { seed } from "./seed.ts";
import { seedUnified } from "./seed-unified.ts";
const root = resolve(".local");
await mkdir(root, { recursive: true, mode: 0o700 });
const configPath = resolve(root, "runtime.json");
let config: {
  adminUrl: string;
  appUrl: string;
  password: string;
  runtimePassword: string;
};
try {
  config = JSON.parse(await readFile(configPath, "utf8"));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  const password = randomBytes(32).toString("hex"),
    runtimePassword = randomBytes(32).toString("hex");
  config = {
    password,
    runtimePassword,
    adminUrl: `postgres://briefly_owner:${password}@127.0.0.1:55439/briefly_foundation`,
    appUrl: `postgres://briefly_runtime:${runtimePassword}@127.0.0.1:55439/briefly_foundation`,
  };
  await writeFile(configPath, JSON.stringify(config), {
    mode: 0o600,
    flag: "wx",
  });
}
if (
  !/^[a-f0-9]{64}$/.test(config.password) ||
  !/^[a-f0-9]{64}$/.test(config.runtimePassword) ||
  config.password === config.runtimePassword
) {
  throw new Error(
    "Invalid local credential configuration. Preserve the data and request a reviewed repair.",
  );
}
const bin =
  process.env.PG_BIN ??
  resolve("node_modules/@embedded-postgres/darwin-arm64/native/bin");
const data = resolve(root, "postgres");
async function run(name: string, args: string[]) {
  await new Promise<void>((res, rej) => {
    const child = spawn(resolve(bin, name), args, { stdio: "inherit" });
    child.on("error", rej);
    child.on("exit", (code) =>
      code === 0 ? res() : rej(new Error(`${name} exited ${code}`)),
    );
  });
}
try {
  await access(resolve(data, "PG_VERSION"));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  const pw = resolve(root, "init-password");
  await writeFile(pw, config.password, { mode: 0o600 });
  await run("initdb", [
    "-D",
    data,
    "-U",
    "briefly_owner",
    "--pwfile",
    pw,
    "--auth=scram-sha-256",
    "--encoding=UTF8",
    "--locale=C",
  ]);
}
// Foreground process: no system service or public listener is installed.
const child = spawn(
  resolve(bin, "postgres"),
  ["-D", data, "-h", "127.0.0.1", "-p", "55439", "-k", ""],
  { stdio: "inherit" },
);
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
let stopped = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    stopped = true;
    child.kill("SIGINT");
  });
const controlUrl = config.adminUrl.replace("/briefly_foundation", "/postgres");
let ready = false;
for (let attempt = 0; attempt < 40 && !stopped; attempt++) {
  if (child.exitCode !== null)
    throw new Error(
      "PostgreSQL failed to start; do not overwrite an existing cluster",
    );
  const client = new pg.Client({ connectionString: controlUrl });
  try {
    await client.connect();
    const role = await client.query(
      "SELECT 1 FROM pg_roles WHERE rolname='briefly_runtime'",
    );
    if (!role.rowCount)
      await client.query(
        `CREATE ROLE briefly_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD '${config.runtimePassword}'`,
      );
    const database = await client.query(
      "SELECT 1 FROM pg_database WHERE datname='briefly_foundation'",
    );
    if (!database.rowCount)
      await client.query("CREATE DATABASE briefly_foundation");
    ready = true;
    break;
  } catch (error) {
    if (attempt === 39) throw error;
    await new Promise((res) => setTimeout(res, 250));
  } finally {
    await client.end();
  }
}
if (ready) {
  await migrate(config.adminUrl);
  await seed(config.adminUrl);
  await seedUnified(config.adminUrl);
  console.log(
    "Synthetic PostgreSQL foundation ready on 127.0.0.1:55439. Leave this terminal running.",
  );
}
await new Promise<void>((res) => child.on("exit", () => res()));
