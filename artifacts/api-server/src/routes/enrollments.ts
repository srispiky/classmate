import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db, studentsTable } from "@workspace/db";
import { buildScopeContext, type ClassmateSession } from "../lib/scope-context";
import { ownershipDenied } from "../lib/query-contracts";
import { PolicyAuthorizationError } from "../lib/policies";
import { coursePolicy } from "../shared/auth/policies/course-scope-policy";
import { requireRole } from "../middleware/require-role";
import { getCourseById } from "../lib/courses.queries";
import {
  getActiveEnrollment,
  createEnrollment,
  deactivateEnrollment,
} from "../lib/enrollments.queries";

const router: IRouter = Router();

// ── Param schemas ─────────────────────────────────────────────────────────────

const EnrollParams = z.object({
  courseId: z.coerce.number().int().positive(),
});

const UnenrollParams = z.object({
  courseId: z.coerce.number().int().positive(),
  studentId: z.coerce.number().int().positive(),
});

const EnrollBody = z.object({
  studentId: z.number().int().positive(),
});

// ── POST /api/courses/:courseId/enrollments ────────────────────────────────────
//
// Enroll a student into a course.
//
// Layer 1 — requireRole("admin", "teacher") : students and parents are blocked.
// Layer 3 — coursePolicy.validateAccess     : teacher must own the target course.
//
// Validation sequence (fail-fast):
//   1. Course exists (not soft-deleted) → 404
//   2. Layer 3 ownership check           → 403
//   3. Course status === "active"        → 422
//   4. Student exists                    → 404
//   5. No active duplicate enrollment    → 409

router.post(
  "/courses/:courseId/enrollments",
  requireRole("admin", "teacher"),
  async (req, res): Promise<void> => {
    const scope = buildScopeContext(req.session as ClassmateSession);

    const params = EnrollParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const body = EnrollBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }

    const { courseId } = params.data;
    const { studentId } = body.data;

    // Step 1 — course exists (soft-delete aware)
    const course = await getCourseById(courseId);
    if (!course) {
      res.status(404).json({ error: "Course not found" });
      return;
    }

    // Step 2 — Layer 3: teacher can only enroll into owned courses
    try {
      coursePolicy.validateAccess(scope, course);
    } catch (err) {
      if (err instanceof PolicyAuthorizationError) {
        res.status(403).json(ownershipDenied("course", courseId));
        return;
      }
      throw err;
    }

    // Step 3 — course must be active
    if (course.status !== "active") {
      res.status(422).json({ error: "Cannot enroll into an inactive course" });
      return;
    }

    // Step 4 — student exists
    const [student] = await db
      .select({ id: studentsTable.id })
      .from(studentsTable)
      .where(eq(studentsTable.id, studentId))
      .limit(1);

    if (!student) {
      res.status(404).json({ error: "Student not found" });
      return;
    }

    // Step 5 — no existing active enrollment (duplicate prevention)
    const existing = await getActiveEnrollment(courseId, studentId);
    if (existing) {
      res.status(409).json({ error: "Student already enrolled" });
      return;
    }

    const enrollment = await createEnrollment(courseId, studentId, scope.userId);

    // Session impact: scope.enrolledCourseIds / scope.childCourseIds will reflect
    // this new enrollment on the student's/parent's next login or session refresh.
    // No immediate session mutation is performed here.

    res.status(201).json({
      id: enrollment.id,
      courseId: enrollment.courseId,
      studentId: enrollment.studentId,
      enrolledAt: enrollment.enrolledAt.toISOString(),
      enrolledBy: enrollment.enrolledBy,
      isActive: enrollment.isActive,
    });
  },
);

// ── DELETE /api/courses/:courseId/enrollments/:studentId ──────────────────────
//
// Soft-unenroll a student from a course. Historical record is preserved.
//
// Layer 1 — requireRole("admin", "teacher") : students and parents are blocked.
// Layer 3 — coursePolicy.validateAccess     : teacher must own the target course.
//
// Soft delete sets isActive=false and droppedAt=now().
// Returns 404 when no active enrollment exists for the student/course pair.

router.delete(
  "/courses/:courseId/enrollments/:studentId",
  requireRole("admin", "teacher"),
  async (req, res): Promise<void> => {
    const scope = buildScopeContext(req.session as ClassmateSession);

    const params = UnenrollParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const { courseId, studentId } = params.data;

    // Step 1 — course exists (soft-delete aware)
    const course = await getCourseById(courseId);
    if (!course) {
      res.status(404).json({ error: "Course not found" });
      return;
    }

    // Step 2 — Layer 3: teacher can only remove from owned courses
    try {
      coursePolicy.validateAccess(scope, course);
    } catch (err) {
      if (err instanceof PolicyAuthorizationError) {
        res.status(403).json(ownershipDenied("course", courseId));
        return;
      }
      throw err;
    }

    // Soft unenroll — sets isActive=false, droppedAt=now(), droppedBy=scope.userId
    const removed = await deactivateEnrollment(courseId, studentId, scope.userId);
    if (!removed) {
      res.status(404).json({ error: "Enrollment not found" });
      return;
    }

    res.status(204).send();
  },
);

export default router;
