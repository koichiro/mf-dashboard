import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [app, image] = process.argv.slice(2);
if (!["web", "crawler"].includes(app) || !image)
  throw new Error("Usage: smoke.mjs web|crawler IMAGE");
const docker = (...args) =>
  execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
if (app === "crawler") {
  const directory = mkdtempSync(join(tmpdir(), "crawler-image-smoke-"));
  chmodSync(directory, 0o777);
  try {
    const result = docker(
      "run",
      "--rm",
      "--platform",
      "linux/amd64",
      "--network",
      "none",
      "--user",
      "1234:2345",
      "--mount",
      `type=bind,src=${directory},dst=/app/data`,
      "--env",
      "DB_PATH=/app/data/smoke.db",
      "--entrypoint",
      "node",
      "--workdir",
      "/app/apps/crawler",
      image,
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      `
import { initDb, closeDb } from "../../packages/db/src/index.ts";
import { chromium } from "playwright";
await initDb();
closeDb();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setContent("<h1>Anonymous smoke fixture</h1>");
if(await page.locator("h1").count() !== 1) throw new Error("Browser smoke failed");
await browser.close();
console.log("migration and browser OK");
`,
    );
    assert.match(result, /migration and browser OK/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
} else {
  // The same image must render runtime metadata for two different public URLs.
  for (const url of ["https://dashboard-a.example.com", "https://dashboard-b.example.com"]) {
    const id = docker(
      "run",
      "--rm",
      "-d",
      "--platform",
      "linux/amd64",
      "--network",
      "none",
      "--user",
      "1234:2345",
      "--env",
      `DASHBOARD_URL=${url}`,
      image,
    ).trim();
    try {
      const result = docker(
        "exec",
        id,
        "node",
        "--input-type=module",
        "--eval",
        `
let html;
for(let attempt=0; attempt<60; attempt++){
  try {
    const response=await fetch("http://127.0.0.1:8765/", {signal:AbortSignal.timeout(5000)});
    if(response.ok) { html=await response.text(); break; }
  } catch {}
  await new Promise(resolve=>setTimeout(resolve,1000));
}
if(!html?.includes(process.env.DASHBOARD_URL + "/logo.png")) throw new Error("Runtime metadata mismatch");
console.log("runtime URL OK");
`,
      );
      assert.match(result, /runtime URL OK/);
    } finally {
      docker("stop", "--time", "10", id);
    }
  }
}
console.log(`${app} image smoke passed`);
