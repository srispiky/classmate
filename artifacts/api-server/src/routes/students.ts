import { Router, type IRouter, type Response } from "express";
import { eq, isNull, and } from "drizzle-orm";
import { db, studentsTable, courseEnrollmentsTable, assignmentsTable, assessmentsTable } from "@workspace/db";
import {
  CreateStudentBody,
  GetStudentParams,
  GetStudentResponse,
  UpdateStudentParams,
  UpdateStudentBody,
  UpdateStudentResponse,
  ListStudentsResponse,
  GetStudentProgressParams,
  GetStudentProgressResponse,
} from "@workspace/api-zod";
import { buildScopeContext, type ClassmateSession } from "../lib/scope-context";
import { requireRole } from "../middleware/require-role";
import { studentPolicy } from "../lib/policies/student-scope-policy";
import { PolicyAuthorizationError } from "../lib/policies/resource-scope-policy";

const router: IRouter = Router();

/**
 * Fetches the active enrolled course IDs for a student from course_enrollments.
 * Called by Layer 3 ownership checks — provides data the policy needs without
 * making DB calls inside the policy itself.
 */
async function fetchStudentEnrolledCourseIds(studentId: number): Promise<number[]> {
  const rows = await db
    .select({ courseId: courseEnrollmentsTable.courseId })
    .from(courseEnrollmentsTable)
    .where(
      and(
        eq(courseEnrollmentsTable.studentId, studentId),
        eq(courseEnrollmentsTable.isActive, true),
      ),
    );
  return rows.map((r) => r.courseId);
}

/**
 * Serializes a student DB row to a plain object ready for JSON/Zod parsing.
 * Normalises nullable fields and converts timestamps to ISO strings.
 */
function serializeStudent(s: typeof studentsTable.$inferSelect) {
  return {
    ...s,
    avatarUrl: s.avatarUrl ?? null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    createdBy: s.createdBy ?? null,
    updatedBy: s.updatedBy ?? null,
  };
}

/**
 * Applies Layer 3 ownership guard and sends 403 if denied.
 * Returns true when access is denied (caller must return early).
 */
async function applyLayer3Guard(
  scope: ReturnType<typeof buildScopeContext>,
  studentId: number,
  res: Response,
): Promise<boolean> {
  const enrolledCourseIds = await fetchStudentEnrolledCourseIds(studentId);
  try {
    studentPolicy.validateAccess(scope, { id: studentId, enrolledCourseIds });
    return false;
  } catch (err) {
    if (err instanceof PolicyAuthorizationError) {
      res.status(403).json({ error: "Access denied" });
      return true;
    }
    throw err;
  }
}

// ── GET /api/students ─────────────────────────────────────────────────────────
// Layer 1: admin + teacher only (requireRole).
// Layer 2: teachers see only students enrolled in at least one of their courses.
// Admins receive all active students (no filter).
router.get("/students", requireRole("admin", "teacher"), async (req, res): Promise<void> => {
  const scope = buildScopeContext(req.session as ClassmateSession);
  const scopeCondition = studentPolicy.getScopeCondition(scope);

  const students = await db
    .select()
    .from(studentsTable)
    .where(and(isNull(studentsTable.deletedAt), scopeCondition))
    .orderBy(studentsTable.name);

  res.json(ListStudentsResponse.parse(students.map(serializeStudent)));
});

// ── POST /api/students ────────────────────────────────────────────────────────
// Layer 1: admin + teacher only (requireRole).
// Audit compliance: createdBy and updatedBy populated from session.
router.post("/students", requireRole("admin", "teacher"), async (req, res): Promise<void> => {
  const scope = buildScopeContext(req.session as ClassmateSession);
  const parsed = CreateStudentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [student] = await db
    .insert(studentsTable)
    .values({
      name: parsed.data.name,
      email: parsed.data.email,
      grade: parsed.data.grade,
      avatarUrl: parsed.data.avatarUrl ?? null,
      enrolledCourseIds: [],
      createdBy: scope.userId,
      updatedBy: scope.userId,
    })
    .returning();

  res.status(201).json(GetStudentResponse.parse(serializeStudent(student!)));
});

// ── GET /api/students/:id ─────────────────────────────────────────────────────
// Layer 1: admin + teacher only (requireRole).
// Layer 3: teachers may only access students enrolled in their courses.
router.get("/students/:id", requireRole("admin", "teacher"), async (req, res): Promise<void> => {
  const scope = buildScopeContext(req.session as ClassmateSession);
  const params = GetStudentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [student] = await db
    .select()
    .from(studentsTable)
    .where(eq(studentsTable.id, params.data.id));

  if (!student || student.deletedAt !== null) {
    res.status(404).json({ error: "Student not found" });
    return;
  }

  const denied = await applyLayer3Guard(scope, student.id, res);
  if (denied) return;

  res.json(GetStudentResponse.parse(serializeStudent(student)));
});

// ── PATCH /api/students/:id ───────────────────────────────────────────────────
// Layer 1: admin + teacher only (requireRole).
// Layer 3: teachers may only update their own students.
// Audit compliance: updatedBy and updatedAt populated from session.
router.patch("/students/:id", requireRole("admin", "teacher"), async (req, res): Promise<void> => {
  const scope = buildScopeContext(req.session as ClassmateSession);
  const params = UpdateStudentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateStudentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db
    .select({ id: studentsTable.id, deletedAt: studentsTable.deletedAt })
    .from(studentsTable)
    .where(eq(studentsTable.id, params.data.id));

  if (!existing || existing.deletedAt !== null) {
    res.status(404).json({ error: "Student not found" });
    return;
  }

  const denied = await applyLayer3Guard(scope, params.data.id, res);
  if (denied) return;

  const [student] = await db
    .update(studentsTable)
    .set({
      ...parsed.data,
      updatedBy: scope.userId,
      updatedAt: new Date(),
    })
    .where(eq(studentsTable.id, params.data.id))
    .returning();

  if (!student) {
    res.status(404).json({ error: "Student not found" });
    return;
  }

  res.json(UpdateStudentResponse.parse(serializeStudent(student)));
});

// ── GET /api/students/:id/progress ───────────────────────────────────────────
// Layer 1: admin + teacher only (requireRole).
// Layer 3: teachers may only view progress for their own students.
router.get(
  "/students/:id/progress",
  requireRole("admin", "teacher"),
  async (req, res): Promise<void> => {
    const scope = buildScopeContext(req.session as ClassmateSession);
    const params = GetStudentProgressParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const studentId = params.data.id;
    const [student] = await db
      .select()
      .from(studentsTable)
      .where(eq(studentsTable.id, studentId));

    if (!student || student.deletedAt !== null) {
      res.status(404).json({ error: "Student not found" });
      return;
    }

    const denied = await applyLayer3Guard(scope, studentId, res);
    if (denied) return;

    const [assignments, assessments] = await Promise.all([
      db.select().from(assignmentsTable).where(eq(assignmentsTable.studentId, studentId)),
      db.select().from(assessmentsTable).where(eq(assessmentsTable.studentId, studentId)),
    ]);

    const completed = assignments.filter(
      (a) => a.status === "graded" || a.status === "submitted",
    ).length;
    const gradedAssignments = assignments.filter(
      (a) => a.status === "graded" && a.score != null,
    );
    const avgScore =
      gradedAssignments.length > 0
        ? gradedAssignments.reduce(
            (sum, a) => sum + ((a.score ?? 0) / a.maxScore) * 100,
            0,
          ) / gradedAssignments.length
        : 0;

    const topicsMastered: string[] = [];
    const topicsNeedingWork: string[] = [];
    for (const assessment of assessments) {
      topicsMastered.push(...(assessment.strengths as string[]));
      topicsNeedingWork.push(...(assessment.weaknesses as string[]));
    }

    res.json(
      GetStudentProgressResponse.parse({
        studentId,
        totalAssignments: assignments.length,
        completedAssignments: completed,
        averageScore: Math.round(avgScore * 10) / 10,
        completionRate:
          assignments.length > 0
            ? Math.round((completed / assignments.length) * 100) / 100
            : 0,
        topicsMastered: [...new Set(topicsMastered)].slice(0, 5),
        topicsNeedingWork: [...new Set(topicsNeedingWork)].slice(0, 5),
      }),
    );
  },
);

// ── DELETE /api/students/:id — soft delete ────────────────────────────────────
// Layer 1: admin + teacher only (requireRole).
// Layer 3: teachers may only delete their own students.
router.delete(
  "/students/:id",
  requireRole("admin", "teacher"),
  async (req, res): Promise<void> => {
    const scope = buildScopeContext(req.session as ClassmateSession);

    const params = GetStudentParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const [existing] = await db
      .select({ id: studentsTable.id, deletedAt: studentsTable.deletedAt })
      .from(studentsTable)
      .where(eq(studentsTable.id, params.data.id));

    if (!existing || existing.deletedAt !== null) {
      res.status(404).json({ error: "Student not found" });
      return;
    }

    const denied = await applyLayer3Guard(scope, params.data.id, res);
    if (denied) return;

    await db
      .update(studentsTable)
      .set({ deletedAt: new Date(), deletedBy: scope.userId })
      .where(eq(studentsTable.id, params.data.id));

    res.status(204).send();
  },
);

export default router;
