/**
 * Classmate Connect — Offsite Replication CLI
 *
 * Called by the GitHub Actions backup workflow after a backup is generated.
 * Reads backup paths from environment variables set by the workflow.
 *
 * Environment variables (all required when S3_BUCKET is set):
 *   S3_BUCKET              — target bucket name
 *   AWS_ACCESS_KEY_ID      — S3 access key
 *   AWS_SECRET_ACCESS_KEY  — S3 secret key
 *   AWS_REGION             — AWS region (default: us-east-1)
 *   S3_ENDPOINT            — custom endpoint for R2/B2/MinIO (optional)
 *   S3_PREFIX              — object key prefix (default: backups)
 *   S3_PATH_STYLE          — "true" to use path-style URLs (MinIO; default: false)
 *   BACKUP_DUMP_PATH       — absolute path to the .dump file
 *   BACKUP_SIDECAR_PATH    — absolute path to the .json sidecar
 *   BACKUP_TYPE            — daily | weekly | monthly
 *
 * Exit codes:
 *   0 — replication succeeded
 *   1 — replication failed
 */

import { resolve } from "path";
import {
  BackupReplicationService,
  BackupTier,
  buildReplicationConfig,
} from "./backup-replication.js";

function resolveEnv(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) {
    console.error(`[replicate] FATAL: ${name} is not set`);
    process.exit(1);
  }
  return v;
}

async function main(): Promise<void> {
  const dumpPath = resolve(resolveEnv("BACKUP_DUMP_PATH"));
  const sidecarPath = process.env["BACKUP_SIDECAR_PATH"]
    ? resolve(process.env["BACKUP_SIDECAR_PATH"])
    : null;
  const tier = resolveEnv("BACKUP_TYPE") as BackupTier;

  if (!["daily", "weekly", "monthly"].includes(tier)) {
    console.error(`[replicate] FATAL: BACKUP_TYPE must be daily, weekly, or monthly — got: "${tier}"`);
    process.exit(1);
  }

  const config = buildReplicationConfig();
  const service = new BackupReplicationService(config);

  console.log(`[replicate] Starting replication`);
  console.log(`[replicate] Tier: ${tier}`);
  console.log(`[replicate] Bucket: ${config.bucket}`);
  console.log(`[replicate] Endpoint: ${config.endpoint ?? "AWS S3 (default)"}`);
  console.log(`[replicate] Prefix: ${config.prefix}`);

  try {
    const result = await service.replicate(dumpPath, sidecarPath, tier);
    console.log(`[replicate] SUCCESS`);
    console.log(`[replicate] Dump key:    ${result.dumpKey}`);
    console.log(`[replicate] Sidecar key: ${result.sidecarKey ?? "skipped"}`);
    console.log(`[replicate] Size:        ${Math.round(result.dumpSizeBytes / 1024)} KB`);
    console.log(`[replicate] SHA-256:     ${result.dumpSha256.slice(0, 16)}…`);
    console.log(`[replicate] Pruned:      ${result.pruned} expired object(s)`);
    process.exit(0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[replicate] FAILED: ${msg}`);
    process.exit(1);
  }
}

main();
