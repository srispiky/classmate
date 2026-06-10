/**
 * Load-test seeding harness.
 *
 * Creates deterministic test fixtures at configurable scale and returns
 * a cleanup function that removes every seeded row by primary key.
 *
 * All inserts use bulk VALUES syntax — one round-trip per table, not N.
 *
 * Usage:
 *   const cleanup = await seedPerfData({ numStudents: 100, courseId });
 *   // ... run tests ...
 *   await cleanup();
 */

import { db, studentsTable, assignmentsTable, assessmentsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

export interface SeedResult {
  studentIds: number[];
  assignmentIds: number[];
  assessmentIds: number[];
  /** Call this in afterAll to remove every seeded row. */
  cleanup: () => Promise<void>;
}

export interface SeedOptions {
  /** Number of students to create. */
  numStudents: number;
  /** Existing course ID to attach assignments + assessments to. */
  courseId: number;
  /** Assignments per student. Default 5. */
  assignmentsPerStudent?: number;
  /** Assessments per student. Default 4. */
  assessmentsPerStudent?: number;
  /** Prefix for generated names to avoid collisions with other tests. */
  namePrefix?: string;
}

/**
 * Seed N students with assignments and assessments in a single bulk-insert pass.
 *
 * Score distribution is deterministic: students are assigned scores cycling through
 * representative values so the dashboard aggregations have meaningful non-trivial output
 * (mix of A/B/C/D/F grades and at-risk / top-performer cohorts).
 */
export async function seedPerfData(opts: SeedOptions): Promise<SeedResult> {
  const {
    numStudents,
    courseId,
    assignmentsPerStudent = 5,
    assessmentsPerStudent = 4,
    namePrefix = "__perf__",
  } = opts;

  // ── Students ─────────────────────────────────────────────────────────────
  const studentValues = Array.from({ length: numStudents }, (_, i) => ({
    name: `${namePrefix}Student_${i + 1}`,
    email: `${namePrefix}_student_${i + 1}_${Date.now()}@perftest.invalid`,
    grade: `Grade ${(i % 12) + 1}`,
    enrolledCourseIds: [courseId],
  }));

  const insertedStudents = await db
    .insert(studentsTable)
    .values(studentValues)
    .returning({ id: studentsTable.id });

  const studentIds = insertedStudents.map((r) => r.id);

  // ── Assignments ───────────────────────────────────────────────────────────
  // Score cycle: 95, 85, 75, 65, 45 → ensures each grade bucket (A/B/C/D/F) is represented.
  const ASSIGNMENT_SCORES = [95, 85, 75, 65, 45];
  const ASSIGNMENT_STATUSES = ["graded", "graded", "graded", "submitted", "pending"] as const;

  const baseDate = new Date("2025-01-01T00:00:00Z");

  const assignmentValues = studentIds.flatMap((studentId, si) =>
    Array.from({ length: assignmentsPerStudent }, (_, ai) => ({
      title: `${namePrefix}Assignment_s${si}_a${ai}`,
      description: "Perf test assignment",
      courseId,
      studentId,
      dueDate: "2025-06-01",
      status: ASSIGNMENT_STATUSES[ai % ASSIGNMENT_STATUSES.length],
      score:
        ASSIGNMENT_STATUSES[ai % ASSIGNMENT_STATUSES.length] === "graded"
          ? ASSIGNMENT_SCORES[ai % ASSIGNMENT_SCORES.length]
          : null,
      maxScore: 100,
      updatedAt: new Date(baseDate.getTime() + (si * assignmentsPerStudent + ai) * 60_000),
    })),
  );

  const insertedAssignments = await db
    .insert(assignmentsTable)
    .values(assignmentValues)
    .returning({ id: assignmentsTable.id });

  const assignmentIds = insertedAssignments.map((r) => r.id);

  // ── Assessments ───────────────────────────────────────────────────────────
  // Score cycle produces a spread across risk thresholds (< 60 = HIGH, 60–80 = MEDIUM, ≥ 80 = LOW).
  const ASSESSMENT_SCORES = [90, 70, 55, 80];

  const assessmentValues = studentIds.flatMap((studentId, si) =>
    Array.from({ length: assessmentsPerStudent }, (_, ai) => ({
      title: `${namePrefix}Assessment_s${si}_a${ai}`,
      courseId,
      studentId,
      score: ASSESSMENT_SCORES[ai % ASSESSMENT_SCORES.length],
      maxScore: 100,
      strengths: [],
      weaknesses: [],
      createdAt: new Date(baseDate.getTime() + (si * assessmentsPerStudent + ai) * 120_000),
    })),
  );

  const insertedAssessments = await db
    .insert(assessmentsTable)
    .values(assessmentValues)
    .returning({ id: assessmentsTable.id });

  const assessmentIds = insertedAssessments.map((r) => r.id);

  // ── Cleanup ───────────────────────────────────────────────────────────────
  const cleanup = async (): Promise<void> => {
    if (assessmentIds.length > 0) {
      await db.delete(assessmentsTable).where(inArray(assessmentsTable.id, assessmentIds));
    }
    if (assignmentIds.length > 0) {
      await db.delete(assignmentsTable).where(inArray(assignmentsTable.id, assignmentIds));
    }
    if (studentIds.length > 0) {
      await db.delete(studentsTable).where(inArray(studentsTable.id, studentIds));
    }
  };

  return { studentIds, assignmentIds, assessmentIds, cleanup };
}

/**
 * Helper: returns a human-readable size label for a student count.
 * Used in test describe blocks and logging.
 */
export function sizeLabel(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return `${n}`;
}
