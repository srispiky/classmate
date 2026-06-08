import { listStudentNotes, getStudentNote } from "../lib/student-notes.queries";
import type { ScopeContext } from "../lib/scope-context";

// ── DTOs ──────────────────────────────────────────────────────────────────────

export interface StudentNoteSummaryDto {
  noteId: number;
  courseId: number;
  title: string;
  topic: string;
  createdAt: string; // ISO 8601
}

export interface StudentNoteDetailDto extends StudentNoteSummaryDto {
  content: string;
  videoUrl: string | null;
  updatedAt: string; // ISO 8601
}

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * StudentNotesService — student-scoped note access.
 *
 * Ownership model is identical to announcements (Chunk 6):
 *   - Notes have no studentId FK — they are course-scoped only.
 *   - Ownership is enforced solely via scope.enrolledCourseIds.
 *   - All students enrolled in the same course see the same notes.
 *
 * Ownership rules:
 *   1. List: only returns notes whose courseId ∈ scope.enrolledCourseIds.
 *      The repository handles this via an inArray filter.
 *   2. Detail: requires row's courseId ∈ scope.enrolledCourseIds.
 *      Applied post-query for IDOR safety.
 *
 * Authorization middleware (requireRole) runs before this service.
 * No SQL in this layer.
 */
export class StudentNotesService {
  /**
   * Returns all notes visible to the student across enrolled courses.
   *
   * Returns [] when scope.enrolledCourseIds is empty.
   *
   * Ordered by createdAt descending (newest first).
   */
  static async listNotes(scope: ScopeContext): Promise<StudentNoteSummaryDto[]> {
    if (scope.enrolledCourseIds.length === 0) return [];

    const rows = await listStudentNotes(scope.enrolledCourseIds);

    return rows.map((row) => ({
      noteId: row.id,
      courseId: row.courseId,
      title: row.title,
      topic: row.topic,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /**
   * Returns a single note detail.
   *
   * Returns null when:
   *   - note does not exist
   *   - note is soft-deleted
   *   - note's course is not in scope.enrolledCourseIds
   *
   * Controller maps null → 404. Callers cannot distinguish the denial reason —
   * intentional for IDOR safety.
   */
  static async getNote(
    scope: ScopeContext,
    noteId: number,
  ): Promise<StudentNoteDetailDto | null> {
    const row = await getStudentNote(noteId);
    if (!row) return null;

    // Enrollment check: the note's course must be in the student's active
    // enrolled set. Returns the same null as "not found" — IDOR-safe.
    if (!scope.enrolledCourseIds.includes(row.courseId)) return null;

    return {
      noteId: row.id,
      courseId: row.courseId,
      title: row.title,
      topic: row.topic,
      content: row.content,
      videoUrl: row.videoUrl ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
