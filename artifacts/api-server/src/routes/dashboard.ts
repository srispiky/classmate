import { Router, type IRouter } from "express";
import { desc, eq, isNull } from "drizzle-orm";
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

const router: IRouter = Router();

// ── GET /api/dashboard/summary ────────────────────────────────────────────────

// Layer 1: dashboard data is class-wide; restricted to admin and teacher only.
router.get(
  "/dashboard/summary",
  requireRole("admin", "teacher"),
  async (_req, res): Promise<void> => {
    const students = await db
      .select()
      .from(studentsTable)
      .where(isNull(studentsTable.deletedAt));

    const courses = await db
      .select()
      .from(coursesTable)
      .where(isNull(coursesTable.deletedAt));

    const assignments = await db
      .select()
      .from(assignmentsTable)
      .where(isNull(assignmentsTable.deletedAt));

    const assessments = await db
      .select()
      .from(assessmentsTable)
      .where(isNull(assessmentsTable.deletedAt));

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

// Layer 1: restricted to admin and teacher only.
router.get(
  "/dashboard/recent-activity",
  requireRole("admin", "teacher"),
  async (_req, res): Promise<void> => {
    const activities = await db
      .select()
      .from(activityTable)
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

// Layer 1: restricted to admin and teacher only.
router.get(
  "/dashboard/grade-breakdown",
  requireRole("admin", "teacher"),
  async (_req, res): Promise<void> => {
    const courses = await db
      .select()
      .from(coursesTable)
      .where(isNull(coursesTable.deletedAt));

    const assessments = await db
      .select()
      .from(assessmentsTable)
      .where(isNull(assessmentsTable.deletedAt));

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
