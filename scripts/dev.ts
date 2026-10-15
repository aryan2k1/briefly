import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
const config = JSON.parse(
  await readFile(new URL("../.local/runtime.json", import.meta.url), "utf8"),
) as { appUrl: string };
const env: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_URL: config.appUrl,
  APP_ORIGIN: "http://127.0.0.1:4319",
  AUTH_MODE: "synthetic-local",
  WATCHPACK_POLLING: "true",
};
delete env.ADMIN_DATABASE_URL;
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    "4319",
  ],
  { stdio: "inherit", env },
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
