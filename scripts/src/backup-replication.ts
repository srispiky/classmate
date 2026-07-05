/**
 * Classmate Connect — Offsite Backup Replication Service
 *
 * Uploads backup dump + sidecar to any S3-compatible object storage provider.
 * Verifies upload integrity via file-size comparison and SHA-256 metadata.
 * Prunes old objects according to per-tier retention windows.
 *
 * Provider support (via S3_ENDPOINT):
 *   - AWS S3            — no endpoint override needed
 *   - Cloudflare R2     — endpoint: https://<account>.r2.cloudflarestorage.com
 *   - Backblaze B2      — endpoint: https://s3.<region>.backblazeb2.com
 *   - MinIO             — endpoint: https://minio.example.com (set S3_PATH_STYLE=true)
 */

import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { createHash } from "crypto";
import { readFileSync, existsSync, statSync } from "fs";
import { basename } from "path";
import { getFilesToPrune, parseBackupDate } from "./backup-lib.js";

// ── Retention windows ──────────────────────────────────────────────────────────

export const OFFSITE_RETENTION_DAYS: Record<BackupTier, number> = {
  daily: 30,
  weekly: 84,   // 12 weeks
  monthly: 365, // 12 months
};

export type BackupTier = "daily" | "weekly" | "monthly";

// ── Configuration ──────────────────────────────────────────────────────────────

export interface ReplicationConfig {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
  prefix: string;
  forcePathStyle?: boolean;
}

export function buildReplicationConfig(): ReplicationConfig {
  const missing: string[] = [];

  const bucket = process.env["S3_BUCKET"] ?? "";
  const region = process.env["AWS_REGION"] ?? "us-east-1";
  const accessKeyId = process.env["AWS_ACCESS_KEY_ID"] ?? "";
  const secretAccessKey = process.env["AWS_SECRET_ACCESS_KEY"] ?? "";
  const endpoint = process.env["S3_ENDPOINT"] ?? undefined;
  const prefix = process.env["S3_PREFIX"] ?? "backups";
  const forcePathStyle = process.env["S3_PATH_STYLE"] === "true";

  if (!bucket) missing.push("S3_BUCKET");
  if (!accessKeyId) missing.push("AWS_ACCESS_KEY_ID");
  if (!secretAccessKey) missing.push("AWS_SECRET_ACCESS_KEY");

  if (missing.length > 0) {
    for (const v of missing) {
      console.error(`[replicate] FATAL: ${v} is not set`);
    }
    process.exit(1);
  }

  return { bucket, region, accessKeyId, secretAccessKey, endpoint, prefix, forcePathStyle };
}

// ── Replication result ─────────────────────────────────────────────────────────

export interface ReplicationResult {
  dumpKey: string;
  sidecarKey: string | null;
  dumpSizeBytes: number;
  dumpSha256: string;
  backupTier: BackupTier;
  timestamp: string;
  pruned: number;
}

// ── Retry helper ──────────────────────────────────────────────────────────────

export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts: number,
  baseDelayMs = 1000,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) {
        const delay = baseDelayMs * (i + 1);
        console.warn(
          `[replicate] Attempt ${i + 1}/${attempts} failed — retrying in ${delay}ms: ${err instanceof Error ? err.message : String(err)}`,
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class BackupReplicationService {
  private readonly client: S3Client;
  private readonly config: ReplicationConfig;

  constructor(config: ReplicationConfig, clientOverride?: S3Client) {
    this.config = config;
    this.client =
      clientOverride ??
      new S3Client({
        region: config.region,
        endpoint: config.endpoint,
        forcePathStyle: config.forcePathStyle ?? false,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
      });
  }

  /**
   * Upload dump + sidecar to offsite storage, verify integrity, prune retention.
   * Retries each upload up to `retryAttempts` times with linear backoff.
   */
  async replicate(
    dumpPath: string,
    sidecarPath: string | null,
    tier: BackupTier,
    retryAttempts = 3,
  ): Promise<ReplicationResult> {
    if (!existsSync(dumpPath)) {
      throw new Error(`Dump file not found: ${dumpPath}`);
    }

    const dumpFilename = basename(dumpPath);
    const dumpKey = this.buildKey(tier, dumpFilename);

    const dumpBuffer = readFileSync(dumpPath);
    const dumpSha256 = createHash("sha256").update(dumpBuffer).digest("hex");
    const dumpSizeBytes = dumpBuffer.length;

    console.log(`[replicate] Uploading dump → s3://${this.config.bucket}/${dumpKey}`);
    await withRetry(
      () => this.uploadWithVerify(dumpKey, dumpBuffer, dumpSha256, tier),
      retryAttempts,
    );
    console.log(`[replicate] Dump uploaded and verified (${Math.round(dumpSizeBytes / 1024)} KB, sha256=${dumpSha256.slice(0, 12)}…)`);

    let sidecarKey: string | null = null;
    if (sidecarPath && existsSync(sidecarPath)) {
      const sidecarFilename = basename(sidecarPath);
      sidecarKey = this.buildKey(tier, sidecarFilename);
      const sidecarBuffer = readFileSync(sidecarPath);
      const sidecarSha256 = createHash("sha256").update(sidecarBuffer).digest("hex");

      console.log(`[replicate] Uploading sidecar → s3://${this.config.bucket}/${sidecarKey}`);
      await withRetry(
        () => this.uploadWithVerify(sidecarKey!, sidecarBuffer, sidecarSha256, tier),
        retryAttempts,
      );
      console.log(`[replicate] Sidecar uploaded and verified`);
    } else {
      console.warn(`[replicate] WARNING: sidecar not found — skipping sidecar upload`);
    }

    const pruned = await this.pruneRetention(tier, new Date());

    return {
      dumpKey,
      sidecarKey,
      dumpSizeBytes,
      dumpSha256,
      backupTier: tier,
      timestamp: new Date().toISOString(),
      pruned,
    };
  }

  /**
   * List objects in the tier prefix, apply retention policy, delete expired objects.
   * Returns the count of dump files pruned (sidecar deletions are not counted separately).
   */
  async pruneRetention(tier: BackupTier, now: Date): Promise<number> {
    const prefix = `${this.config.prefix}/${tier}/`;
    const retentionDays = OFFSITE_RETENTION_DAYS[tier];

    const listResponse = await this.client.send(
      new ListObjectsV2Command({ Bucket: this.config.bucket, Prefix: prefix }),
    );

    const dumpKeys = (listResponse.Contents ?? [])
      .map((obj) => obj.Key ?? "")
      .filter((key) => key.endsWith(".dump"));

    const dumpBasenames = dumpKeys.map((key) => key.split("/").pop() ?? "");
    const toDelete = getFilesToPrune(dumpBasenames, retentionDays, now);

    if (toDelete.length === 0) {
      console.log(`[replicate] Retention: no offsite objects to prune for ${tier} (policy: ${retentionDays} days)`);
      return 0;
    }

    let pruned = 0;
    for (const filename of toDelete) {
      const dumpKey = `${prefix}${filename}`;
      const sidecarKey = dumpKey.replace(".dump", ".json");

      try {
        await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: dumpKey }));
        await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: sidecarKey }));
        console.log(`[replicate] Pruned: ${filename}`);
        pruned++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[replicate] WARNING: could not prune ${filename}: ${msg}`);
      }
    }

    console.log(`[replicate] Retention: pruned ${pruned} of ${toDelete.length} expired object(s) from ${tier}`);
    return pruned;
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private buildKey(tier: BackupTier, filename: string): string {
    return `${this.config.prefix}/${tier}/${filename}`;
  }

  private async uploadWithVerify(
    key: string,
    body: Buffer,
    sha256hex: string,
    tier: BackupTier,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        ContentLength: body.length,
        Metadata: {
          sha256: sha256hex,
          "backup-tier": tier,
          "backup-filename": key.split("/").pop() ?? "",
        },
      }),
    );

    const head = await this.client.send(
      new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );

    const remoteSize = (head as { ContentLength?: number }).ContentLength;
    if (remoteSize !== body.length) {
      throw new Error(
        `Upload integrity check failed for ${key}: local=${body.length} bytes, remote=${remoteSize} bytes`,
      );
    }

    const remoteSha256 = (head as { Metadata?: Record<string, string> }).Metadata?.["sha256"];
    if (remoteSha256 && remoteSha256 !== sha256hex) {
      throw new Error(
        `Checksum mismatch for ${key}: local=${sha256hex.slice(0, 12)}…, remote=${remoteSha256.slice(0, 12)}…`,
      );
    }
  }
}
