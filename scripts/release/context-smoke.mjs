import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "image-context-smoke-"));
try {
  const context = join(directory, "context"),
    output = join(directory, "output");
  mkdirSync(context);
  copyFileSync(".dockerignore", join(context, ".dockerignore"));
  writeFileSync(join(context, "Dockerfile"), "FROM scratch\nCOPY . /\n");
  writeFileSync(join(context, "source.txt"), "allowed source");
  const marker = "ANONYMOUS_SECRET_EXCLUSION_MARKER";
  for (const file of [
    ".env",
    ".env.production",
    "apps/web/.env.local",
    "secrets/token",
    "data/sample.json",
    "auth-state.json",
    "apps/crawler/saved-auth-state.json",
    "terraform/local.tfstate",
    "terraform/local.tfvars",
    "backups/data.tar",
    "releases/old/release.env",
    "apps/crawler/debug/screenshot.png",
    "apps/crawler/tests/e2e/sample.db",
    "bundle/release.env",
    "web-metadata.json",
    "deployment.tar.gz",
  ]) {
    const path = join(context, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, marker);
  }
  execFileSync("docker", ["build", "--output", `type=local,dest=${output}`, context], {
    stdio: "pipe",
  });
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else
        assert.ok(
          !readFileSync(path).includes(Buffer.from(marker)),
          `Excluded data entered context: ${entry.name}`,
        );
    }
  };
  visit(output);
  assert.equal(readFileSync(resolve(output, "source.txt"), "utf8"), "allowed source");
  console.log("Anonymous secret markers excluded before image layers/cache");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
