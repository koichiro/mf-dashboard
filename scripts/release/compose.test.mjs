import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

void test("deployment Compose keeps image pairing, host paths, auth volume and runtime settings", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "deployment-compose-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = {
    ...process.env,
    WEB_IMAGE: "ghcr.io/example/dashboard-web@sha256:" + "a".repeat(64),
    CRAWLER_IMAGE: "ghcr.io/example/dashboard-crawler@sha256:" + "b".repeat(64),
    HOST_UID: "1234",
    HOST_GID: "2345",
    REFRESH_TOKEN: "test-only",
    CLOUDFLARE_ACCESS_AUD: "test-audience",
    CLOUDFLARE_ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com",
    DASHBOARD_URL: "https://dashboard.example.com",
    SIMULATOR_ANNUAL_RETURN_RATE: "6",
    NEXT_PUBLIC_SIMULATOR_CURRENT_AGE: "30",
    HISTORY_START_MONTH: "2020-01",
  };
  const readConfig = (file) =>
    JSON.parse(
      execFileSync(
        "docker",
        [
          "compose",
          "--project-name",
          "test-existing-project",
          "--project-directory",
          dir,
          "--env-file",
          "/dev/null",
          "-f",
          resolve(file),
          "config",
          "--format",
          "json",
        ],
        { env, encoding: "utf8" },
      ),
    );
  const config = readConfig("docker/release/compose.yml");
  const sourceConfig = readConfig("compose.yml");
  assert.equal(config.services.cloudflared.image, sourceConfig.services.cloudflared.image);
  for (const service of ["web", "crawler", "migrate"]) {
    assert.equal(config.services[service].build, undefined);
    assert.equal(config.services[service].user, "1234:2345");
    assert.equal(config.services[service].platform, "linux/amd64");
    assert.equal(
      config.services[service].volumes.find((v) => v.target === "/app/data").source,
      config.services.web.volumes[0].source,
    );
  }
  assert.equal(config.services.migrate.image, env.CRAWLER_IMAGE);
  assert.equal(config.services.crawler.image, env.CRAWLER_IMAGE);
  assert.equal(config.services.web.image, env.WEB_IMAGE);
  assert.equal(config.volumes.crawler_auth_state.name, "test-existing-project_crawler_auth_state");
  assert.equal(config.services.web.environment.SIMULATOR_ANNUAL_RETURN_RATE, "6");
  assert.equal(config.services.web.environment.SIMULATOR_CURRENT_AGE, "30");
  assert.equal(config.services.crawler.environment.HISTORY_START_MONTH, "2020-01");
  assert.ok(config.services.web.healthcheck);
  assert.ok(config.services.crawler.healthcheck);
});
