/**
 * One-off setup for push alerts: `npm run push:setup`.
 * Makes VAPID keys and a CRON_SECRET, adds them to Vercel production, sets the
 * CRON_SECRET GitHub Actions secret, and appends them to .env.local.
 * Secrets go over stdin and are never printed. Existing .env.local contents are never read.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync } from "node:fs";
import { createRequire } from "node:module";
const webpush = createRequire(import.meta.url)("web-push") as typeof import("web-push");

const SITE = "https://website-analytics-meridian.vercel.app";
const vapid = webpush.generateVAPIDKeys();
const vars: Record<string, string> = {
  VAPID_PUBLIC_KEY: vapid.publicKey,
  VAPID_PRIVATE_KEY: vapid.privateKey,
  VAPID_SUBJECT: SITE,
  CRON_SECRET: randomBytes(32).toString("hex"),
};

// shell: true so npx/gh resolve on Windows; the value is only ever sent on stdin.
function run(label: string, cmd: string, args: string[], input: string): boolean {
  const r = spawnSync(cmd, args, { input, encoding: "utf8", shell: true });
  const ok = r.status === 0;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}`);
  if (!ok) console.log((r.stderr || r.stdout || "").split("\n").filter((l) => !Object.values(vars).some((v) => l.includes(v))).slice(-3).join("\n"));
  return ok;
}

let failed = 0;
for (const [name, value] of Object.entries(vars)) {
  // `vercel env add` fails if the variable exists; remove it first (quietly) so a re-run rotates the value.
  spawnSync("npx", ["vercel", "env", "rm", name, "production", "--yes"], { encoding: "utf8", shell: true });
  if (!run(`Vercel production ${name}`, "npx", ["vercel", "env", "add", name, "production"], value)) failed++;
}
if (!run("GitHub Actions secret CRON_SECRET", "gh", ["secret", "set", "CRON_SECRET"], vars.CRON_SECRET)) failed++;

appendFileSync(".env.local", `\n${Object.entries(vars).map(([k, v]) => `${k}=${v}`).join("\n")}\n`);
console.log("ok   appended to .env.local (private values not shown)");

console.log(
  failed
    ? `\n${failed} step(s) failed. Fix the cause (is \`npx vercel login\` / \`gh auth login\` done?) and run again; it replaces the values.`
    : "\nDone. Now deploy (npm run deploy), then commit and push .github/workflows/alerts.yml so GitHub starts the 15-minute check.",
);
