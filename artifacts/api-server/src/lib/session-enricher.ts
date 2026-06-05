import { db, studentsTable, courseEnrollmentsTable, studentGuardiansTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import type { Session, SessionData } from "express-session";

type AppSession = Session & Partial<SessionData>;

export class SessionEnricherService {
  /**
   * Enriches a session with role-specific data after a successful login.
   *
   * Student enrichment reads enrolledCourseIds from the course_enrollments table
   * (Sprint 3 migration) — NOT from the deprecated students.enrolled_course_ids JSON column.
   *
   * Parent enrichment populates both childStudentIds and childCourseIds so that
   * course-scoped RLS filters can use inArray(courseId, childCourseIds) without a
   * per-request JOIN chain (parent → child → enrollment → course). Sprint 3 §9e.
   *
   * DEPLOYMENT ORDER: course_enrollments migration (Chunk 1) must run in production
   * before this code is deployed. Students will have empty enrolledCourseIds until
   * the migration back-fills the table.
   */
  static async enrich(session: AppSession, userId: number, role: string): Promise<void> {
    session.permissions = [];
    session.permissionsVersion = 0;
    session.studentId = undefined;
    session.enrolledCourseIds = undefined;
    session.childStudentIds = undefined;
    session.childCourseIds = undefined;

    if (role === "student") {
      await SessionEnricherService.enrichStudent(session, userId);
    } else if (role === "parent") {
      await SessionEnricherService.enrichParent(session, userId);
    }
  }

  private static async enrichStudent(session: AppSession, userId: number): Promise<void> {
    const studentRows = await db
      .select({ id: studentsTable.id })
      .from(studentsTable)
      .where(eq(studentsTable.userId, userId))
      .limit(1);

    if (studentRows.length === 0) {
      // Account exists but has not yet been linked to a student record by an admin.
      // Return empty enrollments — see Sprint 3 design §4a edge case: unlinked student account.
      session.enrolledCourseIds = [];
      return;
    }

    const studentId = studentRows[0]!.id;
    session.studentId = studentId;

    const enrollmentRows = await db
      .select({ courseId: courseEnrollmentsTable.courseId })
      .from(courseEnrollmentsTable)
      .where(
        and(
          eq(courseEnrollmentsTable.studentId, studentId),
          eq(courseEnrollmentsTable.isActive, true),
        ),
      );

    session.enrolledCourseIds = enrollmentRows.map((r) => r.courseId);
  }

  private static async enrichParent(session: AppSession, userId: number): Promise<void> {
    const guardianRows = await db
      .select({ studentId: studentGuardiansTable.studentId })
      .from(studentGuardiansTable)
      .where(eq(studentGuardiansTable.userId, userId));

    const childStudentIds = guardianRows.map((r) => r.studentId);
    session.childStudentIds = childStudentIds;

    if (childStudentIds.length === 0) {
      session.childCourseIds = [];
      return;
    }

    // Query all active enrollments for any linked child — uses the
    // course_enrollments.student_id index (Chunk 1 migration) for an efficient index scan.
    // Multiple children enrolled in the same course produce duplicate rows; deduplicate before storing.
    const enrollmentRows = await db
      .select({ courseId: courseEnrollmentsTable.courseId })
      .from(courseEnrollmentsTable)
      .where(
        and(
          inArray(courseEnrollmentsTable.studentId, childStudentIds),
          eq(courseEnrollmentsTable.isActive, true),
        ),
      );

    const seen = new Set<number>();
    session.childCourseIds = enrollmentRows
      .map((r) => r.courseId)
      .filter((id) => {
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
  }
}
