import { describe, it, expect } from "vitest";
import { spawnSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(__dirname, "schema-smoke-test.ts");
const postMergeScriptPath = resolve(__dirname, "../post-merge.sh");

function runSmokeTest(env: Record<string, string | undefined>) {
  const result = spawnSync(
    "tsx",
    [scriptPath],
    {
      env: { ...process.env, ...env },
      encoding: "utf8",
      timeout: 15_000,
    },
  );
  return result;
}

function runPostMerge(env: Record<string, string | undefined>) {
  // _POST_MERGE_SKIP_INSTALL=1 bypasses `pnpm install` so the test only
  // exercises the db-push and smoke-test steps without re-installing deps.
  const result = spawnSync(
    "bash",
    [postMergeScriptPath],
    {
      env: {
        ...process.env,
        ...env,
        _POST_MERGE_SKIP_INSTALL: "1",
      },
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  return result;
}

describe("schema-smoke-test exit codes", () => {
  it("exits 0 (skip) when DATABASE_URL is not set", () => {
    const result = runSmokeTest({ DATABASE_URL: undefined });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("skipping");
  });

  it("exits 1 when DATABASE_URL is set but the database is unreachable", () => {
    const result = runSmokeTest({
      DATABASE_URL: "postgres://user:pass@localhost:1/fake",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("cannot connect to database");
  });

  it("exits 1 when DATABASE_URL is set but the password is wrong (pg auth failure)", () => {
    // Reuse the real host/port so the TCP connection succeeds, but substitute a
    // deliberately wrong password so PostgreSQL rejects authentication.  This
    // covers the production scenario where DATABASE_URL is present yet the
    // credentials are invalid.
    //
    // If DATABASE_URL is not available in this environment we skip the test
    // rather than fail, because there is no reachable server to auth against.
    const rawUrl = process.env.DATABASE_URL;
    if (!rawUrl) {
      console.warn("Skipping auth-failure test: DATABASE_URL not set in this environment");
      return;
    }

    let badPasswordUrl: string;
    try {
      const parsed = new URL(rawUrl);
      parsed.password = "WRONG_PASSWORD_FOR_SMOKE_TEST";
      badPasswordUrl = parsed.toString();
    } catch {
      console.warn("Skipping auth-failure test: could not parse DATABASE_URL");
      return;
    }

    const result = runSmokeTest({ DATABASE_URL: badPasswordUrl });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("cannot connect to database");
  });
});

describe("post-merge.sh exit behavior", () => {
  it("exits 0 (skip) when DATABASE_URL is not set", () => {
    const result = runPostMerge({ DATABASE_URL: undefined });
    expect(result.status).toBe(0);
    const combined = result.stdout + result.stderr;
    expect(combined).toContain("skipping");
  });

  it("exits 1 at the db push step when DATABASE_URL has a bad password", () => {
    // Core regression guard: post-merge.sh must exit 1 at the schema push
    // step when PostgreSQL rejects authentication, before the smoke test runs.
    //
    // Background: drizzle-kit push exits 0 even when authentication fails
    // (pg error code 28P01), so post-merge.sh cannot rely on `set -e` alone.
    // It explicitly scans push output for auth-failure strings and exits 1
    // if found — this test confirms that detection is in place and effective.
    //
    // If DATABASE_URL is not set in this environment there is no running
    // PostgreSQL server to auth against, so we skip rather than fail.
    const rawUrl = process.env.DATABASE_URL;
    if (!rawUrl) {
      console.warn("Skipping post-merge bad-password test: DATABASE_URL not set in this environment");
      return;
    }

    let badPasswordUrl: string;
    try {
      const parsed = new URL(rawUrl);
      parsed.password = "WRONG_PASSWORD_FOR_POST_MERGE_TEST";
      badPasswordUrl = parsed.toString();
    } catch {
      console.warn("Skipping post-merge bad-password test: could not parse DATABASE_URL");
      return;
    }

    const result = runPostMerge({ DATABASE_URL: badPasswordUrl });

    // Must exit with code 1 specifically (not just any non-zero value).
    expect(result.status).toBe(1);

    // The push step must have been reached — post-merge.sh emits
    // "running schema push..." before invoking drizzle-kit push.
    expect(result.stderr).toContain("running schema push");

    // The push step must have detected the failure — post-merge.sh emits
    // "schema push failed" when it catches the auth error in drizzle-kit output.
    expect(result.stderr).toContain("schema push failed");

    // The smoke test must NOT have been reached — post-merge.sh emits
    // "running smoke test..." immediately before that step.  Its absence
    // confirms the script stopped at the push step, not later.
    expect(result.stderr).not.toContain("running smoke test");
  });
});
