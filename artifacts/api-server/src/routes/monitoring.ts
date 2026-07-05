import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { requireRole } from "../middleware/require-role";
import { metrics } from "../lib/metrics";
import { alertService } from "../lib/alerts";
import { sloService } from "../lib/slo";
import { availabilityService } from "../lib/availability";
import { operationalReportService } from "../lib/operations-report";
import { pool } from "@workspace/db";

const router: IRouter = Router();

// ── Shared helper ─────────────────────────────────────────────────────────────

async function checkDbOk(): Promise<{ ok: boolean; detail?: string }> {
  try {
    const client = await pool.connect();
    try {
      await client.query("SELECT 1");
      return { ok: true };
    } finally {
      client.release();
    }
  } catch (err: unknown) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : "unknown error",
    };
  }
}

// ── GET /monitoring/status ────────────────────────────────────────────────────
// Full system-status view. Safe to poll from external monitoring systems.

router.get("/monitoring/status", requireRole("admin"), async (_req, res): Promise<void> => {
  const [db, snap] = await Promise.all([checkDbOk(), Promise.resolve(metrics.snapshot())]);

  // Evaluate alerts so the counts stay current.
  alertService.evaluate(snap, db.ok);
  const alertCounts = alertService.counts();

  res.json({
    status: db.ok ? "ok" : "degraded",
    version: process.env["npm_package_version"] ?? "0.0.0",
    uptime: snap.process.uptimeSeconds,
    database: {
      status: db.ok ? "ok" : "error",
      ...(db.detail ? { detail: db.detail } : {}),
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
    alerts: alertCounts,
  });
});

// ── GET /monitoring/summary ───────────────────────────────────────────────────

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

// ── GET /monitoring/alerts ────────────────────────────────────────────────────
// Evaluate conditions, then return the current alert list.
// Optional query param: ?status=active|acknowledged|resolved

const listAlertsQuerySchema = z.object({
  status: z.enum(["active", "acknowledged", "resolved"]).optional(),
});

router.get("/monitoring/alerts", requireRole("admin"), async (req, res): Promise<void> => {
  const parse = listAlertsQuerySchema.safeParse(req.query);
  const statusFilter = parse.success ? parse.data.status : undefined;

  const [db, snap] = await Promise.all([checkDbOk(), Promise.resolve(metrics.snapshot())]);
  alertService.evaluate(snap, db.ok);

  res.json(alertService.list(statusFilter));
});

// ── GET /monitoring/alerts/:id ────────────────────────────────────────────────

router.get("/monitoring/alerts/:id", requireRole("admin"), (req, res): void => {
  const id = String(req.params["id"]);
  const alert = alertService.get(id);
  if (!alert) {
    res.status(404).json({ error: "Alert not found" });
    return;
  }
  res.json(alert);
});

// ── PATCH /monitoring/alerts/:id ─────────────────────────────────────────────
// Body: { action: "acknowledge" | "resolve" }

const patchAlertSchema = z.object({
  action: z.enum(["acknowledge", "resolve"]),
});

router.patch("/monitoring/alerts/:id", requireRole("admin"), (req, res): void => {
  const parse = patchAlertSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "action must be 'acknowledge' or 'resolve'" });
    return;
  }

  const id = String(req.params["id"]);
  const { action } = parse.data;
  const result =
    action === "acknowledge"
      ? alertService.acknowledge(id)
      : alertService.resolve(id);

  if (!result) {
    res.status(404).json({ error: "Alert not found" });
    return;
  }
  res.json(result);
});

// ── GET /monitoring/slo ───────────────────────────────────────────────────────

router.get("/monitoring/slo", requireRole("admin"), async (_req, res): Promise<void> => {
  const [db, snap] = await Promise.all([checkDbOk(), Promise.resolve(metrics.snapshot())]);
  availabilityService.recordDbHealth(db.ok);
  const replicationConfigured = Boolean(process.env["S3_BUCKET"]);
  const report = sloService.evaluate(snap, db.ok, replicationConfigured);
  res.json(report);
});

// ── GET /monitoring/availability ──────────────────────────────────────────────

router.get("/monitoring/availability", requireRole("admin"), async (_req, res): Promise<void> => {
  const [db, snap] = await Promise.all([checkDbOk(), Promise.resolve(metrics.snapshot())]);
  availabilityService.recordDbHealth(db.ok);
  const avail = availabilityService.snapshot(snap.process.uptimeSeconds, snap);
  res.json(avail);
});

// ── GET /monitoring/operations-report ─────────────────────────────────────────

router.get(
  "/monitoring/operations-report",
  requireRole("admin"),
  async (_req, res): Promise<void> => {
    const [db, snap] = await Promise.all([checkDbOk(), Promise.resolve(metrics.snapshot())]);
    availabilityService.recordDbHealth(db.ok);

    const replicationConfigured = Boolean(process.env["S3_BUCKET"]);
    const sloSnapshot = sloService.evaluate(snap, db.ok, replicationConfigured);
    const availSnap = availabilityService.snapshot(snap.process.uptimeSeconds, snap);

    // Evaluate alerts so the report reflects current state.
    alertService.evaluate(snap, db.ok);
    const allAlerts = alertService.list();

    const report = operationalReportService.generate(snap, allAlerts, sloSnapshot, availSnap);
    res.json(report);
  },
);

export default router;
