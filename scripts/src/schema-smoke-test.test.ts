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
      timeout: 60_000,
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

  it("exits 1 at the pre-flight step when DATABASE_URL has a bad password", () => {
    // Core regression guard: post-merge.sh must exit 1 when PostgreSQL rejects
    // authentication.  With the pre-flight smoke test in place, this failure is
    // now caught before the schema push runs — the smoke test uses a direct pg
    // connection that properly surfaces auth errors, unlike drizzle-kit push
    // which exits 0 on pg error code 28P01.
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

    // The pre-flight step must have been reached — post-merge.sh emits
    // "running pre-flight smoke test..." before invoking the smoke test.
    expect(result.stderr).toContain("running pre-flight smoke test");

    // The pre-flight must have detected the failure — schema-smoke-test emits
    // "cannot connect to database" when authentication is rejected.
    expect(result.stderr).toContain("cannot connect to database");

    // The schema push must NOT have been reached — post-merge.sh emits
    // "running schema push..." immediately before that step.  Its absence
    // confirms the script aborted at the pre-flight step.
    expect(result.stderr).not.toContain("running schema push");

    // The post-push smoke test must also NOT have been reached.
    expect(result.stderr).not.toContain("running post-push smoke test");
  });

  it("exits 0 and runs both smoke tests when DATABASE_URL is valid", () => {
    // Happy-path end-to-end guard: post-merge.sh must complete successfully
    // Vitest timeout is set to 70 s (third arg) because this test runs the full
    // post-merge flow: pre-flight smoke test + schema push + post-push smoke test.
    // when a real, reachable database is available.  Confirms that:
    //   1. the pre-flight smoke test passes
    //   2. the schema push succeeds
    //   3. the post-push smoke test passes
    //
    // If DATABASE_URL is not set in this environment we skip rather than fail.
    const rawUrl = process.env.DATABASE_URL;
    if (!rawUrl) {
      console.warn("Skipping post-merge happy-path test: DATABASE_URL not set in this environment");
      return;
    }

    const result = runPostMerge({ DATABASE_URL: rawUrl });

    // Must exit 0 — the entire post-merge flow succeeded.
    expect(result.status).toBe(0);

    // Both smoke test steps must have been reached and completed.
    expect(result.stderr).toContain("running pre-flight smoke test");
    expect(result.stderr).toContain("running schema push");
    expect(result.stderr).toContain("running post-push smoke test");
  }, 70_000);
});
