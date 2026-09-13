#!/bin/sh
# Run from any directory: sh RELEASE/update.sh INSTALL_DIRECTORY COMPOSE_PROJECT
set -eu
umask 077

fail() { echo "$*" >&2; exit 1; }
[ "$#" -eq 2 ] || fail "Usage: sh update.sh INSTALL_DIRECTORY EXISTING_COMPOSE_PROJECT"
root=$(cd "$1" && pwd -P)
project=$2
case "$project" in ""|*[!a-z0-9_-]*) fail "Invalid Compose project name";; esac
release=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
[ -f "$root/.env" ] || fail "Missing installation .env"
[ -f "$release/release.env" ] || fail "Missing release.env"
# Never source a downloaded environment file as shell code.
[ "$(wc -l < "$release/release.env" | tr -d ' ')" = 4 ] || fail "Invalid release.env"
grep -Eq '^RELEASE_ID=images-[a-f0-9]{40}-[0-9]+-[0-9]+$' "$release/release.env" || fail "Invalid release ID"
grep -Eq '^SOURCE_REVISION=[a-f0-9]{40}$' "$release/release.env" || fail "Invalid revision"
for key in WEB_IMAGE CRAWLER_IMAGE; do
  grep -Eq "^$key=ghcr.io/[a-z0-9_.-]+/[a-z0-9_.-]+@sha256:[a-f0-9]{64}$" "$release/release.env" || fail "Invalid image digest"
done
# Shell environment must not override the selected image pair.
WEB_IMAGE=$(sed -n 's/^WEB_IMAGE=//p' "$release/release.env")
CRAWLER_IMAGE=$(sed -n 's/^CRAWLER_IMAGE=//p' "$release/release.env")
export WEB_IMAGE CRAWLER_IMAGE
web_repository=${WEB_IMAGE%@*}
crawler_repository=${CRAWLER_IMAGE%@*}
[ "${web_repository%-web}" = "${crawler_repository%-crawler}" ] || fail "Image repository mismatch"
revision=$(sed -n 's/^SOURCE_REVISION=//p' "$release/release.env")
release_id=$(sed -n 's/^RELEASE_ID=//p' "$release/release.env")
case "$release_id" in "images-$revision-"*) ;; *) fail "Release revision mismatch";; esac

compose() {
  docker compose --project-directory "$root" --project-name "$project" \
    --env-file "$root/.env" --env-file "$release/release.env" -f "$release/compose.yml" "$@"
}
compose config --quiet
mkdir "$root/.image-update-lock" 2>/dev/null || fail "Another update is active; inspect .image-update-lock"
backup=""
stopped=false
cleanup() {
  result=$?
  if [ "$result" -ne 0 ] && [ "$stopped" = true ]; then
    compose stop -t 600 cloudflared crawler web || true
    echo "Update failed; application services stopped. Backup: $backup" >&2
    echo "See the release README recovery procedure. Do not start an older image against an incompatible DB." >&2
  fi
  rmdir "$root/.image-update-lock"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# Fail before stopping services if a pull is unavailable.
compose pull web crawler cloudflared
base_path=$(compose config --format json | docker run --rm -i --entrypoint node "$WEB_IMAGE" -e '
let input=""; process.stdin.on("data",c=>input+=c).on("end",()=>{
 const config=JSON.parse(input);
 process.stdout.write(config.services.crawler.environment.NEXT_PUBLIC_BASE_PATH || "");
});')
[ -z "$base_path" ] || fail "Published images only support the domain root"

crawler_id=$(compose ps -q crawler)
if [ -n "$crawler_id" ]; then
  compose exec -T crawler node -e '
fetch("http://127.0.0.1:8766/status",{
 headers:{authorization:"Bearer "+process.env.REFRESH_TOKEN},
 signal:AbortSignal.timeout(5000)
}).then(async r=>{
 if(!r.ok) process.exit(1);
 const state=await r.json();
 if(state.running) { console.error("Crawler is running; retry after completion"); process.exit(1); }
}).catch(()=>process.exit(1));'
fi

backup="$root/backups/$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -p "$backup"
cp "$root/.env" "$backup/.env"
if [ -f "$root/.image-release" ]; then cp "$root/.image-release" "$backup/previous-release"; fi
if [ -f "$root/compose.yml" ]; then cp "$root/compose.yml" "$backup/source-compose.yml"; fi
printf '%s\n' "$project" > "$backup/project"
stopped=true
# Stop every application writer before copying SQLite, including WAL/SHM.
compose stop -t 600 cloudflared crawler web
if [ -d "$root/data" ]; then tar -cf "$backup/data.tar" -C "$root" data; fi
# Authentication stays in the existing project-scoped volume; never recreate/delete it.
# A fresh one-off migration always uses the selected crawler image.
compose run --rm --no-deps migrate
# Do not run/reuse the old migrate service through depends_on.
compose up -d --no-build --no-deps --force-recreate --wait --wait-timeout 180 web crawler
compose up -d --no-build --no-deps cloudflared
printf '%s\n' "$release" > "$root/.image-release.tmp"
mv "$root/.image-release.tmp" "$root/.image-release"
stopped=false
echo "Update completed. Backup: $backup"
echo "Check the authenticated dashboard, crawler schedule, notifications and AI results."
