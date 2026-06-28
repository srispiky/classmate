/**
 * Pure utility functions for backup naming, date parsing, and retention filtering.
 * No side effects — safe to import in tests without any environment setup.
 */

export const BACKUP_PREFIX = "classmate_";
export const BACKUP_EXT = ".dump";

// Matches: classmate_YYYYMMDD_HHMMSS_env.dump
const FILENAME_RE =
  /^classmate_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_([a-z0-9]+)\.dump$/;

/**
 * Build a timestamped backup filename.
 * Format: classmate_YYYYMMDD_HHMMSS_{env}.dump
 * All date components are UTC.
 */
export function buildBackupFilename(env: string, now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = now.getUTCFullYear();
  const mo = pad(now.getUTCMonth() + 1);
  const d = pad(now.getUTCDate());
  const h = pad(now.getUTCHours());
  const mi = pad(now.getUTCMinutes());
  const s = pad(now.getUTCSeconds());
  const safeEnv = env.replace(/[^a-z0-9]/gi, "").toLowerCase() || "unknown";
  return `${BACKUP_PREFIX}${y}${mo}${d}_${h}${mi}${s}_${safeEnv}${BACKUP_EXT}`;
}

/**
 * Parse the UTC Date embedded in a backup filename.
 * Returns null if the filename does not match the expected naming convention.
 * Accepts bare filenames or full paths (basename is extracted automatically).
 */
export function parseBackupDate(filename: string): Date | null {
  const base = filename.split(/[/\\]/).pop() ?? "";
  const match = base.match(FILENAME_RE);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const dt = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
  return isNaN(dt.getTime()) ? null : dt;
}

/**
 * Return filenames that should be pruned given a retention policy.
 *
 * Safety guarantee: the most recently created backup is always kept,
 * regardless of its age relative to the retention window.
 *
 * Files whose names do not parse as valid backup filenames are ignored
 * (not pruned, not counted as the newest).
 */
export function getFilesToPrune(
  files: string[],
  retentionDays: number,
  now: Date,
): string[] {
  if (files.length === 0) return [];

  const dated = files
    .map((f) => ({ file: f, date: parseBackupDate(f) }))
    .filter((x): x is { file: string; date: Date } => x.date !== null);

  if (dated.length === 0) return [];

  // Sort newest → oldest
  dated.sort((a, b) => b.date.getTime() - a.date.getTime());

  // Always keep the newest — only consider the rest for pruning
  const [, ...candidates] = dated;

  const cutoffMs = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;

  return candidates
    .filter((x) => x.date.getTime() < cutoffMs)
    .map((x) => x.file);
}

/**
 * Strip connection strings and password tokens from an error message
 * to prevent credential leakage in log output.
 */
export function sanitizeErrorMessage(msg: string): string {
  return msg
    .replace(/postgres(?:ql)?:\/\/[^\s"'\r\n]*/gi, "[DATABASE_URL redacted]")
    .replace(/password\s*[=:]\s*[^\s"'\r\n]*/gi, "[password redacted]")
    .replace(/DATABASE_URL=[^\s"'\r\n]*/gi, "[DATABASE_URL redacted]");
}
