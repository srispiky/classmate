/**
 * Classmate Connect — Restore Verification & Disaster Recovery Testing
 *
 * Modes:
 *
 *   Verify-only (no BACKUP_FILE):
 *     Runs integrity checks against DATABASE_URL.
 *     Use after a manual restore or as a health check.
 *
 *   Full DR restore (BACKUP_FILE + RESTORE_CREATE_DB=true):
 *     Creates a temporary database, restores the backup into it,
 *     runs integrity checks, then drops it.
 *
 *   Full DR restore (BACKUP_FILE + RESTORE_TARGET_URL):
 *     Restores into an existing empty target database, then verifies.
 *     The target database is NOT dropped automatically.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run restore-verify
 *   pnpm --filter @workspace/scripts run restore-verify:dr
 *
 * Environment variables:
 *   DATABASE_URL           (required) Source / verify-only target
 *   BACKUP_FILE            (optional) Path to .dump file — enables restore mode
 *   RESTORE_TARGET_URL     (optional) Explicit target DB for restore
 *   RESTORE_CREATE_DB      (optional) "true" — auto-create + auto-drop a temp DB
 *   RESTORE_KEEP_DB        (optional) "true" — keep the temp DB after the test
 *
 * Exit codes:
 *   0 — PASS
 *   1 — FAIL or configuration error
 */

import { execFileSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { basename, join } from "path";
import {
  SQL_TABLE_LIST,
  SQL_ROW_COUNTS,
  SQL_FK_COUNT,
  SQL_IX_INDEX_COUNT,
  evaluateIntegrity,
  formatReport,
  parseSidecar,
  buildSidecar,
  parseRowCounts,
  parsePsqlScalar,
  type SidecarData,
} from "./restore-lib.js";
import { sanitizeErrorMessage } from "./backup-lib.js";

// ── Configuration ──────────────────────────────────────────────────────────────

const DATABASE_URL = process.env["DATABASE_URL"];
const BACKUP_FILE = process.env["BACKUP_FILE"];
const RESTORE_TARGET_URL = process.env["RESTORE_TARGET_URL"];
const RESTORE_CREATE_DB = process.env["RESTORE_CREATE_DB"] === "true";
const RESTORE_KEEP_DB = process.env["RESTORE_KEEP_DB"] === "true";

// ── psql helper ────────────────────────────────────────────────────────────────

function runPsql(url: string, sql: string): string {
  try {
    return execFileSync(
      "psql",
      ["--no-password", "--tuples-only", "--no-align", `--field-separator=,`, url, "--command", sql],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 },
    );
  } catch (err: unknown) {
    let detail = "";
    if (err !== null && typeof err === "object" && "stderr" in err) {
      detail = sanitizeErrorMessage(String((err as { stderr: unknown }).stderr ?? ""));
    } else if (err instanceof Error) {
      detail = sanitizeErrorMessage(err.message);
    }
    throw new Error(`psql query failed: ${detail.trim()}`);
  }
}

function runPsqlAdmin(adminUrl: string, sql: string): void {
  try {
    execFileSync(
      "psql",
      ["--no-password", adminUrl, "--command", sql],
      { stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 },
    );
  } catch (err: unknown) {
    let detail = "";
    if (err !== null && typeof err === "object" && "stderr" in err) {
      detail = sanitizeErrorMessage(String((err as { stderr: unknown }).stderr ?? ""));
    } else if (err instanceof Error) {
      detail = sanitizeErrorMessage(err.message);
    }
    throw new Error(`psql admin command failed: ${detail.trim()}`);
  }
}

// ── Integrity checks ───────────────────────────────────────────────────────────

function runIntegrityChecks(targetUrl: string): {
  tables: string[];
  rowCounts: ReturnType<typeof parseRowCounts>;
  fkCount: number;
  indexCount: number;
} {
  console.log("[restore-verify] Running integrity checks…");

  const tableOutput = runPsql(targetUrl, SQL_TABLE_LIST);
  const tables = tableOutput
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const rowOutput = runPsql(targetUrl, SQL_ROW_COUNTS);
  const rowCounts = parseRowCounts(rowOutput);

  const fkCount = parsePsqlScalar(runPsql(targetUrl, SQL_FK_COUNT));
  const indexCount = parsePsqlScalar(runPsql(targetUrl, SQL_IX_INDEX_COUNT));

  return { tables, rowCounts, fkCount, indexCount };
}

// ── Restore step ───────────────────────────────────────────────────────────────

/**
 * Verify the backup file is present and readable, throwing on failure.
 * Separated so it can be called BEFORE creating a temp database.
 */
function verifyBackupFile(backupFile: string): void {
  if (!existsSync(backupFile)) {
    throw new Error(`backup file not found: ${backupFile}`);
  }
  try {
    const listing = execFileSync(
      "pg_restore",
      ["--list", backupFile],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 },
    );
    const tableCount = listing.split("\n").filter((l) => l.includes("TABLE DATA")).length;
    console.log(`[restore-verify] Backup verified: ${basename(backupFile)} — ${tableCount} TABLE DATA sections`);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.startsWith("backup file not found")) throw err;
    throw new Error("backup file is unreadable or corrupt");
  }
}

function runRestore(backupFile: string, targetUrl: string): void {
  console.log(`[restore-verify] Restoring ${basename(backupFile)} → target database…`);
  try {
    execFileSync(
      "pg_restore",
      ["--no-password", "--no-owner", "--no-privileges", `--dbname=${targetUrl}`, backupFile],
      { stdio: ["ignore", "pipe", "pipe"], timeout: 10 * 60_000 },
    );
    console.log("[restore-verify] pg_restore completed");
  } catch (err: unknown) {
    // pg_restore exits non-zero for warnings too; inspect stderr before failing
    let detail = "";
    if (err !== null && typeof err === "object" && "stderr" in err) {
      detail = sanitizeErrorMessage(String((err as { stderr: unknown }).stderr ?? ""));
    } else if (err instanceof Error) {
      detail = sanitizeErrorMessage(err.message);
    }
    // Warnings about pre-existing objects or ownership are non-fatal in DR tests
    const isFatal =
      detail.includes("invalid data") ||
      detail.includes("file format") ||
      detail.includes("could not connect") ||
      detail.includes("connection refused");
    if (isFatal) {
      throw new Error(`pg_restore failed: ${detail.trim()}`);
    }
    console.warn(`[restore-verify] pg_restore warnings (non-fatal): ${detail.trim().substring(0, 300)}`);
    console.log("[restore-verify] pg_restore completed (with warnings)");
  }
}

// ── Temp database management ───────────────────────────────────────────────────

function buildAdminUrl(dbUrl: string): string {
  // Replace the database name with 'postgres' to connect to admin DB
  return dbUrl.replace(/\/[^/?]+(\?.*)?$/, "/postgres$1");
}

function buildTempDbName(): string {
  return `classmate_dr_${Date.now()}`;
}

function buildTargetUrl(dbUrl: string, dbName: string): string {
  return dbUrl.replace(/\/[^/?]+(\?.*)?$/, `/${dbName}$1`);
}

function createTempDb(dbName: string): void {
  const adminUrl = buildAdminUrl(DATABASE_URL!);
  console.log(`[restore-verify] Creating temp database: ${dbName}`);
  runPsqlAdmin(adminUrl, `CREATE DATABASE "${dbName}";`);
}

function dropTempDb(dbName: string): void {
  const adminUrl = buildAdminUrl(DATABASE_URL!);
  console.log(`[restore-verify] Dropping temp database: ${dbName}`);
  try {
    runPsqlAdmin(adminUrl, `DROP DATABASE IF EXISTS "${dbName}";`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[restore-verify] WARNING: could not drop temp DB ${dbName}: ${msg}`);
  }
}

// ── Sidecar loading ────────────────────────────────────────────────────────────

function loadSidecar(backupFile: string): SidecarData | undefined {
  const sidecarPath = backupFile.replace(/\.dump$/, ".json");
  if (!existsSync(sidecarPath)) {
    console.log("[restore-verify] No sidecar file found — skipping row-count comparison");
    return undefined;
  }
  try {
    const json = readFileSync(sidecarPath, "utf8");
    const sidecar = parseSidecar(json);
    console.log(`[restore-verify] Loaded sidecar from ${basename(sidecarPath)} (snapshot: ${sidecar.timestamp})`);
    return sidecar;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[restore-verify] WARNING: could not parse sidecar file: ${msg} — skipping row-count comparison`);
    return undefined;
  }
}

// ── Entry point ────────────────────────────────────────────────────────────────

function main(): void {
  if (!DATABASE_URL) {
    console.error("[restore-verify] FATAL: DATABASE_URL is not set");
    process.exit(1);
  }

  let mode = "verify-only";
  let targetUrl = DATABASE_URL;
  let tempDbName: string | undefined;
  let sidecar: SidecarData | undefined;

  // ── Determine mode ──────────────────────────────────────────────────────────

  if (BACKUP_FILE) {
    // Verify file exists and is readable BEFORE creating any temp database
    try {
      verifyBackupFile(BACKUP_FILE);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[restore-verify] FATAL: ${msg}`);
      process.exit(1);
    }

    sidecar = loadSidecar(BACKUP_FILE);

    if (RESTORE_TARGET_URL) {
      mode = "full-dr (explicit target)";
      targetUrl = RESTORE_TARGET_URL;
      try {
        runRestore(BACKUP_FILE, targetUrl);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[restore-verify] FATAL: ${msg}`);
        process.exit(1);
      }
    } else if (RESTORE_CREATE_DB) {
      mode = "full-dr (auto temp DB)";
      tempDbName = buildTempDbName();
      targetUrl = buildTargetUrl(DATABASE_URL, tempDbName);
      createTempDb(tempDbName);
      try {
        runRestore(BACKUP_FILE, targetUrl);
      } catch (err) {
        if (!RESTORE_KEEP_DB && tempDbName) dropTempDb(tempDbName);
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[restore-verify] FATAL: ${msg}`);
        process.exit(1);
      }
    } else {
      console.warn(
        "[restore-verify] BACKUP_FILE is set but neither RESTORE_TARGET_URL nor RESTORE_CREATE_DB=true is set.",
      );
      console.warn(
        "[restore-verify] Running in verify-only mode against DATABASE_URL (backup file checked but not restored).",
      );
    }
  }

  // ── Run integrity checks ────────────────────────────────────────────────────

  let checks: ReturnType<typeof runIntegrityChecks>;
  try {
    checks = runIntegrityChecks(targetUrl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[restore-verify] FATAL: integrity checks failed: ${msg}`);
    if (!RESTORE_KEEP_DB && tempDbName) dropTempDb(tempDbName);
    process.exit(1);
  }

  // ── Evaluate ────────────────────────────────────────────────────────────────

  const report = evaluateIntegrity({
    tables: checks.tables,
    rowCounts: checks.rowCounts,
    fkCount: checks.fkCount,
    indexCount: checks.indexCount,
    sidecar,
  });

  console.log(formatReport(report, mode));

  // ── Cleanup ─────────────────────────────────────────────────────────────────

  if (!RESTORE_KEEP_DB && tempDbName) {
    dropTempDb(tempDbName);
  } else if (RESTORE_KEEP_DB && tempDbName) {
    console.log(`[restore-verify] Temp database kept for inspection: ${tempDbName}`);
    console.log(`[restore-verify] To drop it: psql <admin-url> -c 'DROP DATABASE "${tempDbName}";'`);
  }

  // ── Write sidecar if in verify-only mode and no sidecar exists ─────────────

  if (mode === "verify-only" && !sidecar) {
    const sidecarData = buildSidecar(checks.rowCounts, "snapshot", new Date());
    const outPath = join(process.cwd(), `classmate_verify_${Date.now()}.json`);
    try {
      writeFileSync(outPath, JSON.stringify(sidecarData, null, 2), "utf8");
      console.log(`[restore-verify] Row-count snapshot written to ${basename(outPath)}`);
    } catch {
      // Non-fatal
    }
  }

  process.exit(report.pass ? 0 : 1);
}

main();
