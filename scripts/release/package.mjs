import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function releaseManifest(repository, revision, release, webDigest, crawlerDigest) {
  if (!/^[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_.-]*$/.test(repository)) {
    throw new Error("Invalid repository");
  }
  if (!/^[a-f0-9]{40}$/.test(revision) || !/^images-[a-f0-9]{40}-[0-9]+-[0-9]+$/.test(release)) {
    throw new Error("Invalid release identity");
  }
  if (!release.startsWith(`images-${revision}-`)) throw new Error("Revision mismatch");
  for (const digest of [webDigest, crawlerDigest]) {
    if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error("Both image digests are required");
  }
  return [
    `RELEASE_ID=${release}`,
    `SOURCE_REVISION=${revision}`,
    `WEB_IMAGE=ghcr.io/${repository}-web@${webDigest}`,
    `CRAWLER_IMAGE=ghcr.io/${repository}-crawler@${crawlerDigest}`,
    "",
  ].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [repository, revision, release, webDigest, crawlerDigest, destination] =
    process.argv.slice(2);
  const manifest = releaseManifest(repository, revision, release, webDigest, crawlerDigest);
  mkdirSync(destination, { recursive: true });
  for (const [source, target] of [
    ["docker/release/compose.yml", "compose.yml"],
    ["docker/release/update.sh", "update.sh"],
    [".env.example", ".env.example"],
    ["docs/image-deployment.md", "README.md"],
  ])
    copyFileSync(source, resolve(destination, target));
  writeFileSync(resolve(destination, "release.env"), manifest);
}
