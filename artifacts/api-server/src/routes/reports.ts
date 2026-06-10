import { Router, type IRouter } from "express";
import { and, eq, isNull, inArray } from "drizzle-orm";
import {
  db,
  studentsTable,
  coursesTable,
  assignmentsTable,
  assessmentsTable,
  courseEnrollmentsTable,
} from "@workspace/db";
import {
  GetStudentReportSummaryQueryParams,
  GetStudentReportSummaryResponse,
  GetCourseReportSummaryQueryParams,
  GetCourseReportSummaryResponse,
} from "@workspace/api-zod";
import { requireRole } from "../middleware/require-role";
import { buildScopeContext, type ClassmateSession } from "../lib/scope-context";
import { studentPolicy } from "../lib/policies/student-scope-policy";
import { coursePolicy } from "../shared/auth/policies/course-scope-policy";
import { PolicyAuthorizationError } from "../lib/policies";
import { computeRiskLevel, computeTrend } from "../services/progress-analytics.service";
import type { Response } from "express";

const router: IRouter = Router();

// ── Layer 3 guard helpers ─────────────────────────────────────────────────────
// Authorization decisions live in the policy classes. These helpers apply the
// policy result to the response and signal the caller to abort.

/**
 * Applies student Layer 3 ownership guard.
 * Returns true if access is denied (caller must return early).
 */
async function applyStudentLayer3Guard(
  scope: ReturnType<typeof buildScopeContext>,
  studentId: number,
  res: Response,
): Promise<boolean> {
  const rows = await db
    .select({ courseId: courseEnrollmentsTable.courseId })
    .from(courseEnrollmentsTable)
    .where(
      and(
        eq(courseEnrollmentsTable.studentId, studentId),
        eq(courseEnrollmentsTable.isActive, true),
      ),
    );
  const enrolledCourseIds = rows.map((r) => r.courseId);
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

/**
 * Applies course Layer 3 ownership guard (synchronous — policy is pure).
 * Returns true if access is denied (caller must return early).
 */
function applyCourseLayer3Guard(
  scope: ReturnType<typeof buildScopeContext>,
  courseId: number,
  res: Response,
): boolean {
  try {
    coursePolicy.validateAccess(scope, { id: courseId });
    return false;
  } catch (err) {
    if (err instanceof PolicyAuthorizationError) {
      res.status(403).json({ error: "Access denied" });
      return true;
    }
    throw err;
  }
}

// ── GET /api/reports/student-summary ─────────────────────────────────────────
//
// Layer 1: admin + teacher only (requireRole).
// Layer 3: teacher may only access students enrolled in their own courses.
// No Layer 2 filter needed — Layer 3 covers the per-record check.
//
// Reuses computeRiskLevel + computeTrend from ProgressAnalyticsService.
// No analytics logic duplicated in this handler.
router.get(
  "/reports/student-summary",
  requireRole("admin", "teacher"),
  async (req, res): Promise<void> => {
    const scope = buildScopeContext(req.session as ClassmateSession);

    const query = GetStudentReportSummaryQueryParams.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: "studentId must be a positive integer" });
      return;
    }
    const { studentId } = query.data;

    const [student] = await db
      .select()
      .from(studentsTable)
      .where(and(eq(studentsTable.id, studentId), isNull(studentsTable.deletedAt)));

    if (!student) {
      res.status(404).json({ error: "Student not found" });
      return;
    }

    const denied = await applyStudentLayer3Guard(scope, studentId, res);
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

    const gradedAssignments = assignments.filter(
      (a) => a.status === "graded" && a.score !== null,
    );
    const completed = assignments.filter(
      (a) => a.status === "graded" || a.status === "submitted",
    ).length;
    const avgScore =
      gradedAssignments.length > 0
        ? gradedAssignments.reduce(
            (sum, a) => sum + ((a.score ?? 0) / a.maxScore) * 100,
            0,
          ) / gradedAssignments.length
        : 0;

    // Build chronological scored-event list for risk + trend — same anchor
    // timestamps as /students/:id/progress (assignments: updatedAt, assessments: createdAt).
    const scoredEvents = [
      ...gradedAssignments.map((a) => ({
        ts: a.updatedAt.getTime(),
        pct: ((a.score ?? 0) / a.maxScore) * 100,
      })),
      ...assessments.map((a) => ({
        ts: a.createdAt.getTime(),
        pct: (a.score / a.maxScore) * 100,
      })),
    ].sort((a, b) => a.ts - b.ts);

    const chronologicalScores = scoredEvents.map((e) => e.pct);
    const riskLevel = computeRiskLevel(chronologicalScores);
    const trend = computeTrend(chronologicalScores);

    const topicsMastered = [
      ...new Set(assessments.flatMap((a) => a.strengths as string[])),
    ].slice(0, 5);
    const topicsNeedingWork = [
      ...new Set(assessments.flatMap((a) => a.weaknesses as string[])),
    ].slice(0, 5);

    res.json(
      GetStudentReportSummaryResponse.parse({
        studentId,
        studentName: student.name,
        grade: student.grade,
        averageScore: Math.round(avgScore * 10) / 10,
        completionRate:
          assignments.length > 0
            ? Math.round((completed / assignments.length) * 100) / 100
            : 0,
        totalAssignments: assignments.length,
        completedAssignments: completed,
        totalAssessments: assessments.length,
        riskLevel,
        trend,
        topicsMastered,
        topicsNeedingWork,
        generatedAt: new Date().toISOString(),
      }),
    );
  },
);

// ── GET /api/reports/course-summary ──────────────────────────────────────────
//
// Layer 1: admin + teacher only (requireRole).
// Layer 3: teacher may only access courses they own.
//
// Reuses computeRiskLevel + computeTrend per student.
// Aggregates into riskDistribution, topPerformers, and a per-student rows table.
router.get(
  "/reports/course-summary",
  requireRole("admin", "teacher"),
  async (req, res): Promise<void> => {
    const scope = buildScopeContext(req.session as ClassmateSession);

    const query = GetCourseReportSummaryQueryParams.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: "courseId must be a positive integer" });
      return;
    }
    const { courseId } = query.data;

    const [course] = await db
      .select()
      .from(coursesTable)
      .where(and(eq(coursesTable.id, courseId), isNull(coursesTable.deletedAt)));

    if (!course) {
      res.status(404).json({ error: "Course not found" });
      return;
    }

    // Layer 3: teacher must own this course.
    const denied = applyCourseLayer3Guard(scope, courseId, res);
    if (denied) return;

    // Fetch enrolled students for this course.
    const enrollmentRows = await db
      .select({ studentId: courseEnrollmentsTable.studentId })
      .from(courseEnrollmentsTable)
      .where(
        and(
          eq(courseEnrollmentsTable.courseId, courseId),
          eq(courseEnrollmentsTable.isActive, true),
        ),
      );
    const studentIds = enrollmentRows.map((r) => r.studentId);

    const [students, assignments, assessments] = await Promise.all([
      studentIds.length > 0
        ? db
            .select()
            .from(studentsTable)
            .where(
              and(isNull(studentsTable.deletedAt), inArray(studentsTable.id, studentIds)),
            )
        : Promise.resolve([]),
      db
        .select()
        .from(assignmentsTable)
        .where(
          and(eq(assignmentsTable.courseId, courseId), isNull(assignmentsTable.deletedAt)),
        ),
      db
        .select()
        .from(assessmentsTable)
        .where(
          and(eq(assessmentsTable.courseId, courseId), isNull(assessmentsTable.deletedAt)),
        ),
    ]);

    // Compute per-student analytics — reusing ProgressAnalyticsService functions.
    const studentRows = students.map((s) => {
      const sa = assignments.filter((a) => a.studentId === s.id);
      const se = assessments.filter((a) => a.studentId === s.id);

      const graded = sa.filter((a) => a.status === "graded" && a.score !== null);
      const completedCount = sa.filter(
        (a) => a.status === "graded" || a.status === "submitted",
      ).length;
      const avg =
        graded.length > 0
          ? graded.reduce((sum, a) => sum + ((a.score ?? 0) / a.maxScore) * 100, 0) /
            graded.length
          : 0;

      const scoredEvents = [
        ...graded.map((a) => ({
          ts: a.updatedAt.getTime(),
          pct: ((a.score ?? 0) / a.maxScore) * 100,
        })),
        ...se.map((a) => ({
          ts: a.createdAt.getTime(),
          pct: (a.score / a.maxScore) * 100,
        })),
      ].sort((a, b) => a.ts - b.ts);

      const chronologicalScores = scoredEvents.map((e) => e.pct);

      return {
        id: s.id,
        name: s.name,
        averageScore: Math.round(avg * 10) / 10,
        completionRate:
          sa.length > 0 ? Math.round((completedCount / sa.length) * 100) / 100 : 0,
        riskLevel: computeRiskLevel(chronologicalScores),
        trend: computeTrend(chronologicalScores),
      };
    });

    // Aggregate course-level stats.
    const riskDistribution = {
      low: studentRows.filter((s) => s.riskLevel === "LOW").length,
      medium: studentRows.filter((s) => s.riskLevel === "MEDIUM").length,
      high: studentRows.filter((s) => s.riskLevel === "HIGH").length,
      insufficientData: studentRows.filter((s) => s.riskLevel === "INSUFFICIENT_DATA")
        .length,
    };

    const scoredStudents = studentRows.filter((s) => s.averageScore > 0);
    const courseAvg =
      scoredStudents.length > 0
        ? scoredStudents.reduce((sum, s) => sum + s.averageScore, 0) / scoredStudents.length
        : 0;

    const allCompleted = assignments.filter(
      (a) => a.status === "graded" || a.status === "submitted",
    ).length;
    const completionRate =
      assignments.length > 0 ? allCompleted / assignments.length : 0;

    const topPerformers = studentRows
      .filter((s) => s.averageScore >= 80)
      .sort((a, b) => b.averageScore - a.averageScore)
      .slice(0, 5)
      .map((s) => ({ id: s.id, name: s.name, averageScore: s.averageScore }));

    res.json(
      GetCourseReportSummaryResponse.parse({
        courseId,
        courseName: course.name,
        teacherName: course.teacherName,
        totalStudents: students.length,
        averageScore: Math.round(courseAvg * 10) / 10,
        completionRate: Math.round(completionRate * 100) / 100,
        riskDistribution,
        topPerformers,
        students: studentRows,
        generatedAt: new Date().toISOString(),
      }),
    );
  },
);

export default router;
