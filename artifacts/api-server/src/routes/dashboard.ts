import { Router, type IRouter } from "express";
import { and, desc, isNull } from "drizzle-orm";
import {
  db,
  studentsTable,
  assignmentsTable,
  assessmentsTable,
  activityTable,
} from "@workspace/db";
import {
  GetDashboardSummaryResponse,
  GetRecentActivityResponse,
  GetGradeBreakdownResponse,
  GetDashboardStudentHealthResponse,
} from "@workspace/api-zod";
import { requireRole } from "../middleware/require-role";
import { buildScopeContext, type ClassmateSession } from "../lib/scope-context";
import {
  buildDashboardCourseFilter,
  buildDashboardStudentFilter,
  buildDashboardAssignmentFilter,
  buildDashboardAssessmentFilter,
  buildDashboardActivityFilter,
} from "../lib/dashboard.queries";
import {
  getDashboardSummaryCounts,
  getGradeBreakdownData,
} from "../lib/teacher-dashboard.queries";
import { classifyStudentCohorts } from "../services/progress-analytics.service";

const router: IRouter = Router();

// ── GET /api/dashboard/summary ────────────────────────────────────────────────

// Layer 1: dashboard data restricted to admin and teacher.
// Layer 2: teachers see only their own courses / enrolled students / owned assignments+assessments.
//
// Performance (Chunk 5):
//   Before: 4 × SELECT * → full-table loads → all aggregation in Node.js
//   After:  4 × SQL aggregate queries (parallel) → only scalar/grouped results returned
router.get(
  "/dashboard/summary",
  requireRole("admin", "teacher"),
  async (req, res): Promise<void> => {
    const scope = buildScopeContext(req.session as ClassmateSession);

    const courseFilter = buildDashboardCourseFilter(scope);
    const studentFilter = buildDashboardStudentFilter(scope);
    const assignmentFilter = buildDashboardAssignmentFilter(scope);
    const assessmentFilter = buildDashboardAssessmentFilter(scope);

    const { counts, studentScores } = await getDashboardSummaryCounts(
      studentFilter,
      courseFilter,
      assignmentFilter,
      assessmentFilter,
    );

    // Compute atRisk and topPerformers in JS — only over the pre-aggregated per-student rows
    // returned by getDashboardSummaryCounts (1 row per student, not 1 row per assessment).
    let atRisk = 0;
    const topPerformers: Array<{ id: number; name: string; averageScore: number }> = [];

    for (const s of studentScores) {
      if (s.avgPct < 60) atRisk++;
      if (s.avgPct >= 80) {
        topPerformers.push({
          id: s.studentId,
          name: s.studentName,
          averageScore: Math.round(s.avgPct),
        });
      }
    }
    topPerformers.sort((a, b) => b.averageScore - a.averageScore);

    const completionRate =
      counts.totalAssignments > 0
        ? counts.completedAssignments / counts.totalAssignments
        : 0;

    const summary = {
      totalStudents: counts.totalStudents,
      totalCourses: counts.totalCourses,
      totalAssignments: counts.totalAssignments,
      pendingAssignments: counts.pendingAssignments,
      averageClassScore: Math.round((counts.avgAssignmentScore ?? 0) * 10) / 10,
      completionRate: Math.round(completionRate * 100) / 100,
      atRiskStudents: atRisk,
      topPerformers: topPerformers.slice(0, 5),
    };

    res.json(GetDashboardSummaryResponse.parse(summary));
  },
);

// ── GET /api/dashboard/recent-activity ───────────────────────────────────────

// Layer 1: restricted to admin and teacher.
// Layer 2: teachers see only activity from their owned courses.
// Already uses ORDER BY + LIMIT — no change needed.
router.get(
  "/dashboard/recent-activity",
  requireRole("admin", "teacher"),
  async (req, res): Promise<void> => {
    const scope = buildScopeContext(req.session as ClassmateSession);
    const activityFilter = buildDashboardActivityFilter(scope);

    const activities = await db
      .select()
      .from(activityTable)
      .where(activityFilter)
      .orderBy(desc(activityTable.timestamp))
      .limit(20);

    res.json(
      GetRecentActivityResponse.parse(
        activities.map((a) => ({
          ...a,
          timestamp: a.timestamp.toISOString(),
        })),
      ),
    );
  },
);

// ── GET /api/dashboard/grade-breakdown ───────────────────────────────────────

// Layer 1: restricted to admin and teacher.
// Layer 2: teachers see only courses they own and assessments from those courses.
//
// Performance (Chunk 5):
//   Before: SELECT * courses + SELECT * assessments → JS per-course bucketing
//   After:  SELECT id,name courses + GROUP BY course_id aggregate (both parallel)
router.get(
  "/dashboard/grade-breakdown",
  requireRole("admin", "teacher"),
  async (req, res): Promise<void> => {
    const scope = buildScopeContext(req.session as ClassmateSession);
    const courseFilter = buildDashboardCourseFilter(scope);
    const assessmentFilter = buildDashboardAssessmentFilter(scope);

    const { courses, assessmentStats } = await getGradeBreakdownData(
      courseFilter,
      assessmentFilter,
    );

    // Build a lookup map from the SQL GROUP BY results (1 row per course).
    const statsMap = new Map(assessmentStats.map((s) => [s.courseId, s]));

    const breakdown = courses.map((course) => {
      const stats = statsMap.get(course.id);
      return {
        courseName: course.name,
        courseId: course.id,
        averageScore: Math.round((stats?.avgPct ?? 0) * 10) / 10,
        aCount: stats?.aCount ?? 0,
        bCount: stats?.bCount ?? 0,
        cCount: stats?.cCount ?? 0,
        dCount: stats?.dCount ?? 0,
        fCount: stats?.fCount ?? 0,
      };
    });

    res.json(GetGradeBreakdownResponse.parse(breakdown));
  },
);

// ── GET /api/dashboard/student-health ────────────────────────────────────────

// Layer 1: restricted to admin and teacher.
// Layer 2: teachers see only students enrolled in their own courses.
//
// Performance (Chunk 5):
//   Before: SELECT * (all columns including JSON strengths/weaknesses) for all 3 tables
//   After:  Minimal column selection — only the columns actually consumed by the handler
router.get(
  "/dashboard/student-health",
  requireRole("admin", "teacher"),
  async (req, res): Promise<void> => {
    const scope = buildScopeContext(req.session as ClassmateSession);

    const studentFilter = buildDashboardStudentFilter(scope);
    const assignmentFilter = buildDashboardAssignmentFilter(scope);
    const assessmentFilter = buildDashboardAssessmentFilter(scope);

    const [students, assignments, assessments] = await Promise.all([
      // Minimal columns: id + name only (skip grade, enrolledCourseIds, audit fields, etc.)
      db
        .select({ id: studentsTable.id, name: studentsTable.name })
        .from(studentsTable)
        .where(and(isNull(studentsTable.deletedAt), studentFilter)),

      // Minimal columns: only what the scoresByStudent builder needs
      // (skip title, description, dueDate, feedback, courseId, audit fields)
      db
        .select({
          studentId: assignmentsTable.studentId,
          status: assignmentsTable.status,
          score: assignmentsTable.score,
          maxScore: assignmentsTable.maxScore,
          updatedAt: assignmentsTable.updatedAt,
        })
        .from(assignmentsTable)
        .where(and(isNull(assignmentsTable.deletedAt), assignmentFilter)),

      // Minimal columns: only what the scoresByStudent builder needs
      // (skip title, strengths/weaknesses JSON, courseId, audit fields)
      db
        .select({
          studentId: assessmentsTable.studentId,
          score: assessmentsTable.score,
          maxScore: assessmentsTable.maxScore,
          createdAt: assessmentsTable.createdAt,
        })
        .from(assessmentsTable)
        .where(and(isNull(assessmentsTable.deletedAt), assessmentFilter)),
    ]);

    // Build per-student chronological score arrays.
    const scoresByStudent = new Map<number, Array<{ ts: number; pct: number }>>();

    for (const a of assignments) {
      if (a.status !== "graded" || a.score === null) continue;
      const pct = (a.score / a.maxScore) * 100;
      if (!scoresByStudent.has(a.studentId)) scoresByStudent.set(a.studentId, []);
      scoresByStudent.get(a.studentId)!.push({ ts: a.updatedAt.getTime(), pct });
    }

    for (const a of assessments) {
      const pct = (a.score / a.maxScore) * 100;
      if (!scoresByStudent.has(a.studentId)) scoresByStudent.set(a.studentId, []);
      scoresByStudent.get(a.studentId)!.push({ ts: a.createdAt.getTime(), pct });
    }

    const cohortInput = students.map((s) => {
      const entries = (scoresByStudent.get(s.id) ?? []).sort((a, b) => a.ts - b.ts);
      return { id: s.id, name: s.name, chronologicalScores: entries.map((e) => e.pct) };
    });

    const cohorts = classifyStudentCohorts(cohortInput);

    res.json(GetDashboardStudentHealthResponse.parse(cohorts));
  },
);

export default router;
