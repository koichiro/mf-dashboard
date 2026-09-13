import assert from "node:assert/strict";
import { test } from "node:test";
import { releaseManifest } from "./package.mjs";

const revision = "a".repeat(40);
const release = `images-${revision}-123-1`;
const digest = `sha256:${"b".repeat(64)}`;

void test("pins both images to their digests in the fork namespace", () => {
  const result = releaseManifest("example/dashboard", revision, release, digest, digest);
  assert.match(result, /WEB_IMAGE=ghcr.io\/example\/dashboard-web@sha256:/);
  assert.match(result, /CRAWLER_IMAGE=ghcr.io\/example\/dashboard-crawler@sha256:/);
  assert.equal(result.trim().split("\n").length, 4);
});
void test("refuses incomplete publication and mismatched release identity", () => {
  for (const invalid of ["", "latest", "sha256:123", digest + "\nTOKEN=secret"]) {
    assert.throws(() => releaseManifest("example/dashboard", revision, release, digest, invalid));
    assert.throws(() => releaseManifest("example/dashboard", revision, release, invalid, digest));
  }
  assert.throws(() =>
    releaseManifest("example/dashboard", "c".repeat(40), release, digest, digest),
  );
  assert.throws(() =>
    releaseManifest("example/dashboard\nBAD=1", revision, release, digest, digest),
  );
});
