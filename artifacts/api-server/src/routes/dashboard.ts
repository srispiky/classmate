import { Router, type IRouter } from "express";
import { and, desc, isNull } from "drizzle-orm";
import {
  db,
  studentsTable,
  coursesTable,
  assignmentsTable,
  assessmentsTable,
  activityTable,
} from "@workspace/db";
import {
  GetDashboardSummaryResponse,
  GetRecentActivityResponse,
  GetGradeBreakdownResponse,
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

const router: IRouter = Router();

// ── GET /api/dashboard/summary ────────────────────────────────────────────────

// Layer 1: dashboard data restricted to admin and teacher.
// Layer 2: teachers see only their own courses / enrolled students / owned assignments+assessments.
router.get(
  "/dashboard/summary",
  requireRole("admin", "teacher"),
  async (req, res): Promise<void> => {
    const scope = buildScopeContext(req.session as ClassmateSession);

    // Build per-resource scope filters (undefined = admin, no filter).
    const courseFilter = buildDashboardCourseFilter(scope);
    const studentFilter = buildDashboardStudentFilter(scope);
    const assignmentFilter = buildDashboardAssignmentFilter(scope);
    const assessmentFilter = buildDashboardAssessmentFilter(scope);

    const students = await db
      .select()
      .from(studentsTable)
      .where(and(isNull(studentsTable.deletedAt), studentFilter));

    const courses = await db
      .select()
      .from(coursesTable)
      .where(and(isNull(coursesTable.deletedAt), courseFilter));

    const assignments = await db
      .select()
      .from(assignmentsTable)
      .where(and(isNull(assignmentsTable.deletedAt), assignmentFilter));

    const assessments = await db
      .select()
      .from(assessmentsTable)
      .where(and(isNull(assessmentsTable.deletedAt), assessmentFilter));

    const pending = assignments.filter(
      (a) => a.status === "pending" || a.status === "late",
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
    const completed = assignments.filter(
      (a) => a.status === "graded" || a.status === "submitted",
    ).length;
    const completionRate =
      assignments.length > 0 ? completed / assignments.length : 0;

    const studentScores = new Map<number, number[]>();
    for (const a of assessments) {
      if (!studentScores.has(a.studentId)) studentScores.set(a.studentId, []);
      studentScores.get(a.studentId)!.push((a.score / a.maxScore) * 100);
    }
    let atRisk = 0;
    const topPerformers: Array<{ id: number; name: string; averageScore: number }> = [];
    for (const student of students) {
      const scores = studentScores.get(student.id) ?? [];
      const avg =
        scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
      if (avg < 60 && scores.length > 0) atRisk++;
      if (avg >= 80)
        topPerformers.push({
          id: student.id,
          name: student.name,
          averageScore: Math.round(avg),
        });
    }
    topPerformers.sort((a, b) => b.averageScore - a.averageScore);

    const summary = {
      totalStudents: students.length,
      totalCourses: courses.length,
      totalAssignments: assignments.length,
      pendingAssignments: pending,
      averageClassScore: Math.round(avgScore * 10) / 10,
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
router.get(
  "/dashboard/grade-breakdown",
  requireRole("admin", "teacher"),
  async (req, res): Promise<void> => {
    const scope = buildScopeContext(req.session as ClassmateSession);
    const courseFilter = buildDashboardCourseFilter(scope);
    const assessmentFilter = buildDashboardAssessmentFilter(scope);

    const courses = await db
      .select()
      .from(coursesTable)
      .where(and(isNull(coursesTable.deletedAt), courseFilter));

    const assessments = await db
      .select()
      .from(assessmentsTable)
      .where(and(isNull(assessmentsTable.deletedAt), assessmentFilter));

    const breakdown = courses.map((course) => {
      const courseAssessments = assessments.filter(
        (a) => a.courseId === course.id,
      );
      const avgScore =
        courseAssessments.length > 0
          ? courseAssessments.reduce(
              (sum, a) => sum + (a.score / a.maxScore) * 100,
              0,
            ) / courseAssessments.length
          : 0;

      let aCount = 0,
        bCount = 0,
        cCount = 0,
        dCount = 0,
        fCount = 0;
      for (const a of courseAssessments) {
        const pct = (a.score / a.maxScore) * 100;
        if (pct >= 90) aCount++;
        else if (pct >= 80) bCount++;
        else if (pct >= 70) cCount++;
        else if (pct >= 60) dCount++;
        else fCount++;
      }

      return {
        courseName: course.name,
        courseId: course.id,
        averageScore: Math.round(avgScore * 10) / 10,
        aCount,
        bCount,
        cCount,
        dCount,
        fCount,
      };
    });

    res.json(GetGradeBreakdownResponse.parse(breakdown));
  },
);

export default router;
