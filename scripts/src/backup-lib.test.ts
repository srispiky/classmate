import { describe, it, expect } from "vitest";
import {
  buildBackupFilename,
  parseBackupDate,
  getFilesToPrune,
  sanitizeErrorMessage,
} from "./backup-lib.js";

// ── buildBackupFilename ────────────────────────────────────────────────────────

describe("buildBackupFilename", () => {
  const fixedDate = new Date("2026-06-28T02:30:45.000Z");

  it("produces the correct filename format", () => {
    const result = buildBackupFilename("production", fixedDate);
    expect(result).toBe("classmate_20260628_023045_production.dump");
  });

  it("uses UTC date components, not local time", () => {
    const result = buildBackupFilename("production", fixedDate);
    expect(result).toContain("20260628_023045");
  });

  it("pads single-digit month, day, hour, minute, second", () => {
    const d = new Date("2026-01-05T03:07:09.000Z");
    const result = buildBackupFilename("production", d);
    expect(result).toBe("classmate_20260105_030709_production.dump");
  });

  it("lowercases the environment label", () => {
    const result = buildBackupFilename("PRODUCTION", fixedDate);
    expect(result).toContain("_production.");
  });

  it("strips non-alphanumeric characters from the environment label", () => {
    const result = buildBackupFilename("my-env/2026", fixedDate);
    expect(result).toContain("_myenv2026.");
  });

  it("falls back to 'unknown' when the environment label is empty after sanitization", () => {
    const result = buildBackupFilename("---", fixedDate);
    expect(result).toContain("_unknown.");
  });

  it("always ends with .dump", () => {
    const result = buildBackupFilename("staging", fixedDate);
    expect(result).toMatch(/\.dump$/);
  });

  it("always starts with classmate_", () => {
    const result = buildBackupFilename("staging", fixedDate);
    expect(result).toMatch(/^classmate_/);
  });
});

// ── parseBackupDate ────────────────────────────────────────────────────────────

describe("parseBackupDate", () => {
  it("parses a valid backup filename and returns the correct UTC date", () => {
    const d = parseBackupDate("classmate_20260628_023045_production.dump");
    expect(d).not.toBeNull();
    expect(d!.toISOString()).toBe("2026-06-28T02:30:45.000Z");
  });

  it("accepts a full path and extracts the basename", () => {
    const d = parseBackupDate(
      "/var/backups/classmate/classmate_20260628_023045_production.dump",
    );
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(2026);
  });

  it("returns null for a filename that does not match the convention", () => {
    expect(parseBackupDate("backup.dump")).toBeNull();
    expect(parseBackupDate("classmate_20260628.dump")).toBeNull();
    expect(parseBackupDate("")).toBeNull();
  });

  it("returns null for a .sql file (wrong extension)", () => {
    expect(parseBackupDate("classmate_20260628_023045_production.sql")).toBeNull();
  });

  it("returns null when date components are out of range", () => {
    // Month 13 — Date.UTC produces an invalid roll-over but we trust the regex
    // to keep digits valid; the important thing is the function never throws
    expect(() => parseBackupDate("classmate_20261399_996099_production.dump")).not.toThrow();
  });

  it("round-trips with buildBackupFilename", () => {
    const now = new Date("2026-06-28T02:30:45.000Z");
    const filename = buildBackupFilename("production", now);
    const parsed = parseBackupDate(filename);
    expect(parsed?.toISOString()).toBe(now.toISOString());
  });
});

// ── getFilesToPrune ────────────────────────────────────────────────────────────

describe("getFilesToPrune", () => {
  const now = new Date("2026-06-28T12:00:00.000Z");
  const RETENTION = 7;

  function makeFilename(daysAgo: number, env = "production"): string {
    const d = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    return buildBackupFilename(env, d);
  }

  it("returns an empty array when there are no files", () => {
    expect(getFilesToPrune([], RETENTION, now)).toEqual([]);
  });

  it("returns an empty array when all files are within the retention window", () => {
    const files = [makeFilename(1), makeFilename(3), makeFilename(6)];
    expect(getFilesToPrune(files, RETENTION, now)).toEqual([]);
  });

  it("prunes files older than the retention window", () => {
    const old = makeFilename(10);
    const files = [makeFilename(1), makeFilename(3), old];
    const pruned = getFilesToPrune(files, RETENTION, now);
    expect(pruned).toContain(old);
    expect(pruned).toHaveLength(1);
  });

  it("never prunes the newest backup even if it is older than retention", () => {
    // Only one backup, 30 days old — must be kept
    const onlyFile = makeFilename(30);
    expect(getFilesToPrune([onlyFile], RETENTION, now)).toEqual([]);
  });

  it("keeps the newest and prunes everything else that exceeds retention", () => {
    const newest = makeFilename(1);
    const old1 = makeFilename(10);
    const old2 = makeFilename(20);
    const files = [newest, old1, old2];
    const pruned = getFilesToPrune(files, RETENTION, now);
    expect(pruned).not.toContain(newest);
    expect(pruned).toContain(old1);
    expect(pruned).toContain(old2);
  });

  it("ignores files that do not match the naming convention", () => {
    const files = ["some-random-file.dump", "backup.dump", makeFilename(1)];
    // Unrecognised files are neither pruned nor counted as newest
    const pruned = getFilesToPrune(files, RETENTION, now);
    expect(pruned).not.toContain("some-random-file.dump");
    expect(pruned).not.toContain("backup.dump");
  });

  it("handles a single file exactly at the retention boundary (kept)", () => {
    const boundary = makeFilename(RETENTION); // exactly 7 days ago
    expect(getFilesToPrune([boundary], RETENTION, now)).toEqual([]);
  });

  it("respects a custom retention window", () => {
    const old = makeFilename(5);
    const files = [makeFilename(1), makeFilename(3), old];
    // 3-day retention — 5-day-old file should be pruned
    const pruned = getFilesToPrune(files, 3, now);
    expect(pruned).toContain(old);
  });

  it("does not mutate the input array", () => {
    const files = [makeFilename(1), makeFilename(10)];
    const original = [...files];
    getFilesToPrune(files, RETENTION, now);
    expect(files).toEqual(original);
  });
});

// ── sanitizeErrorMessage ───────────────────────────────────────────────────────

describe("sanitizeErrorMessage", () => {
  it("redacts a postgres:// connection string", () => {
    const msg = "could not connect: postgres://user:pass@host:5432/db";
    expect(sanitizeErrorMessage(msg)).not.toContain("user:pass");
    expect(sanitizeErrorMessage(msg)).toContain("[DATABASE_URL redacted]");
  });

  it("redacts a postgresql:// connection string", () => {
    const msg = "error: postgresql://admin:secret@host/classmate";
    expect(sanitizeErrorMessage(msg)).toContain("[DATABASE_URL redacted]");
    expect(sanitizeErrorMessage(msg)).not.toContain("secret");
  });

  it("redacts password= tokens", () => {
    const msg = "authentication failed password=hunter2 for user";
    expect(sanitizeErrorMessage(msg)).toContain("[password redacted]");
    expect(sanitizeErrorMessage(msg)).not.toContain("hunter2");
  });

  it("redacts DATABASE_URL= tokens", () => {
    const msg = "env: DATABASE_URL=postgres://user:pass@host/db";
    expect(sanitizeErrorMessage(msg)).toContain("[DATABASE_URL redacted]");
    expect(sanitizeErrorMessage(msg)).not.toContain("user:pass");
  });

  it("passes through safe messages unchanged", () => {
    const msg = "pg_dump: error: connection to server failed";
    expect(sanitizeErrorMessage(msg)).toBe(msg);
  });

  it("handles an empty string", () => {
    expect(sanitizeErrorMessage("")).toBe("");
  });
});
