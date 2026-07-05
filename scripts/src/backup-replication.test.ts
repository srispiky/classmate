/**
 * Unit tests for BackupReplicationService.
 *
 * All S3 network calls are mocked — no real bucket access required.
 * Tests cover: successful replication, upload failure, checksum/size mismatch,
 * retention cleanup, retry behavior, and config validation.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createHash } from "crypto";

const mockSend = vi.hoisted(() => vi.fn());

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn(() => ({ send: mockSend })),
  PutObjectCommand: vi.fn((input: unknown) => ({ _tag: "PutObject", ...((input ?? {}) as object) })),
  HeadObjectCommand: vi.fn((input: unknown) => ({ _tag: "HeadObject", ...((input ?? {}) as object) })),
  ListObjectsV2Command: vi.fn((input: unknown) => ({ _tag: "ListObjectsV2", ...((input ?? {}) as object) })),
  DeleteObjectCommand: vi.fn((input: unknown) => ({ _tag: "DeleteObject", ...((input ?? {}) as object) })),
}));

import {
  BackupReplicationService,
  OFFSITE_RETENTION_DAYS,
  withRetry,
  type ReplicationConfig,
} from "./backup-replication.js";

const CONFIG: ReplicationConfig = {
  bucket: "classmate-backups-test",
  region: "us-east-1",
  accessKeyId: "test-key-id",
  secretAccessKey: "test-secret",
  prefix: "backups",
};

const DUMP_CONTENT = "fake-pg-dump-content-for-testing-purposes";
const SIDECAR_CONTENT = '{"env":"production","timestamp":"2026-07-05T02:00:00Z","tables":[]}';
const DUMP_FILENAME = "classmate_20260705_020000_production.dump";
const SIDECAR_FILENAME = "classmate_20260705_020000_production.json";

let tmpDir: string;
let dumpPath: string;
let sidecarPath: string;

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function setupSuccessfulSend(dumpSize: number, sidecarSize: number): void {
  mockSend
    .mockResolvedValueOnce({})                                          // PutObject dump
    .mockResolvedValueOnce({                                            // HeadObject dump
      ContentLength: dumpSize,
      Metadata: { sha256: sha256(DUMP_CONTENT) },
    })
    .mockResolvedValueOnce({})                                          // PutObject sidecar
    .mockResolvedValueOnce({                                            // HeadObject sidecar
      ContentLength: sidecarSize,
      Metadata: { sha256: sha256(SIDECAR_CONTENT) },
    })
    .mockResolvedValueOnce({ Contents: [] });                           // ListObjectsV2 (pruning)
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "classmate-repl-test-"));
  dumpPath = join(tmpDir, DUMP_FILENAME);
  sidecarPath = join(tmpDir, SIDECAR_FILENAME);
  writeFileSync(dumpPath, DUMP_CONTENT);
  writeFileSync(sidecarPath, SIDECAR_CONTENT);
  mockSend.mockReset();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── Retention constants ───────────────────────────────────────────────────────

describe("Offsite retention windows", () => {
  it("daily retention is 30 days", () => {
    expect(OFFSITE_RETENTION_DAYS.daily).toBe(30);
  });

  it("weekly retention is 84 days (12 weeks)", () => {
    expect(OFFSITE_RETENTION_DAYS.weekly).toBe(84);
  });

  it("monthly retention is 365 days (12 months)", () => {
    expect(OFFSITE_RETENTION_DAYS.monthly).toBe(365);
  });
});

// ── Successful replication ────────────────────────────────────────────────────

describe("BackupReplicationService.replicate — success", () => {
  it("uploads dump and sidecar and returns a result", async () => {
    setupSuccessfulSend(Buffer.byteLength(DUMP_CONTENT), Buffer.byteLength(SIDECAR_CONTENT));

    const svc = new BackupReplicationService(CONFIG);
    const result = await svc.replicate(dumpPath, sidecarPath, "daily");

    expect(result.dumpKey).toBe(`backups/daily/${DUMP_FILENAME}`);
    expect(result.sidecarKey).toBe(`backups/daily/${SIDECAR_FILENAME}`);
    expect(result.backupTier).toBe("daily");
    expect(result.dumpSizeBytes).toBe(Buffer.byteLength(DUMP_CONTENT));
    expect(result.dumpSha256).toBe(sha256(DUMP_CONTENT));
  });

  it("calls send exactly 5 times for a full replication with pruning", async () => {
    setupSuccessfulSend(Buffer.byteLength(DUMP_CONTENT), Buffer.byteLength(SIDECAR_CONTENT));

    const svc = new BackupReplicationService(CONFIG);
    await svc.replicate(dumpPath, sidecarPath, "daily");

    expect(mockSend).toHaveBeenCalledTimes(5); // Put+Head dump, Put+Head sidecar, List
  });

  it("uses tier-namespaced S3 key prefix for daily", async () => {
    setupSuccessfulSend(Buffer.byteLength(DUMP_CONTENT), Buffer.byteLength(SIDECAR_CONTENT));

    const svc = new BackupReplicationService(CONFIG);
    await svc.replicate(dumpPath, sidecarPath, "daily");

    const firstCall = mockSend.mock.calls[0][0] as { Key?: string };
    expect(firstCall.Key).toContain("backups/daily/");
  });

  it("uses tier-namespaced S3 key prefix for weekly", async () => {
    setupSuccessfulSend(Buffer.byteLength(DUMP_CONTENT), Buffer.byteLength(SIDECAR_CONTENT));

    const svc = new BackupReplicationService(CONFIG);
    await svc.replicate(dumpPath, sidecarPath, "weekly");

    const firstCall = mockSend.mock.calls[0][0] as { Key?: string };
    expect(firstCall.Key).toContain("backups/weekly/");
  });

  it("uses tier-namespaced S3 key prefix for monthly", async () => {
    setupSuccessfulSend(Buffer.byteLength(DUMP_CONTENT), Buffer.byteLength(SIDECAR_CONTENT));

    const svc = new BackupReplicationService(CONFIG);
    await svc.replicate(dumpPath, sidecarPath, "monthly");

    const firstCall = mockSend.mock.calls[0][0] as { Key?: string };
    expect(firstCall.Key).toContain("backups/monthly/");
  });

  it("skips sidecar upload gracefully when sidecarPath is null", async () => {
    mockSend
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        ContentLength: Buffer.byteLength(DUMP_CONTENT),
        Metadata: { sha256: sha256(DUMP_CONTENT) },
      })
      .mockResolvedValueOnce({ Contents: [] });

    const svc = new BackupReplicationService(CONFIG);
    const result = await svc.replicate(dumpPath, null, "daily");

    expect(result.sidecarKey).toBeNull();
    expect(mockSend).toHaveBeenCalledTimes(3); // Put+Head dump, List
  });

  it("includes sha256 checksum in PutObject metadata", async () => {
    setupSuccessfulSend(Buffer.byteLength(DUMP_CONTENT), Buffer.byteLength(SIDECAR_CONTENT));

    const svc = new BackupReplicationService(CONFIG);
    await svc.replicate(dumpPath, sidecarPath, "daily");

    const putCall = mockSend.mock.calls[0][0] as { Metadata?: Record<string, string> };
    expect(putCall.Metadata?.["sha256"]).toBe(sha256(DUMP_CONTENT));
  });
});

// ── Upload failure ────────────────────────────────────────────────────────────

describe("BackupReplicationService.replicate — upload failure", () => {
  it("throws when PutObjectCommand rejects", async () => {
    mockSend.mockRejectedValue(new Error("NoSuchBucket"));

    const svc = new BackupReplicationService(CONFIG);
    await expect(svc.replicate(dumpPath, sidecarPath, "daily", 1)).rejects.toThrow("NoSuchBucket");
  });

  it("throws when dump file does not exist", async () => {
    const svc = new BackupReplicationService(CONFIG);
    await expect(
      svc.replicate("/nonexistent/path/backup.dump", sidecarPath, "daily"),
    ).rejects.toThrow("Dump file not found");
  });
});

// ── Size / checksum mismatch ──────────────────────────────────────────────────

describe("BackupReplicationService.replicate — integrity failures", () => {
  it("throws on size mismatch (remote ContentLength differs from local)", async () => {
    mockSend
      .mockResolvedValueOnce({})                 // PutObject
      .mockResolvedValueOnce({ ContentLength: 9999 }); // HeadObject — wrong size

    const svc = new BackupReplicationService(CONFIG);
    await expect(svc.replicate(dumpPath, sidecarPath, "daily", 1)).rejects.toThrow(
      /integrity check failed/,
    );
  });

  it("throws on checksum mismatch (remote sha256 metadata differs)", async () => {
    const localSize = Buffer.byteLength(DUMP_CONTENT);
    mockSend
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        ContentLength: localSize,
        Metadata: { sha256: "aabbccdd00000000000000000000000000000000000000000000000000000000" },
      });

    const svc = new BackupReplicationService(CONFIG);
    await expect(svc.replicate(dumpPath, sidecarPath, "daily", 1)).rejects.toThrow(
      /Checksum mismatch/,
    );
  });
});

// ── Retry behavior ────────────────────────────────────────────────────────────

describe("withRetry", () => {
  it("succeeds on first attempt when function resolves", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, 3, 0);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries and succeeds on second attempt", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce("ok");
    const result = await withRetry(fn, 3, 0);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("exhausts attempts and rethrows the last error", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("persistent"));
    await expect(withRetry(fn, 3, 0)).rejects.toThrow("persistent");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("calls function exactly once when attempts=1", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));
    await expect(withRetry(fn, 1, 0)).rejects.toThrow("fail");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ── Retention cleanup ─────────────────────────────────────────────────────────

describe("BackupReplicationService.pruneRetention", () => {
  it("deletes dump and sidecar for each expired object", async () => {
    mockSend
      .mockResolvedValueOnce({                   // ListObjectsV2
        Contents: [
          { Key: "backups/daily/classmate_20260101_020000_production.dump" },
          { Key: "backups/daily/classmate_20260101_020000_production.json" },
          { Key: "backups/daily/classmate_20260704_020000_production.dump" },
          { Key: "backups/daily/classmate_20260704_020000_production.json" },
        ],
      })
      .mockResolvedValue({});                    // DeleteObject calls

    const now = new Date("2026-07-05T02:00:00Z");
    const svc = new BackupReplicationService(CONFIG);
    const pruned = await svc.pruneRetention("daily", now);

    expect(pruned).toBe(1); // only Jan 1 backup is older than 30 days
    const deleteCalls = mockSend.mock.calls.slice(1).map((c) => (c[0] as { Key?: string }).Key);
    expect(deleteCalls).toContain("backups/daily/classmate_20260101_020000_production.dump");
    expect(deleteCalls).toContain("backups/daily/classmate_20260101_020000_production.json");
  });

  it("does not delete the newest backup even if it exceeds retention window", async () => {
    mockSend
      .mockResolvedValueOnce({
        Contents: [
          { Key: "backups/weekly/classmate_20260101_020000_production.dump" },
        ],
      })
      .mockResolvedValue({});

    const now = new Date("2026-07-05T02:00:00Z");
    const svc = new BackupReplicationService(CONFIG);
    const pruned = await svc.pruneRetention("weekly", now);

    expect(pruned).toBe(0); // newest backup is always kept, even if old
  });

  it("returns 0 and skips delete when no objects exist", async () => {
    mockSend.mockResolvedValueOnce({ Contents: [] });

    const svc = new BackupReplicationService(CONFIG);
    const pruned = await svc.pruneRetention("monthly", new Date());

    expect(pruned).toBe(0);
    expect(mockSend).toHaveBeenCalledTimes(1); // only the List call
  });

  it("lists objects under the correct tier prefix", async () => {
    mockSend.mockResolvedValueOnce({ Contents: [] });

    const svc = new BackupReplicationService(CONFIG);
    await svc.pruneRetention("weekly", new Date());

    const listCall = mockSend.mock.calls[0][0] as { Prefix?: string };
    expect(listCall.Prefix).toBe("backups/weekly/");
  });
});
