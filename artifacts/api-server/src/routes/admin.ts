import { Router, type IRouter } from "express";
import { pool, db, testConnection, studentsTable, coursesTable, assignmentsTable, notesTable, assessmentsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireRole } from "../middleware/require-role";
import { metrics } from "../lib/metrics";

const router: IRouter = Router();

// All admin endpoints require authentication (enforced by routes/index.ts requireAuth)
// plus admin role (enforced here at Layer 1).

router.get("/admin/db-status", requireRole("admin"), async (_req, res): Promise<void> => {
  try {
    const client = await pool.connect();
    let version = "";
    let dbName = "";
    try {
      const versionRes = await client.query("SELECT version()");
      version = (versionRes.rows[0] as { version: string })?.version ?? "";
      const dbRes = await client.query("SELECT current_database()");
      dbName = (dbRes.rows[0] as { current_database: string })?.current_database ?? "";
    } finally {
      client.release();
    }

    const [studentCount, courseCount, assignmentCount, noteCount, assessmentCount] =
      await Promise.all([
        db.select({ count: sql<number>`count(*)` }).from(studentsTable),
        db.select({ count: sql<number>`count(*)` }).from(coursesTable),
        db.select({ count: sql<number>`count(*)` }).from(assignmentsTable),
        db.select({ count: sql<number>`count(*)` }).from(notesTable),
        db.select({ count: sql<number>`count(*)` }).from(assessmentsTable),
      ]);

    const rawUrl = process.env.DATABASE_URL ?? "";
    let host = "";
    let port = "";
    let user = "";
    try {
      const u = new URL(rawUrl);
      host = u.hostname;
      port = u.port || "5432";
      user = u.username;
    } catch { /* ignore */ }

    res.json({
      connected: true,
      version,
      database: dbName,
      host,
      port,
      user,
      tables: {
        students: Number(studentCount[0]?.count ?? 0),
        courses: Number(courseCount[0]?.count ?? 0),
        assignments: Number(assignmentCount[0]?.count ?? 0),
        notes: Number(noteCount[0]?.count ?? 0),
        assessments: Number(assessmentCount[0]?.count ?? 0),
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(200).json({ connected: false, error: message });
  }
});

router.post("/admin/test-db", requireRole("admin"), async (req, res): Promise<void> => {
  const { host, port, database, user, password } = req.body as {
    host?: string;
    port?: string;
    database?: string;
    user?: string;
    password?: string;
  };

  if (!host || !database || !user) {
    res.status(400).json({ success: false, error: "host, database, and user are required" });
    return;
  }

  const result = await testConnection({
    host,
    port: Number(port ?? 5432),
    database,
    user,
    password: password ?? "",
  });

  res.json(result);
});

// GET /admin/metrics — admin-only operational metrics snapshot.
// Returns in-memory counters that reset on server restart.
// Security: never exposes credentials, session data, or student PII.
router.get("/admin/metrics", requireRole("admin"), (_req, res): void => {
  res.json(metrics.snapshot());
});

export default router;
