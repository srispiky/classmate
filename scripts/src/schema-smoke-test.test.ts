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
});
