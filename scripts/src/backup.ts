/**
 * Classmate Connect — Automated Database Backup
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run backup
 *   pnpm --filter @workspace/scripts run backup:weekly
 *
 * Environment variables:
 *   DATABASE_URL            (required) PostgreSQL connection string
 *   BACKUP_DIR              (optional) Output directory, default: ./backups
 *   BACKUP_RETENTION_DAYS   (optional) Days to keep daily backups, default: 7
 *   BACKUP_ENV              (optional) Label embedded in filename, default: NODE_ENV or "development"
 *
 * Exit codes:
 *   0 — success
 *   1 — failure (missing config, pg_dump error, output file not created)
 */

import { execFileSync } from "child_process";
import { mkdirSync, readdirSync, rmSync, statSync } from "fs";
import { join, resolve } from "path";
import {
  buildBackupFilename,
  getFilesToPrune,
  parseBackupDate,
  sanitizeErrorMessage,
} from "./backup-lib.js";

// ── Configuration ──────────────────────────────────────────────────────────────

const DATABASE_URL = process.env["DATABASE_URL"];
const BACKUP_DIR = resolve(process.env["BACKUP_DIR"] ?? "./backups");
const RETENTION_DAYS_RAW = process.env["BACKUP_RETENTION_DAYS"] ?? "7";
const RETENTION_DAYS = parseInt(RETENTION_DAYS_RAW, 10);
const ENV_LABEL =
  process.env["BACKUP_ENV"] ?? process.env["NODE_ENV"] ?? "development";

// ── Validation ─────────────────────────────────────────────────────────────────

function validateConfig(): void {
  const errors: string[] = [];

  if (!DATABASE_URL) {
    errors.push("DATABASE_URL is not set — cannot connect to PostgreSQL");
  }

  if (!RETENTION_DAYS_RAW.match(/^\d+$/) || RETENTION_DAYS < 1) {
    errors.push(
      `BACKUP_RETENTION_DAYS must be a positive integer, got: "${RETENTION_DAYS_RAW}"`,
    );
  }

  if (errors.length > 0) {
    for (const e of errors) {
      console.error(`[backup] FATAL: ${e}`);
    }
    process.exit(1);
  }
}

// ── Backup ─────────────────────────────────────────────────────────────────────

function runBackup(outputPath: string): void {
  try {
    execFileSync(
      "pg_dump",
      [
        "--no-password",
        "--format=custom",
        "--compress=9",
        `--file=${outputPath}`,
        DATABASE_URL!, // validated above; never logged
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 10 * 60 * 1000, // 10-minute safety cap
      },
    );
  } catch (err: unknown) {
    let detail = "";
    if (err !== null && typeof err === "object" && "stderr" in err) {
      detail = sanitizeErrorMessage(String((err as { stderr: unknown }).stderr ?? ""));
    } else if (err instanceof Error) {
      detail = sanitizeErrorMessage(err.message);
    }
    console.error("[backup] FAILED: pg_dump exited with an error");
    if (detail.trim()) {
      console.error(`[backup] Detail: ${detail.trim()}`);
    }
    process.exit(1);
  }
}

// ── Verify output ──────────────────────────────────────────────────────────────

function verifyOutput(outputPath: string, filename: string): void {
  let size = 0;
  try {
    size = statSync(outputPath).size;
  } catch {
    console.error("[backup] FAILED: output file was not created after pg_dump");
    process.exit(1);
  }

  if (size === 0) {
    console.error("[backup] FAILED: output file is empty — pg_dump produced no data");
    process.exit(1);
  }

  const kb = Math.round(size / 1024);
  console.log(`[backup] SUCCESS: ${filename} (${kb} KB)`);
}

// ── Retention cleanup ──────────────────────────────────────────────────────────

function runRetentionCleanup(now: Date): void {
  let allFiles: string[];
  try {
    allFiles = readdirSync(BACKUP_DIR).filter(
      (f) => f.endsWith(".dump") && parseBackupDate(f) !== null,
    );
  } catch {
    console.warn(
      "[backup] WARNING: could not read backup directory for retention cleanup — skipping",
    );
    return;
  }

  const toDelete = getFilesToPrune(allFiles, RETENTION_DAYS, now);

  if (toDelete.length === 0) {
    console.log(
      `[backup] Retention: no files to prune (policy: ${RETENTION_DAYS} days)`,
    );
    return;
  }

  let pruned = 0;
  for (const file of toDelete) {
    try {
      rmSync(join(BACKUP_DIR, file));
      console.log(`[backup] Pruned: ${file}`);
      pruned++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[backup] WARNING: could not prune ${file}: ${msg}`);
    }
  }
  console.log(
    `[backup] Retention: pruned ${pruned} of ${toDelete.length} eligible file(s)`,
  );
}

// ── Entry point ────────────────────────────────────────────────────────────────

function main(): void {
  validateConfig();

  const now = new Date();
  const filename = buildBackupFilename(ENV_LABEL, now);

  mkdirSync(BACKUP_DIR, { recursive: true });
  const outputPath = join(BACKUP_DIR, filename);

  console.log(`[backup] Starting backup → ${filename}`);
  console.log(`[backup] Output directory: ${BACKUP_DIR}`);
  console.log(
    `[backup] Environment: ${ENV_LABEL} | Retention: ${RETENTION_DAYS} days`,
  );
  // DATABASE_URL intentionally not logged

  runBackup(outputPath);
  verifyOutput(outputPath, filename);
  runRetentionCleanup(now);

  console.log("[backup] Done");
  process.exit(0);
}

main();
