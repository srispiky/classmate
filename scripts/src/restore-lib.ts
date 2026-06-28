/**
 * Pure utility functions for restore validation and integrity checking.
 * No side effects — safe to import in tests without any environment setup.
 */

// ── Schema expectations ────────────────────────────────────────────────────────

export const EXPECTED_TABLES = [
  "activity",
  "announcements",
  "assessments",
  "assignments",
  "course_enrollments",
  "courses",
  "notes",
  "session",
  "student_guardians",
  "students",
  "users",
] as const;

export const EXPECTED_FK_MIN = 36;
export const EXPECTED_IX_INDEX_MIN = 18;

// ── SQL queries (run via psql -c) ──────────────────────────────────────────────

export const SQL_TABLE_LIST =
  "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;";

/**
 * Exact per-table COUNT(*) via UNION ALL — avoids stale pg_stat_user_tables estimates.
 * Column order: table_name, row_count
 */
export const SQL_ROW_COUNTS =
  EXPECTED_TABLES.map(
    (t, i) =>
      `${i === 0 ? "SELECT" : "UNION ALL SELECT"} '${t}' AS table_name, COUNT(*) AS row_count FROM "${t}"`,
  ).join("\n") + "\nORDER BY table_name;";

export const SQL_FK_COUNT =
  "SELECT COUNT(*) FROM pg_constraint WHERE contype='f';";

export const SQL_IX_INDEX_COUNT =
  "SELECT COUNT(*) FROM pg_indexes WHERE schemaname='public' AND indexname LIKE 'ix_%';";

// ── Data types ─────────────────────────────────────────────────────────────────

export interface RowCount {
  tableName: string;
  rowCount: number;
}

export interface IntegrityReport {
  tables: string[];
  rowCounts: RowCount[];
  fkCount: number;
  indexCount: number;
  missingTables: string[];
  pass: boolean;
  issues: string[];
}

export interface SidecarData {
  timestamp: string;
  env: string;
  rowCounts: Record<string, number>;
}

// ── Parsing helpers ────────────────────────────────────────────────────────────

/**
 * Parse the comma-separated, tuples-only output from psql into key-value pairs.
 * Each line is expected to be: value  (single column)
 * or: col1,col2  (two columns)
 */
export function parsePsqlRows(output: string): string[][] {
  return output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => l.split(","));
}

/**
 * Parse a single-value psql output (e.g., COUNT result) into a number.
 */
export function parsePsqlScalar(output: string): number {
  const val = output.trim().split("\n")[0]?.trim() ?? "";
  const n = parseInt(val, 10);
  return isNaN(n) ? 0 : n;
}

/**
 * Parse psql row-count output into RowCount array.
 * Expected format per line: tablename,count
 */
export function parseRowCounts(output: string): RowCount[] {
  return parsePsqlRows(output)
    .filter((cols) => cols.length >= 2)
    .map((cols) => ({
      tableName: cols[0]!.trim(),
      rowCount: parseInt(cols[1]!.trim(), 10) || 0,
    }));
}

// ── Integrity evaluation ───────────────────────────────────────────────────────

/**
 * Evaluate integrity results against expected schema.
 * Returns a report with pass/fail and a list of issues.
 */
export function evaluateIntegrity(params: {
  tables: string[];
  rowCounts: RowCount[];
  fkCount: number;
  indexCount: number;
  expectedTables?: readonly string[];
  expectedFkMin?: number;
  expectedIndexMin?: number;
  sidecar?: SidecarData;
}): IntegrityReport {
  const issues: string[] = [];
  const expectedTables = params.expectedTables ?? EXPECTED_TABLES;
  const fkMin = params.expectedFkMin ?? EXPECTED_FK_MIN;
  const idxMin = params.expectedIndexMin ?? EXPECTED_IX_INDEX_MIN;

  const missingTables = expectedTables.filter(
    (t) => !params.tables.includes(t),
  );
  if (missingTables.length > 0) {
    issues.push(`Missing tables: ${missingTables.join(", ")}`);
  }

  if (params.fkCount < fkMin) {
    issues.push(
      `FK constraint count ${params.fkCount} is below minimum ${fkMin}`,
    );
  }

  if (params.indexCount < idxMin) {
    issues.push(
      `ix_* index count ${params.indexCount} is below minimum ${idxMin}`,
    );
  }

  if (params.sidecar) {
    for (const [table, expected] of Object.entries(params.sidecar.rowCounts)) {
      const actual = params.rowCounts.find((r) => r.tableName === table);
      if (actual === undefined) {
        issues.push(
          `Table "${table}" missing from restored DB (sidecar expected ${expected} rows)`,
        );
      } else if (actual.rowCount !== expected) {
        issues.push(
          `Table "${table}" row count mismatch: expected ${expected}, got ${actual.rowCount}`,
        );
      }
    }
  }

  return {
    tables: params.tables,
    rowCounts: params.rowCounts,
    fkCount: params.fkCount,
    indexCount: params.indexCount,
    missingTables,
    pass: issues.length === 0,
    issues,
  };
}

// ── Report formatting ──────────────────────────────────────────────────────────

export function formatReport(report: IntegrityReport, mode: string): string {
  const lines: string[] = [
    `[restore-verify] Mode: ${mode}`,
    `[restore-verify] Tables present: ${report.tables.length} / ${EXPECTED_TABLES.length} expected`,
    `[restore-verify] Foreign keys: ${report.fkCount} (min ${EXPECTED_FK_MIN})`,
    `[restore-verify] ix_* indexes: ${report.indexCount} (min ${EXPECTED_IX_INDEX_MIN})`,
    `[restore-verify] Row counts:`,
  ];

  for (const rc of report.rowCounts) {
    lines.push(`[restore-verify]   ${rc.tableName.padEnd(22)} ${rc.rowCount}`);
  }

  if (report.missingTables.length > 0) {
    lines.push(
      `[restore-verify] MISSING TABLES: ${report.missingTables.join(", ")}`,
    );
  }

  for (const issue of report.issues) {
    lines.push(`[restore-verify] ISSUE: ${issue}`);
  }

  lines.push(
    `[restore-verify] ─────────────────────────────────────`,
  );
  lines.push(
    `[restore-verify] Result: ${report.pass ? "PASS ✓" : "FAIL ✗"}`,
  );

  return lines.join("\n");
}

// ── Sidecar helpers ────────────────────────────────────────────────────────────

/**
 * Parse a sidecar JSON file produced by the backup script.
 * Throws if the JSON is invalid or missing required fields.
 */
export function parseSidecar(json: string): SidecarData {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("Sidecar file is not valid JSON");
  }

  if (
    typeof data !== "object" ||
    data === null ||
    typeof (data as Record<string, unknown>)["timestamp"] !== "string" ||
    typeof (data as Record<string, unknown>)["rowCounts"] !== "object"
  ) {
    throw new Error(
      'Sidecar JSON missing required fields: "timestamp" and "rowCounts"',
    );
  }

  const raw = data as Record<string, unknown>;
  const rowCounts: Record<string, number> = {};
  for (const [k, v] of Object.entries(
    raw["rowCounts"] as Record<string, unknown>,
  )) {
    if (typeof v === "number") rowCounts[k] = v;
  }

  return {
    timestamp: raw["timestamp"] as string,
    env: typeof raw["env"] === "string" ? raw["env"] : "unknown",
    rowCounts,
  };
}

/**
 * Build a sidecar JSON object from a set of row counts.
 */
export function buildSidecar(
  rowCounts: RowCount[],
  env: string,
  now: Date,
): SidecarData {
  const counts: Record<string, number> = {};
  for (const rc of rowCounts) {
    counts[rc.tableName] = rc.rowCount;
  }
  return {
    timestamp: now.toISOString(),
    env,
    rowCounts: counts,
  };
}
