import { Router, type IRouter } from "express";
import { eq, and, isNull } from "drizzle-orm";
import {
  db,
  studentsTable,
  studentGuardiansTable,
  assignmentsTable,
  assessmentsTable,
} from "@workspace/db";
import { buildScopeContext, type ClassmateSession } from "../lib/scope-context";
import { requireRole } from "../middleware/require-role";
import { parentScopePolicy } from "../lib/policies/parent-scope-policy";
import { PolicyAuthorizationError } from "../lib/policies/resource-scope-policy";
import { computeRiskLevel, computeTrend } from "../services/progress-analytics.service";
import {
  ListParentStudentsResponse,
  GetParentStudentProgressParams,
  GetParentStudentProgressResponse,
  ListParentStudentAssignmentsParams,
  ListParentStudentAssignmentsResponse,
  ListParentStudentAssessmentsParams,
  ListParentStudentAssessmentsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

/**
 * Validates that the authenticated parent is a guardian of the given student.
 * Returns `true` if access was denied (caller must return early).
 * Maps denials to 404 (IDOR-safe — parent must not learn whether a student
 * exists at all if they are not linked to them).
 */
async function applyParentGuard(
  scope: ReturnType<typeof buildScopeContext>,
  studentId: number,
  res: import("express").Response,
): Promise<boolean> {
  const [student] = await db
    .select({ id: studentsTable.id })
    .from(studentsTable)
    .where(and(eq(studentsTable.id, studentId), isNull(studentsTable.deletedAt)))
    .limit(1);

  if (!student) {
    res.status(404).json({ error: "Student not found" });
    return true;
  }

  try {
    parentScopePolicy.validateAccess(scope, { id: studentId });
    return false;
  } catch (err) {
    if (err instanceof PolicyAuthorizationError) {
      res.status(404).json({ error: "Student not found" });
      return true;
    }
    throw err;
  }
}

/**
 * GET /parent/students
 *
 * Returns all students linked to the authenticated parent through student_guardians.
 *
 * Layer 1: requireRole("parent") — all other roles receive 403.
 * Layer 2: session.childStudentIds pre-computed at login — no per-request JOIN.
 * Layer 3: N/A — list is already scoped to the parent's own children.
 */
router.get("/parent/students", requireRole("parent"), async (req, res): Promise<void> => {
  const scope = buildScopeContext(req.session as ClassmateSession);

  if (scope.childStudentIds.length === 0) {
    res.json(ListParentStudentsResponse.parse({ items: [] }));
    return;
  }

  const guardianRows = await db
    .select({
      studentId: studentGuardiansTable.studentId,
      relationship: studentGuardiansTable.relationship,
    })
    .from(studentGuardiansTable)
    .where(eq(studentGuardiansTable.userId, scope.userId));

  const relationshipMap = new Map(guardianRows.map((r) => [r.studentId, r.relationship]));

  const students = await db
    .select({ id: studentsTable.id, name: studentsTable.name, grade: studentsTable.grade })
    .from(studentsTable)
    .where(
      and(
        parentScopePolicy.getScopeCondition(scope),
        isNull(studentsTable.deletedAt),
      ),
    );

  const items = students.map((s) => ({
    id: s.id,
    name: s.name,
    grade: s.grade,
    relationship: relationshipMap.get(s.id) ?? "guardian",
  }));

  res.json(ListParentStudentsResponse.parse({ items }));
});

/**
 * GET /parent/students/:studentId/progress
 *
 * Returns the progress summary for a linked student.
 *
 * Layer 1: requireRole("parent").
 * Layer 2: applyParentGuard validates childStudentIds membership.
 * Layer 3: IDOR-safe — denied students return 404.
 */
router.get(
  "/parent/students/:studentId/progress",
  requireRole("parent"),
  async (req, res): Promise<void> => {
    const scope = buildScopeContext(req.session as ClassmateSession);
    const params = GetParentStudentProgressParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid student ID" });
      return;
    }

    const studentId = params.data.studentId;
    const denied = await applyParentGuard(scope, studentId, res);
    if (denied) return;

    const [assignments, assessments] = await Promise.all([
      db
        .select()
        .from(assignmentsTable)
        .where(and(eq(assignmentsTable.studentId, studentId), isNull(assignmentsTable.deletedAt))),
      db
        .select()
        .from(assessmentsTable)
        .where(and(eq(assessmentsTable.studentId, studentId), isNull(assessmentsTable.deletedAt))),
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

    const scoredEvents = [
      ...gradedAssignments.map((a) => ({
        timestamp: a.updatedAt,
        scorePercent: ((a.score ?? 0) / a.maxScore) * 100,
      })),
      ...assessments.map((a) => ({
        timestamp: a.createdAt,
        scorePercent: (a.score / a.maxScore) * 100,
      })),
    ].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    const chronologicalScores = scoredEvents.map((e) => e.scorePercent);

    res.json(
      GetParentStudentProgressResponse.parse({
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
        riskLevel: computeRiskLevel(chronologicalScores),
        trend: computeTrend(chronologicalScores),
      }),
    );
  },
);

/**
 * GET /parent/students/:studentId/assignments
 *
 * Returns assignments for a linked student, read-only.
 *
 * Layer 1: requireRole("parent").
 * Layer 3: applyParentGuard validates childStudentIds membership.
 */
router.get(
  "/parent/students/:studentId/assignments",
  requireRole("parent"),
  async (req, res): Promise<void> => {
    const scope = buildScopeContext(req.session as ClassmateSession);
    const params = ListParentStudentAssignmentsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid student ID" });
      return;
    }

    const studentId = params.data.studentId;
    const denied = await applyParentGuard(scope, studentId, res);
    if (denied) return;

    const rows = await db
      .select({
        id: assignmentsTable.id,
        courseId: assignmentsTable.courseId,
        title: assignmentsTable.title,
        status: assignmentsTable.status,
        dueDate: assignmentsTable.dueDate,
        score: assignmentsTable.score,
        maxScore: assignmentsTable.maxScore,
      })
      .from(assignmentsTable)
      .where(and(eq(assignmentsTable.studentId, studentId), isNull(assignmentsTable.deletedAt)));

    const items = rows.map((r) => ({
      assignmentId: r.id,
      courseId: r.courseId,
      title: r.title,
      status: r.status,
      dueDate: String(r.dueDate),
      score: r.score ?? null,
      maxScore: r.maxScore,
    }));

    res.json(ListParentStudentAssignmentsResponse.parse({ items }));
  },
);

/**
 * GET /parent/students/:studentId/assessments
 *
 * Returns assessments for a linked student, read-only.
 *
 * Layer 1: requireRole("parent").
 * Layer 3: applyParentGuard validates childStudentIds membership.
 */
router.get(
  "/parent/students/:studentId/assessments",
  requireRole("parent"),
  async (req, res): Promise<void> => {
    const scope = buildScopeContext(req.session as ClassmateSession);
    const params = ListParentStudentAssessmentsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid student ID" });
      return;
    }

    const studentId = params.data.studentId;
    const denied = await applyParentGuard(scope, studentId, res);
    if (denied) return;

    const rows = await db
      .select({
        id: assessmentsTable.id,
        courseId: assessmentsTable.courseId,
        title: assessmentsTable.title,
        score: assessmentsTable.score,
        maxScore: assessmentsTable.maxScore,
      })
      .from(assessmentsTable)
      .where(
        and(eq(assessmentsTable.studentId, studentId), isNull(assessmentsTable.deletedAt)),
      );

    const items = rows.map((r) => ({
      assessmentId: r.id,
      courseId: r.courseId,
      title: r.title,
      score: r.score,
      maxScore: r.maxScore,
    }));

    res.json(ListParentStudentAssessmentsResponse.parse({ items }));
  },
);

export default router;
