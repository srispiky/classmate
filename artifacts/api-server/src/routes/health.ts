import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";

const router: IRouter = Router();

// GET /api/healthz
//
// Lightweight health probe used by load balancers, container orchestrators, and
// the Replit deployment health-check (artifact.toml → services.production.health.startup).
//
// Returns 200 { status: "ok" } when both the application and database are reachable.
// Returns 503 { status: "error", detail: "..." } when the database is unreachable.
//
// Does NOT require authentication — health probes must work without a session
// cookie so that upstream infrastructure can check liveness freely.
router.get("/healthz", async (_req, res): Promise<void> => {
  try {
    const client = await pool.connect();
    try {
      await client.query("SELECT 1");
    } finally {
      client.release();
    }
  } catch {
    res.status(503).json({ status: "error", detail: "database unreachable" });
    return;
  }
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

export default router;
