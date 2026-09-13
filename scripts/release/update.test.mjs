import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { releaseManifest } from "./package.mjs";

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), "image-update-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = join(dir, "installation");
  const release = join(dir, "release");
  const bin = join(dir, "bin");
  for (const folder of [root, release, bin, join(root, "data")])
    mkdirSync(folder, { recursive: true });
  writeFileSync(join(root, ".env"), "REFRESH_TOKEN=test-only\n");
  writeFileSync(join(root, "data", "sample.txt"), "anonymous fixture");
  writeFileSync(join(root, ".image-release"), "/previous/release\n");
  cpSync(resolve("docker/release/update.sh"), join(release, "update.sh"));
  cpSync(resolve("docker/release/compose.yml"), join(release, "compose.yml"));
  const revision = "a".repeat(40),
    digest = "sha256:" + "b".repeat(64);
  writeFileSync(
    join(release, "release.env"),
    releaseManifest("example/dashboard", revision, `images-${revision}-123-1`, digest, digest),
  );
  writeFileSync(
    join(bin, "docker"),
    `#!/bin/sh
set -eu
if [ "$1" = run ]; then cat >/dev/null; printf '%s' "\${TEST_BASE_PATH:-}"; exit 0; fi
while [ "$1" != -f ]; do shift; done
shift 2
echo "$*" >> "$TEST_LOG"
case "$1" in
 config) if [ "\${2:-}" = --format ]; then echo '{}'; fi;;
 pull) [ "\${TEST_FAIL:-}" != pull ];;
 ps) echo existing-crawler;;
 exec) [ "\${TEST_FAIL:-}" != busy ];;
 run) [ "\${TEST_FAIL:-}" != migrate ];;
 up) [ "\${TEST_FAIL:-}" != health ];;
esac
`,
    { mode: 0o755 },
  );
  const log = join(dir, "docker.log");
  const run = (extra = {}) =>
    spawnSync("sh", [join(release, "update.sh"), root, "test-dashboard"], {
      encoding: "utf8",
      env: { ...process.env, PATH: bin + ":" + process.env.PATH, TEST_LOG: log, ...extra },
    });
  return { root, release, run, log: () => (existsSync(log) ? readFileSync(log, "utf8") : "") };
}

test("backs up stopped writers, migrates once, checks health, preserves project and release history", (t) => {
  const s = setup(t);
  const result = s.run();
  assert.equal(result.status, 0, result.stderr);
  const log = s.log();
  assert.ok(log.indexOf("pull ") < log.indexOf("stop "));
  assert.ok(log.indexOf("stop ") < log.indexOf("run --rm --no-deps migrate"));
  assert.ok(log.indexOf("run --rm --no-deps migrate") < log.indexOf("up "));
  assert.match(log, /--force-recreate --wait/);
  const backup = join(s.root, "backups", readdirSync(join(s.root, "backups"))[0]);
  assert.equal(readFileSync(join(backup, "previous-release"), "utf8"), "/previous/release\n");
  assert.equal(readFileSync(join(backup, "project"), "utf8"), "test-dashboard\n");
  const restored = join(s.root, "restore-check");
  mkdirSync(restored);
  assert.equal(spawnSync("tar", ["-xf", join(backup, "data.tar"), "-C", restored]).status, 0);
  assert.equal(readFileSync(join(restored, "data", "sample.txt"), "utf8"), "anonymous fixture");
  assert.equal(
    readFileSync(join(s.root, ".image-release"), "utf8"),
    realpathSync(s.release) + "\n",
  );
  assert.equal(s.run().status, 0, "same release can be applied again");
});

for (const failure of ["pull", "busy", "migrate", "health"]) {
  test(`failure at ${failure} does not advance the active release`, (t) => {
    const s = setup(t),
      result = s.run({ TEST_FAIL: failure });
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(join(s.root, ".image-release"), "utf8"), "/previous/release\n");
    assert.equal(existsSync(join(s.root, ".image-update-lock")), false);
    if (failure === "pull" || failure === "busy") assert.doesNotMatch(s.log(), /stop /);
    if (failure === "migrate") assert.doesNotMatch(s.log(), /up /);
    if (failure === "health") assert.match(s.log().trim().split("\n").at(-1), /^stop /);
  });
}
test("rejects subpath configuration before stopping services", (t) => {
  const s = setup(t);
  assert.notEqual(s.run({ TEST_BASE_PATH: "/dashboard" }).status, 0);
  assert.doesNotMatch(s.log(), /stop /);
});
test("rejects malformed image metadata without executing it", (t) => {
  const s = setup(t);
  writeFileSync(join(s.release, "release.env"), "WEB_IMAGE=$(touch invalid)\n");
  assert.notEqual(s.run().status, 0);
  assert.equal(s.log(), "");
});
