import { describe, it, expect } from "vitest";
import {
  EXPECTED_TABLES,
  EXPECTED_FK_MIN,
  EXPECTED_IX_INDEX_MIN,
  parsePsqlRows,
  parsePsqlScalar,
  parseRowCounts,
  evaluateIntegrity,
  formatReport,
  parseSidecar,
  buildSidecar,
  type RowCount,
} from "./restore-lib.js";

// ── parsePsqlRows ──────────────────────────────────────────────────────────────

describe("parsePsqlRows", () => {
  it("splits lines on commas", () => {
    const output = "students,42\ncourses,5\n";
    expect(parsePsqlRows(output)).toEqual([
      ["students", "42"],
      ["courses", "5"],
    ]);
  });

  it("ignores blank lines", () => {
    const output = "\nstudents,42\n\ncourses,5\n\n";
    expect(parsePsqlRows(output)).toHaveLength(2);
  });

  it("handles single-column output", () => {
    const output = "students\ncourses\n";
    expect(parsePsqlRows(output)).toEqual([["students"], ["courses"]]);
  });

  it("returns empty array for empty string", () => {
    expect(parsePsqlRows("")).toEqual([]);
  });
});

// ── parsePsqlScalar ────────────────────────────────────────────────────────────

describe("parsePsqlScalar", () => {
  it("parses a simple integer", () => {
    expect(parsePsqlScalar("42\n")).toBe(42);
  });

  it("returns 0 for empty output", () => {
    expect(parsePsqlScalar("")).toBe(0);
  });

  it("returns 0 for non-numeric output", () => {
    expect(parsePsqlScalar("abc\n")).toBe(0);
  });

  it("reads only the first line", () => {
    expect(parsePsqlScalar("7\n8\n9\n")).toBe(7);
  });
});

// ── parseRowCounts ─────────────────────────────────────────────────────────────

describe("parseRowCounts", () => {
  it("parses table name and row count correctly", () => {
    const output = "students,42\ncourses,5\nnotes,0\n";
    const result = parseRowCounts(output);
    expect(result).toEqual([
      { tableName: "students", rowCount: 42 },
      { tableName: "courses", rowCount: 5 },
      { tableName: "notes", rowCount: 0 },
    ]);
  });

  it("returns empty array for empty output", () => {
    expect(parseRowCounts("")).toEqual([]);
  });

  it("skips lines without a comma", () => {
    const output = "students,42\nbadline\ncourses,5\n";
    const result = parseRowCounts(output);
    expect(result).toHaveLength(2);
  });

  it("defaults to 0 for non-numeric row count", () => {
    const result = parseRowCounts("students,abc\n");
    expect(result[0]?.rowCount).toBe(0);
  });
});

// ── evaluateIntegrity ──────────────────────────────────────────────────────────

const FULL_TABLES = [...EXPECTED_TABLES];
const GOOD_COUNTS: RowCount[] = FULL_TABLES.map((t) => ({
  tableName: t,
  rowCount: 10,
}));

describe("evaluateIntegrity", () => {
  it("passes when all expectations are met", () => {
    const report = evaluateIntegrity({
      tables: FULL_TABLES,
      rowCounts: GOOD_COUNTS,
      fkCount: EXPECTED_FK_MIN,
      indexCount: EXPECTED_IX_INDEX_MIN,
    });
    expect(report.pass).toBe(true);
    expect(report.issues).toHaveLength(0);
    expect(report.missingTables).toHaveLength(0);
  });

  it("fails when tables are missing", () => {
    const report = evaluateIntegrity({
      tables: ["students", "courses"],
      rowCounts: GOOD_COUNTS,
      fkCount: EXPECTED_FK_MIN,
      indexCount: EXPECTED_IX_INDEX_MIN,
    });
    expect(report.pass).toBe(false);
    expect(report.missingTables.length).toBeGreaterThan(0);
    expect(report.issues.some((i) => i.includes("Missing tables"))).toBe(true);
  });

  it("fails when FK count is below minimum", () => {
    const report = evaluateIntegrity({
      tables: FULL_TABLES,
      rowCounts: GOOD_COUNTS,
      fkCount: 2,
      indexCount: EXPECTED_IX_INDEX_MIN,
    });
    expect(report.pass).toBe(false);
    expect(report.issues.some((i) => i.includes("FK constraint count"))).toBe(true);
  });

  it("fails when index count is below minimum", () => {
    const report = evaluateIntegrity({
      tables: FULL_TABLES,
      rowCounts: GOOD_COUNTS,
      fkCount: EXPECTED_FK_MIN,
      indexCount: 5,
    });
    expect(report.pass).toBe(false);
    expect(report.issues.some((i) => i.includes("ix_* index count"))).toBe(true);
  });

  it("uses custom expectedTables when provided", () => {
    const report = evaluateIntegrity({
      tables: ["students", "courses"],
      rowCounts: GOOD_COUNTS,
      fkCount: EXPECTED_FK_MIN,
      indexCount: EXPECTED_IX_INDEX_MIN,
      expectedTables: ["students", "courses"],
    });
    expect(report.missingTables).toHaveLength(0);
  });

  it("fails when sidecar row count does not match", () => {
    const report = evaluateIntegrity({
      tables: FULL_TABLES,
      rowCounts: [{ tableName: "students", rowCount: 5 }, ...GOOD_COUNTS.slice(1)],
      fkCount: EXPECTED_FK_MIN,
      indexCount: EXPECTED_IX_INDEX_MIN,
      sidecar: {
        timestamp: new Date().toISOString(),
        env: "production",
        rowCounts: { students: 42 },
      },
    });
    expect(report.pass).toBe(false);
    expect(report.issues.some((i) => i.includes("students") && i.includes("mismatch"))).toBe(true);
  });

  it("fails when sidecar table is missing from restored DB", () => {
    const report = evaluateIntegrity({
      tables: FULL_TABLES,
      rowCounts: GOOD_COUNTS.filter((r) => r.tableName !== "students"),
      fkCount: EXPECTED_FK_MIN,
      indexCount: EXPECTED_IX_INDEX_MIN,
      sidecar: {
        timestamp: new Date().toISOString(),
        env: "production",
        rowCounts: { students: 10 },
      },
    });
    expect(report.pass).toBe(false);
    expect(report.issues.some((i) => i.includes("students") && i.includes("missing"))).toBe(true);
  });

  it("accumulates multiple issues", () => {
    const report = evaluateIntegrity({
      tables: ["students"],
      rowCounts: GOOD_COUNTS,
      fkCount: 1,
      indexCount: 2,
    });
    expect(report.issues.length).toBeGreaterThanOrEqual(3);
    expect(report.pass).toBe(false);
  });
});

// ── formatReport ──────────────────────────────────────────────────────────────

describe("formatReport", () => {
  it("includes PASS in output when report passes", () => {
    const report = evaluateIntegrity({
      tables: FULL_TABLES,
      rowCounts: GOOD_COUNTS,
      fkCount: EXPECTED_FK_MIN,
      indexCount: EXPECTED_IX_INDEX_MIN,
    });
    expect(formatReport(report, "verify-only")).toContain("PASS");
  });

  it("includes FAIL in output when report fails", () => {
    const report = evaluateIntegrity({
      tables: [],
      rowCounts: [],
      fkCount: 0,
      indexCount: 0,
    });
    expect(formatReport(report, "full-dr")).toContain("FAIL");
  });

  it("includes the mode in output", () => {
    const report = evaluateIntegrity({
      tables: FULL_TABLES,
      rowCounts: GOOD_COUNTS,
      fkCount: EXPECTED_FK_MIN,
      indexCount: EXPECTED_IX_INDEX_MIN,
    });
    expect(formatReport(report, "full-dr (auto temp DB)")).toContain("full-dr (auto temp DB)");
  });
});

// ── parseSidecar ───────────────────────────────────────────────────────────────

describe("parseSidecar", () => {
  it("parses a valid sidecar JSON", () => {
    const json = JSON.stringify({
      timestamp: "2026-06-28T02:30:45.000Z",
      env: "production",
      rowCounts: { students: 42, courses: 5 },
    });
    const result = parseSidecar(json);
    expect(result.timestamp).toBe("2026-06-28T02:30:45.000Z");
    expect(result.env).toBe("production");
    expect(result.rowCounts["students"]).toBe(42);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseSidecar("{not valid json")).toThrow("not valid JSON");
  });

  it("throws when required fields are missing", () => {
    expect(() => parseSidecar(JSON.stringify({ foo: "bar" }))).toThrow(
      "missing required fields",
    );
  });

  it("skips non-numeric rowCount values", () => {
    const json = JSON.stringify({
      timestamp: "2026-06-28T00:00:00.000Z",
      env: "production",
      rowCounts: { students: 42, courses: "five" },
    });
    const result = parseSidecar(json);
    expect(result.rowCounts["students"]).toBe(42);
    expect(result.rowCounts["courses"]).toBeUndefined();
  });
});

// ── buildSidecar ───────────────────────────────────────────────────────────────

describe("buildSidecar", () => {
  it("builds a sidecar with correct structure", () => {
    const now = new Date("2026-06-28T02:30:45.000Z");
    const counts: RowCount[] = [
      { tableName: "students", rowCount: 42 },
      { tableName: "courses", rowCount: 5 },
    ];
    const result = buildSidecar(counts, "production", now);
    expect(result.timestamp).toBe("2026-06-28T02:30:45.000Z");
    expect(result.env).toBe("production");
    expect(result.rowCounts["students"]).toBe(42);
    expect(result.rowCounts["courses"]).toBe(5);
  });

  it("round-trips with parseSidecar", () => {
    const now = new Date("2026-06-28T02:30:45.000Z");
    const counts: RowCount[] = [{ tableName: "users", rowCount: 1 }];
    const built = buildSidecar(counts, "test", now);
    const parsed = parseSidecar(JSON.stringify(built));
    expect(parsed.rowCounts["users"]).toBe(1);
    expect(parsed.env).toBe("test");
  });
});
