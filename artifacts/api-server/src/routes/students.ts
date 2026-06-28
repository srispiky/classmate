import { Router, type IRouter, type Response } from "express";
import { eq, isNull, and } from "drizzle-orm";
import { db, studentsTable, courseEnrollmentsTable, assignmentsTable, assessmentsTable, coursesTable } from "@workspace/db";
import {
  CreateStudentBody,
  GetStudentParams,
  GetStudentResponse,
  UpdateStudentParams,
  UpdateStudentBody,
  UpdateStudentResponse,
  ListStudentsQueryParams,
  ListStudentsResponse,
  GetStudentProgressParams,
  GetStudentProgressResponse,
  GetStudentProgressTimelineParams,
  GetStudentProgressTimelineResponse,
} from "@workspace/api-zod";
import { buildScopeContext, type ClassmateSession } from "../lib/scope-context";
import { requireRole } from "../middleware/require-role";
import { studentPolicy } from "../lib/policies/student-scope-policy";
import { PolicyAuthorizationError } from "../lib/policies/resource-scope-policy";
import { computeRiskLevel, computeTrend, buildTimeline } from "../services/progress-analytics.service";
import { listStudents } from "../lib/students.queries";

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
// Pagination: cursor-based, (name ASC, id ASC). Returns paginated envelope.
router.get("/students", requireRole("admin", "teacher"), async (req, res): Promise<void> => {
  const queryParams = ListStudentsQueryParams.safeParse(req.query);
  if (!queryParams.success) {
    res.status(400).json({ error: queryParams.error.message });
    return;
  }

  const scope = buildScopeContext(req.session as ClassmateSession);
  const scopeCondition = studentPolicy.getScopeCondition(scope);

  const result = await listStudents({
    limit: queryParams.data.limit,
    cursor: queryParams.data.cursor,
    scopeCondition,
  });

  res.json(
    ListStudentsResponse.parse({
      items: result.items.map((s) => ({
        id: s.id,
        name: s.name,
        email: s.email,
        grade: s.grade,
        avatarUrl: s.avatarUrl ?? null,
        enrolledCourseIds: s.enrolledCourseIds,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
        createdBy: s.createdBy ?? null,
        updatedBy: s.updatedBy ?? null,
      })),
      pagination: result.pagination,
    }),
  );
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

  let student: typeof studentsTable.$inferSelect | undefined;
  try {
    [student] = await db
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
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "23505") {
      res.status(409).json({ error: "A student with that email already exists." });
      return;
    }
    throw err;
  }

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

    // Build chronological scored-event list for risk + trend computation.
    // Assignments: use updatedAt (grading date) as the timeline anchor.
    // Assessments: use createdAt.
    type ScoredEvent = { timestamp: Date; scorePercent: number };
    const scoredEvents: ScoredEvent[] = [
      ...gradedAssignments.map((a) => ({
        timestamp: a.updatedAt,
        scorePercent: ((a.score ?? 0) / a.maxScore) * 100,
      })),
      ...assessments
        .filter((a) => a.deletedAt === null)
        .map((a) => ({
          timestamp: a.createdAt,
          scorePercent: (a.score / a.maxScore) * 100,
        })),
    ].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    const chronologicalScores = scoredEvents.map((e) => e.scorePercent);
    const riskLevel = computeRiskLevel(chronologicalScores);
    const trend = computeTrend(chronologicalScores);

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
        riskLevel,
        trend,
      }),
    );
  },
);

// ── GET /api/students/:id/progress/timeline ───────────────────────────────────
// Layer 1: admin + teacher only (requireRole).
// Layer 3: teachers may only view timeline for their own students.
router.get(
  "/students/:id/progress/timeline",
  requireRole("admin", "teacher"),
  async (req, res): Promise<void> => {
    const scope = buildScopeContext(req.session as ClassmateSession);
    const params = GetStudentProgressTimelineParams.safeParse(req.params);
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

    const [assignmentRows, assessmentRows] = await Promise.all([
      db
        .select({
          updatedAt: assignmentsTable.updatedAt,
          title: assignmentsTable.title,
          score: assignmentsTable.score,
          maxScore: assignmentsTable.maxScore,
          status: assignmentsTable.status,
          courseId: assignmentsTable.courseId,
          courseName: coursesTable.name,
          deletedAt: assignmentsTable.deletedAt,
        })
        .from(assignmentsTable)
        .leftJoin(coursesTable, eq(assignmentsTable.courseId, coursesTable.id))
        .where(eq(assignmentsTable.studentId, studentId)),
      db
        .select({
          createdAt: assessmentsTable.createdAt,
          title: assessmentsTable.title,
          score: assessmentsTable.score,
          maxScore: assessmentsTable.maxScore,
          courseId: assessmentsTable.courseId,
          courseName: coursesTable.name,
          deletedAt: assessmentsTable.deletedAt,
        })
        .from(assessmentsTable)
        .leftJoin(coursesTable, eq(assessmentsTable.courseId, coursesTable.id))
        .where(eq(assessmentsTable.studentId, studentId)),
    ]);

    const events = buildTimeline(assignmentRows, assessmentRows);

    res.json(
      GetStudentProgressTimelineResponse.parse({
        studentId,
        events,
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
