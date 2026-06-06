import { eq, and } from "drizzle-orm";
import { db, courseEnrollmentsTable } from "@workspace/db";
import type { CourseEnrollment } from "@workspace/db";

/**
 * Returns the active enrollment record for a course+student pair, or null if none.
 *
 * Used for duplicate detection before insert and for existence verification
 * before soft-unenrollment. Hits the partial unique index on (student_id, course_id)
 * WHERE is_active = true — no full-table scan.
 */
export async function getActiveEnrollment(
  courseId: number,
  studentId: number,
): Promise<CourseEnrollment | null> {
  const [row] = await db
    .select()
    .from(courseEnrollmentsTable)
    .where(
      and(
        eq(courseEnrollmentsTable.courseId, courseId),
        eq(courseEnrollmentsTable.studentId, studentId),
        eq(courseEnrollmentsTable.isActive, true),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Inserts a new enrollment record.
 *
 * Caller is responsible for:
 *   1. Verifying the course exists and is active
 *   2. Verifying the student exists
 *   3. Verifying no active enrollment already exists (to avoid duplicate key)
 *   4. Performing the Layer 3 course ownership check
 *
 * The `enrolledBy` field is populated from scope.userId at the route layer.
 */
export async function createEnrollment(
  courseId: number,
  studentId: number,
  enrolledBy: number,
): Promise<CourseEnrollment> {
  const [row] = await db
    .insert(courseEnrollmentsTable)
    .values({ courseId, studentId, enrolledBy, isActive: true })
    .returning();
  return row;
}

/**
 * Soft-unenrolls a student from a course by deactivating their enrollment record.
 *
 * Sets isActive=false and droppedAt=now() on the active enrollment.
 * Historical records are preserved — no rows are deleted.
 *
 * Returns the deactivated enrollment row, or null if no active enrollment was found
 * (→ route handler returns 404).
 */
export async function deactivateEnrollment(
  courseId: number,
  studentId: number,
): Promise<CourseEnrollment | null> {
  const [row] = await db
    .update(courseEnrollmentsTable)
    .set({ isActive: false, droppedAt: new Date() })
    .where(
      and(
        eq(courseEnrollmentsTable.courseId, courseId),
        eq(courseEnrollmentsTable.studentId, studentId),
        eq(courseEnrollmentsTable.isActive, true),
      ),
    )
    .returning();
  return row ?? null;
}
