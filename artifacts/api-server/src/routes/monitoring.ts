import { Router, type IRouter } from "express";
import { requireRole } from "../middleware/require-role";
import { metrics } from "../lib/metrics";
import { pool } from "@workspace/db";

const router: IRouter = Router();

// Both monitoring endpoints are admin-only.
// Authentication is enforced globally by routes/index.ts requireAuth,
// and role enforcement is applied at the handler level here.

// GET /monitoring/status
// Full system-status view: application, database, backup, replication.
// Safe to poll from external monitoring systems (no secrets exposed).
router.get("/monitoring/status", requireRole("admin"), async (_req, res): Promise<void> => {
  let dbOk = false;
  let dbDetail: string | undefined;

  try {
    const client = await pool.connect();
    try {
      await client.query("SELECT 1");
      dbOk = true;
    } finally {
      client.release();
    }
  } catch (err: unknown) {
    dbDetail = err instanceof Error ? err.message : "unknown error";
  }

  const snap = metrics.snapshot();

  res.json({
    status: dbOk ? "ok" : "degraded",
    version: process.env["npm_package_version"] ?? "0.0.0",
    uptime: snap.process.uptimeSeconds,
    database: {
      status: dbOk ? "ok" : "error",
      ...(dbDetail ? { detail: dbDetail } : {}),
      queryCount: snap.database.queryCount,
      queryFailures: snap.database.queryFailures,
      avgQueryMs: snap.database.avgQueryMs,
    },
    backup: {
      configured: Boolean(process.env["DATABASE_URL"]),
      runs: snap.backup.runs,
      failures: snap.backup.failures,
      lastRunAt: snap.backup.lastRunAt,
    },
    replication: {
      configured: Boolean(process.env["S3_BUCKET"]),
    },
  });
});

// GET /monitoring/summary
// Operational summary: request metrics, auth counters, latency percentiles,
// slowest endpoints, database stats, backup health, and process info.
router.get("/monitoring/summary", requireRole("admin"), (_req, res): void => {
  const snap = metrics.snapshot();

  res.json({
    requests: snap.requests,
    auth: snap.auth,
    latency: snap.latency,
    slowestEndpoints: snap.slowestEndpoints,
    database: snap.database,
    backup: snap.backup,
    process: snap.process,
  });
});

export default router;
