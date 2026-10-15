import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
const commands = [
  ["node_modules/typescript/bin/tsc", "--noEmit"],
  [
    "node_modules/eslint/bin/eslint.js",
    "src",
    "scripts",
    "tests",
    "next.config.ts",
  ],
  [
    "node_modules/prettier/bin/prettier.cjs",
    "--check",
    "src",
    "scripts",
    "tests",
    "next.config.ts",
    "eslint.config.mjs",
    "package.json",
    "tsconfig.json",
  ],
  [
    "--test",
    ...readdirSync(new URL("../tests/", import.meta.url))
      .filter((name) => name.endsWith(".test.ts"))
      .sort()
      .map((name) => `tests/${name}`),
  ],
];
for (const args of commands) {
  console.log(`Verification: ${args[0]}`);
  const code = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", resolve);
  });
  if (code !== 0) {
    process.exitCode = code ?? 1;
    break;
  }
}
