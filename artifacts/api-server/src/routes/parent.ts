import { Router, type IRouter } from "express";
import { eq, and, isNull, inArray } from "drizzle-orm";
import {
  db,
  studentsTable,
  studentGuardiansTable,
  assignmentsTable,
  assessmentsTable,
} from "@workspace/db";
import { buildScopeContext, type ClassmateSession } from "../lib/scope-context";
import { requireRole } from "../middleware/require-role";
import { requireActiveAccount } from "../middleware/require-active-account";
import { computeRiskLevel, computeTrend } from "../services/progress-analytics.service";
import {
  GetParentDashboardResponse,
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
 *
 * Re-validates the guardian link against the DB on every request so that a
 * removed guardian link or a soft-deleted student is rejected immediately,
 * even within an active parent session whose childStudentIds may be stale.
 */
async function applyParentGuard(
  scope: ReturnType<typeof buildScopeContext>,
  studentId: number,
  res: import("express").Response,
): Promise<boolean> {
  // Run both checks in parallel — student existence and live guardian link.
  const [studentRows, guardianRows] = await Promise.all([
    db
      .select({ id: studentsTable.id })
      .from(studentsTable)
      .where(and(eq(studentsTable.id, studentId), isNull(studentsTable.deletedAt)))
      .limit(1),
    db
      .select({ studentId: studentGuardiansTable.studentId })
      .from(studentGuardiansTable)
      .where(
        and(
          eq(studentGuardiansTable.userId, scope.userId),
          eq(studentGuardiansTable.studentId, studentId),
        ),
      )
      .limit(1),
  ]);

  // Both conditions must hold: student is active AND guardian link still exists.
  if (studentRows.length === 0 || guardianRows.length === 0) {
    res.status(404).json({ error: "Student not found" });
    return true;
  }

  return false;
}

/**
 * GET /parent/dashboard
 *
 * Returns an analytics summary card for every student linked to the parent.
 *
 * Guardian links are re-validated on each request against the live
 * student_guardians table so that a removed link or soft-deleted student
 * is excluded immediately, even within an active parent session.
 *
 * Layer 1: requireRole("parent").
 * Layer 2: live guardian query replaces cached childStudentIds for the
 *          student filter and all downstream inArray() restrictions.
 */
router.get("/parent/dashboard", requireRole("parent"), requireActiveAccount, async (req, res): Promise<void> => {
  const scope = buildScopeContext(req.session as ClassmateSession);

  // Fetch live guardian rows — do not trust cached session childStudentIds.
  const guardianRows = await db
    .select({
      studentId: studentGuardiansTable.studentId,
      relationship: studentGuardiansTable.relationship,
    })
    .from(studentGuardiansTable)
    .where(eq(studentGuardiansTable.userId, scope.userId));

  const liveChildStudentIds = guardianRows.map((r) => r.studentId);

  if (liveChildStudentIds.length === 0) {
    res.json(GetParentDashboardResponse.parse({ items: [] }));
    return;
  }

  const [students, allAssignments, allAssessments] = await Promise.all([
    db
      .select({ id: studentsTable.id, name: studentsTable.name, grade: studentsTable.grade })
      .from(studentsTable)
      .where(and(inArray(studentsTable.id, liveChildStudentIds), isNull(studentsTable.deletedAt))),
    db
      .select({
        studentId: assignmentsTable.studentId,
        status: assignmentsTable.status,
        score: assignmentsTable.score,
        maxScore: assignmentsTable.maxScore,
        updatedAt: assignmentsTable.updatedAt,
      })
      .from(assignmentsTable)
      .where(
        and(
          inArray(assignmentsTable.studentId, liveChildStudentIds),
          isNull(assignmentsTable.deletedAt),
        ),
      ),
    db
      .select({
        studentId: assessmentsTable.studentId,
        score: assessmentsTable.score,
        maxScore: assessmentsTable.maxScore,
        createdAt: assessmentsTable.createdAt,
      })
      .from(assessmentsTable)
      .where(
        and(
          inArray(assessmentsTable.studentId, liveChildStudentIds),
          isNull(assessmentsTable.deletedAt),
        ),
      ),
  ]);

  const relationshipMap = new Map(guardianRows.map((r) => [r.studentId, r.relationship]));

  // Group assignments and assessments by studentId (single pass each)
  type AssignmentRow = (typeof allAssignments)[number];
  type AssessmentRow = (typeof allAssessments)[number];
  const assignmentsByStudent = new Map<number, AssignmentRow[]>();
  const assessmentsByStudent = new Map<number, AssessmentRow[]>();
  for (const a of allAssignments) {
    const list = assignmentsByStudent.get(a.studentId) ?? [];
    list.push(a);
    assignmentsByStudent.set(a.studentId, list);
  }
  for (const a of allAssessments) {
    const list = assessmentsByStudent.get(a.studentId) ?? [];
    list.push(a);
    assessmentsByStudent.set(a.studentId, list);
  }

  const items = students.map((student) => {
    const assignments = assignmentsByStudent.get(student.id) ?? [];
    const assessments = assessmentsByStudent.get(student.id) ?? [];

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

    const pendingAssignments = assignments.filter(
      (a) => a.status === "pending" || a.status === "overdue",
    ).length;

    return {
      id: student.id,
      name: student.name,
      grade: student.grade,
      relationship: relationshipMap.get(student.id) ?? "guardian",
      averageScore: Math.round(avgScore * 10) / 10,
      completionRate:
        assignments.length > 0
          ? Math.round((completed / assignments.length) * 100) / 100
          : 0,
      riskLevel: computeRiskLevel(scoredEvents.map((e) => e.scorePercent)),
      trend: computeTrend(scoredEvents.map((e) => e.scorePercent)),
      pendingAssignments,
    };
  });

  const RISK_ORDER: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2, INSUFFICIENT_DATA: 3 };
  items.sort((a, b) => {
    const riskDiff = (RISK_ORDER[a.riskLevel] ?? 3) - (RISK_ORDER[b.riskLevel] ?? 3);
    if (riskDiff !== 0) return riskDiff;
    return a.name.localeCompare(b.name);
  });

  res.json(GetParentDashboardResponse.parse({ items }));
});

/**
 * GET /parent/students
 *
 * Returns all students linked to the authenticated parent through student_guardians.
 *
 * Guardian links are re-validated on each request against the live
 * student_guardians table so that a removed link or soft-deleted student
 * is excluded immediately, even within an active parent session.
 *
 * Layer 1: requireRole("parent") — all other roles receive 403.
 * Layer 2: live guardian query replaces cached childStudentIds.
 * Layer 3: N/A — list is already scoped to the parent's own live children.
 */
router.get("/parent/students", requireRole("parent"), requireActiveAccount, async (req, res): Promise<void> => {
  const scope = buildScopeContext(req.session as ClassmateSession);

  // Fetch live guardian rows — do not trust cached session childStudentIds.
  const guardianRows = await db
    .select({
      studentId: studentGuardiansTable.studentId,
      relationship: studentGuardiansTable.relationship,
    })
    .from(studentGuardiansTable)
    .where(eq(studentGuardiansTable.userId, scope.userId));

  const liveChildStudentIds = guardianRows.map((r) => r.studentId);

  if (liveChildStudentIds.length === 0) {
    res.json(ListParentStudentsResponse.parse({ items: [] }));
    return;
  }

  const relationshipMap = new Map(guardianRows.map((r) => [r.studentId, r.relationship]));

  const students = await db
    .select({ id: studentsTable.id, name: studentsTable.name, grade: studentsTable.grade })
    .from(studentsTable)
    .where(
      and(
        inArray(studentsTable.id, liveChildStudentIds),
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
  requireActiveAccount,
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
  requireActiveAccount,
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
  requireActiveAccount,
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
