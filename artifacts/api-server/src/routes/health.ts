import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { metrics } from "../lib/metrics";

const router: IRouter = Router();

// Application version — read once at startup to avoid repeated FS access.
const APP_VERSION = process.env["npm_package_version"] ?? "0.0.0";

// GET /api/healthz
//
// Lightweight health probe used by load balancers, container orchestrators, and
// the Replit deployment health-check (artifact.toml → services.production.health.startup).
//
// Returns 200 when the application and database are reachable.
// Returns 503 when the database is unreachable.
//
// Does NOT require authentication — health probes must work without a session
// cookie so upstream infrastructure can check liveness freely.
//
// Security note: this endpoint never exposes database URLs, credentials, or
// session secrets. Backup/replication status is reported as boolean flags only.
router.get("/healthz", async (_req, res): Promise<void> => {
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

  const body = {
    status: dbOk ? "ok" : "error",
    version: APP_VERSION,
    uptime: snap.process.uptimeSeconds,
    database: {
      status: dbOk ? "ok" : "error",
      ...(dbDetail ? { detail: dbDetail } : {}),
    },
    backup: {
      // Whether the server environment is configured for automated backups.
      // Does not reveal the DATABASE_URL value itself.
      configured: Boolean(process.env["DATABASE_URL"]),
    },
    replication: {
      // Whether offsite S3 replication is configured.
      // Does not reveal bucket names or credentials.
      configured: Boolean(process.env["S3_BUCKET"]),
    },
    metrics: {
      requests: snap.requests.total,
      errors: snap.requests.errors,
      avgDurationMs: snap.requests.avgDurationMs,
    },
  };

  res.status(dbOk ? 200 : 503).json(body);
});

export default router;
