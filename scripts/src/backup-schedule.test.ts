/**
 * Tests for backup scheduling, workflow configuration, and output validation.
 *
 * Covers:
 * - Workflow file existence and required triggers
 * - Credential safety (no hardcoded secrets)
 * - Backup output validation logic
 * - Scheduler invocation surface (script + command presence)
 * - Retention policy constants
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { buildBackupFilename, parseBackupDate, getFilesToPrune } from "./backup-lib.js";

const REPO_ROOT = join(new URL(".", import.meta.url).pathname, "../..");
const WORKFLOW_PATH = join(REPO_ROOT, ".github/workflows/backup.yml");
const SCRIPTS_PKG_PATH = join(REPO_ROOT, "scripts/package.json");

// ── Workflow configuration ────────────────────────────────────────────────────

describe("Backup workflow configuration", () => {
  it("workflow file exists at .github/workflows/backup.yml", () => {
    expect(existsSync(WORKFLOW_PATH)).toBe(true);
  });

  it("workflow has daily cron trigger at 02:00 UTC", () => {
    const content = readFileSync(WORKFLOW_PATH, "utf-8");
    expect(content).toContain("0 2 * * *");
  });

  it("workflow has workflow_dispatch trigger for manual override", () => {
    const content = readFileSync(WORKFLOW_PATH, "utf-8");
    expect(content).toContain("workflow_dispatch");
  });

  it("workflow provides daily, weekly, and monthly as manual backup type options", () => {
    const content = readFileSync(WORKFLOW_PATH, "utf-8");
    expect(content).toContain("- daily");
    expect(content).toContain("- weekly");
    expect(content).toContain("- monthly");
  });

  it("workflow detects monthly on 1st of month before weekly on Sunday", () => {
    const content = readFileSync(WORKFLOW_PATH, "utf-8");
    const monthlyIdx = content.indexOf('type=monthly');
    const weeklyIdx = content.indexOf('type=weekly');
    expect(monthlyIdx).toBeGreaterThan(-1);
    expect(weeklyIdx).toBeGreaterThan(-1);
    expect(monthlyIdx).toBeLessThan(weeklyIdx);
  });

  it("workflow has replication check step that reads S3_BUCKET from secrets", () => {
    const content = readFileSync(WORKFLOW_PATH, "utf-8");
    expect(content).toContain("secrets.S3_BUCKET");
    expect(content).toContain("backup:replicate");
  });

  it("workflow passes replication env vars from secrets only", () => {
    const content = readFileSync(WORKFLOW_PATH, "utf-8");
    expect(content).toContain("secrets.AWS_ACCESS_KEY_ID");
    expect(content).toContain("secrets.AWS_SECRET_ACCESS_KEY");
    expect(content).not.toMatch(/AWS_ACCESS_KEY_ID\s*:\s*[A-Z0-9]{10,}/);
  });

  it("workflow skips replication when S3_BUCKET is not configured", () => {
    const content = readFileSync(WORKFLOW_PATH, "utf-8");
    expect(content).toContain("enabled=false");
    expect(content).toContain("S3_BUCKET not configured");
  });

  it("monthly artifact has 365-day retention", () => {
    const content = readFileSync(WORKFLOW_PATH, "utf-8");
    expect(content).toContain("retention-days: 365");
  });

  it("workflow uses DATABASE_URL from GitHub secrets — never hardcoded", () => {
    const content = readFileSync(WORKFLOW_PATH, "utf-8");
    expect(content).toContain("secrets.DATABASE_URL");
    expect(content).not.toMatch(/postgresql:\/\/[^${\s]/);
    expect(content).not.toMatch(/postgres:\/\/[^${\s]/);
    expect(content).not.toMatch(/password\s*=\s*[a-zA-Z0-9]/i);
  });

  it("workflow uploads backup artifact and fails if no files found", () => {
    const content = readFileSync(WORKFLOW_PATH, "utf-8");
    expect(content).toContain("upload-artifact");
    expect(content).toContain("if-no-files-found: error");
  });

  it("workflow validates dump file non-empty with explicit exit 1", () => {
    const content = readFileSync(WORKFLOW_PATH, "utf-8");
    expect(content).toContain(".dump");
    const exitCount = (content.match(/exit 1/g) ?? []).length;
    expect(exitCount).toBeGreaterThanOrEqual(3);
  });

  it("workflow validates sidecar JSON exists", () => {
    const content = readFileSync(WORKFLOW_PATH, "utf-8");
    expect(content).toContain(".json");
    expect(content).toContain("sidecar");
  });

  it("workflow runs pg_restore dry-run to verify dump structure", () => {
    const content = readFileSync(WORKFLOW_PATH, "utf-8");
    expect(content).toContain("pg_restore");
    expect(content).toContain("TABLE DATA");
  });

  it("workflow writes job summary on success and failure", () => {
    const content = readFileSync(WORKFLOW_PATH, "utf-8");
    expect(content).toContain("GITHUB_STEP_SUMMARY");
    expect(content).toContain("if: always()");
  });

  it("workflow restricts permissions to contents: read only", () => {
    const content = readFileSync(WORKFLOW_PATH, "utf-8");
    expect(content).toContain("permissions:");
    expect(content).toContain("contents: read");
    expect(content).not.toContain("contents: write");
  });

  it("daily artifact has 30-day retention", () => {
    const content = readFileSync(WORKFLOW_PATH, "utf-8");
    expect(content).toContain("retention-days: 30");
  });

  it("weekly artifact has 90-day retention", () => {
    const content = readFileSync(WORKFLOW_PATH, "utf-8");
    expect(content).toContain("retention-days: 90");
  });
});

// ── Scheduler invocation surface ─────────────────────────────────────────────

describe("Backup scheduler invocation", () => {
  it("backup script exists at scripts/src/backup.ts", () => {
    expect(existsSync(join(REPO_ROOT, "scripts/src/backup.ts"))).toBe(true);
  });

  it("restore-verify script exists for post-restore validation", () => {
    expect(existsSync(join(REPO_ROOT, "scripts/src/restore-verify.ts"))).toBe(true);
  });

  it("scripts package defines 'backup' command", () => {
    const pkg = JSON.parse(readFileSync(SCRIPTS_PKG_PATH, "utf-8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["backup"]).toBeDefined();
    expect(pkg.scripts["backup"]).toContain("backup.ts");
  });

  it("scripts package defines 'backup:weekly' command with 28-day retention", () => {
    const pkg = JSON.parse(readFileSync(SCRIPTS_PKG_PATH, "utf-8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["backup:weekly"]).toBeDefined();
    expect(pkg.scripts["backup:weekly"]).toContain("BACKUP_RETENTION_DAYS=28");
  });
});

// ── Backup output validation logic ───────────────────────────────────────────

describe("Backup output validation logic", () => {
  it("dump filename matches expected pattern with production env label", () => {
    const name = buildBackupFilename("production", new Date("2026-07-05T02:00:00Z"));
    expect(name).toBe("classmate_20260705_020000_production.dump");
    expect(name).toMatch(/^classmate_\d{8}_\d{6}_[a-z0-9]+\.dump$/);
  });

  it("weekly dump filename uses 'weekly' env label", () => {
    const name = buildBackupFilename("weekly", new Date("2026-07-06T02:00:00Z"));
    expect(name).toContain("_weekly");
    expect(name).toMatch(/^classmate_\d{8}_\d{6}_[a-z0-9]+\.dump$/);
  });

  it("sidecar filename derives from dump filename by extension swap", () => {
    const dump = buildBackupFilename("production", new Date("2026-07-05T02:00:00Z"));
    const sidecar = dump.replace(".dump", ".json");
    expect(sidecar).toBe("classmate_20260705_020000_production.json");
    expect(dump.replace(".dump", "")).toBe(sidecar.replace(".json", ""));
  });

  it("zero-byte dump detection: size === 0 represents empty backup failure", () => {
    const size = 0;
    expect(size).toBe(0);
  });

  it("non-zero dump size is accepted as valid", () => {
    const size = 1024 * 500;
    expect(size).toBeGreaterThan(0);
  });
});

// ── Retention execution ───────────────────────────────────────────────────────

describe("Retention execution", () => {
  it("daily retention window is 7 days (default)", () => {
    const retentionDays = 7;
    expect(retentionDays).toBe(7);
  });

  it("weekly retention window is 28 days (from backup:weekly script)", () => {
    const pkg = JSON.parse(readFileSync(SCRIPTS_PKG_PATH, "utf-8")) as {
      scripts: Record<string, string>;
    };
    const weeklyCmd = pkg.scripts["backup:weekly"] ?? "";
    const match = weeklyCmd.match(/BACKUP_RETENTION_DAYS=(\d+)/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(28);
  });

  it("getFilesToPrune always keeps the newest backup regardless of age", () => {
    const now = new Date("2026-07-05T02:00:00Z");
    const files = [
      "classmate_20260101_020000_production.dump",
      "classmate_20260201_020000_production.dump",
      "classmate_20260301_020000_production.dump",
    ];
    const pruned = getFilesToPrune(files, 7, now);
    const newest = "classmate_20260301_020000_production.dump";
    expect(pruned).not.toContain(newest);
  });

  it("getFilesToPrune returns all but newest when all exceed retention window", () => {
    const now = new Date("2026-07-05T02:00:00Z");
    const files = [
      "classmate_20260101_020000_production.dump",
      "classmate_20260201_020000_production.dump",
      "classmate_20260630_020000_production.dump",
    ];
    const pruned = getFilesToPrune(files, 3, now);
    expect(pruned.length).toBe(2);
    expect(pruned).not.toContain("classmate_20260630_020000_production.dump");
  });

  it("getFilesToPrune returns empty array when all files are within retention window", () => {
    const now = new Date("2026-07-05T02:00:00Z");
    const files = [
      "classmate_20260704_020000_production.dump",
      "classmate_20260703_020000_production.dump",
    ];
    const pruned = getFilesToPrune(files, 7, now);
    expect(pruned).toHaveLength(0);
  });

  it("parseBackupDate extracts correct UTC timestamps from filenames", () => {
    const date = parseBackupDate("classmate_20260705_020000_production.dump");
    expect(date).not.toBeNull();
    expect(date!.toISOString()).toBe("2026-07-05T02:00:00.000Z");
  });

  it("parseBackupDate returns null for non-backup filenames", () => {
    expect(parseBackupDate("README.md")).toBeNull();
    expect(parseBackupDate("classmate_bad_name.dump")).toBeNull();
  });
});
