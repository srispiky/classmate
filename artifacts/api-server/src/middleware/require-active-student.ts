import type { RequestHandler } from "express";
import { eq, and, isNull } from "drizzle-orm";
import { db, studentsTable } from "@workspace/db";
import { buildScopeContext, type ClassmateSession } from "../lib/scope-context";

/**
 * Student record liveness middleware.
 *
 * Re-queries the students table on every request to verify that the student
 * record linked to the session is still active (not soft-deleted). A session
 * issued before a student was soft-deleted would otherwise retain a stale
 * studentId and continue to reach student-portal data.
 *
 * Must be composed AFTER requireRole("student") so that role denial (403) fires
 * before the DB round-trip is incurred.
 *
 * Response on denial:
 *   HTTP 404 — IDOR-safe: does not reveal whether the record existed.
 *
 * Usage:
 *   router.get("/student/dashboard",
 *     requireRole("student"),
 *     requireActiveStudent,
 *     async (req, res) => { ... }
 *   );
 */
export const requireActiveStudent: RequestHandler = async (req, res, next) => {
  const scope = buildScopeContext(req.session as ClassmateSession);

  if (scope.studentId === null) {
    res.status(404).json({ error: "Student record not found" });
    return;
  }

  const rows = await db
    .select({ id: studentsTable.id })
    .from(studentsTable)
    .where(and(eq(studentsTable.id, scope.studentId), isNull(studentsTable.deletedAt)))
    .limit(1);

  if (rows.length === 0) {
    res.status(404).json({ error: "Student record not found" });
    return;
  }

  next();
};
