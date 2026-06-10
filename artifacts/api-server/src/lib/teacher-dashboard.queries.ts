import { sql, and, eq, isNull } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import {
  db,
  studentsTable,
  coursesTable,
  assignmentsTable,
  assessmentsTable,
} from "@workspace/db";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SummaryCountRow {
  totalStudents: number;
  totalCourses: number;
  totalAssignments: number;
  pendingAssignments: number;
  completedAssignments: number;
  /** null when there are no graded assignments in scope */
  avgAssignmentScore: number | null;
}

export interface StudentScoreRow {
  studentId: number;
  studentName: string;
  /** Average percentage (0–100) across all scope-visible assessments. */
  avgPct: number;
  scoreCount: number;
}

export interface CourseNameRow {
  id: number;
  name: string;
}

export interface CourseAssessmentStatsRow {
  courseId: number;
  /** null when the course has no assessments in scope */
  avgPct: number | null;
  aCount: number;
  bCount: number;
  cCount: number;
  dCount: number;
  fCount: number;
}

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Aggregate dashboard summary data using SQL — avoids loading full table rows into Node.js.
 *
 * Optimization vs. previous implementation:
 *   Before: 4 × SELECT * (full-table row loads) → all aggregation in JS
 *   After:  4 × SQL aggregate queries running in parallel → only scalar/grouped results
 *
 * Returns:
 *   counts  — scalar totals for students, courses, assignment status breakdown, and avg score
 *   studentScores — one row per enrolled student with an assessment avg (for atRisk / topPerformers)
 *
 * The studentScores query uses INNER JOIN students so it only returns students that are
 * (a) non-deleted and (b) satisfy the studentFilter (enrollment scope for teachers).
 * Students with zero assessments are excluded — this matches the previous JS behaviour of
 * checking `scores.length > 0` before including a student in atRisk / topPerformers.
 *
 * Query count: 4, all run in parallel via Promise.all.
 */
export async function getDashboardSummaryCounts(
  studentFilter: SQL | undefined,
  courseFilter: SQL | undefined,
  assignmentFilter: SQL | undefined,
  assessmentFilter: SQL | undefined,
): Promise<{
  counts: SummaryCountRow;
  studentScores: StudentScoreRow[];
}> {
  const [studentRows, courseRows, assignmentRows, scoreRows] = await Promise.all([
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(studentsTable)
      .where(and(isNull(studentsTable.deletedAt), studentFilter)),

    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(coursesTable)
      .where(and(isNull(coursesTable.deletedAt), courseFilter)),

    db
      .select({
        total: sql<number>`COUNT(*)::int`,
        pending: sql<number>`COUNT(*) FILTER (WHERE ${assignmentsTable.status} IN ('pending', 'late'))::int`,
        completed: sql<number>`COUNT(*) FILTER (WHERE ${assignmentsTable.status} IN ('graded', 'submitted'))::int`,
        avgScore: sql<number | null>`AVG(${assignmentsTable.score}::float / ${assignmentsTable.maxScore} * 100) FILTER (WHERE ${assignmentsTable.status} = 'graded' AND ${assignmentsTable.score} IS NOT NULL)`,
      })
      .from(assignmentsTable)
      .where(and(isNull(assignmentsTable.deletedAt), assignmentFilter)),

    // Per-student assessment averages — GROUP BY pushes aggregation to the DB.
    // INNER JOIN with students applies the studentFilter (enrollment scope) so only
    // students visible to the caller appear in atRisk / topPerformers computation.
    db
      .select({
        studentId: assessmentsTable.studentId,
        studentName: studentsTable.name,
        avgPct: sql<number>`AVG(${assessmentsTable.score}::float / ${assessmentsTable.maxScore} * 100)`,
        scoreCount: sql<number>`COUNT(*)::int`,
      })
      .from(assessmentsTable)
      .innerJoin(
        studentsTable,
        and(eq(studentsTable.id, assessmentsTable.studentId), isNull(studentsTable.deletedAt)),
      )
      .where(and(isNull(assessmentsTable.deletedAt), assessmentFilter, studentFilter))
      .groupBy(assessmentsTable.studentId, studentsTable.name),
  ]);

  return {
    counts: {
      totalStudents: studentRows[0]?.count ?? 0,
      totalCourses: courseRows[0]?.count ?? 0,
      totalAssignments: assignmentRows[0]?.total ?? 0,
      pendingAssignments: assignmentRows[0]?.pending ?? 0,
      completedAssignments: assignmentRows[0]?.completed ?? 0,
      avgAssignmentScore: assignmentRows[0]?.avgScore ?? null,
    },
    studentScores: scoreRows.map((r) => ({
      studentId: r.studentId,
      studentName: r.studentName,
      avgPct: r.avgPct,
      scoreCount: r.scoreCount,
    })),
  };
}

/**
 * Fetch grade breakdown data using SQL aggregation — avoids loading all assessment rows.
 *
 * Optimization vs. previous implementation:
 *   Before: SELECT * courses + SELECT * assessments (all rows) → JS per-course bucketing
 *   After:  SELECT id,name courses + GROUP BY course_id aggregate → 1 row per course
 *
 * Both queries run in parallel.
 *
 * Courses with no assessments in scope will have no entry in assessmentStats; the route
 * handler must default to zero counts for those courses.
 */
export async function getGradeBreakdownData(
  courseFilter: SQL | undefined,
  assessmentFilter: SQL | undefined,
): Promise<{
  courses: CourseNameRow[];
  assessmentStats: CourseAssessmentStatsRow[];
}> {
  const [courses, assessmentStats] = await Promise.all([
    db
      .select({ id: coursesTable.id, name: coursesTable.name })
      .from(coursesTable)
      .where(and(isNull(coursesTable.deletedAt), courseFilter)),

    db
      .select({
        courseId: assessmentsTable.courseId,
        avgPct: sql<number | null>`AVG(${assessmentsTable.score}::float / ${assessmentsTable.maxScore} * 100)`,
        aCount: sql<number>`COUNT(*) FILTER (WHERE ${assessmentsTable.score}::float / ${assessmentsTable.maxScore} * 100 >= 90)::int`,
        bCount: sql<number>`COUNT(*) FILTER (WHERE ${assessmentsTable.score}::float / ${assessmentsTable.maxScore} * 100 >= 80 AND ${assessmentsTable.score}::float / ${assessmentsTable.maxScore} * 100 < 90)::int`,
        cCount: sql<number>`COUNT(*) FILTER (WHERE ${assessmentsTable.score}::float / ${assessmentsTable.maxScore} * 100 >= 70 AND ${assessmentsTable.score}::float / ${assessmentsTable.maxScore} * 100 < 80)::int`,
        dCount: sql<number>`COUNT(*) FILTER (WHERE ${assessmentsTable.score}::float / ${assessmentsTable.maxScore} * 100 >= 60 AND ${assessmentsTable.score}::float / ${assessmentsTable.maxScore} * 100 < 70)::int`,
        fCount: sql<number>`COUNT(*) FILTER (WHERE ${assessmentsTable.score}::float / ${assessmentsTable.maxScore} * 100 < 60)::int`,
      })
      .from(assessmentsTable)
      .where(and(isNull(assessmentsTable.deletedAt), assessmentFilter))
      .groupBy(assessmentsTable.courseId),
  ]);

  return { courses, assessmentStats };
}
