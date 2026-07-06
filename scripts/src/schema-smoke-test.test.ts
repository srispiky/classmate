import { describe, it, expect } from "vitest";
import { spawnSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(__dirname, "schema-smoke-test.ts");

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
