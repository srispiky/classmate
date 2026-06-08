import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, notesTable } from "@workspace/db";

// ── Row types ─────────────────────────────────────────────────────────────────

export interface NoteSummaryRow {
  id: number;
  courseId: number;
  title: string;
  topic: string;
  createdAt: Date;
}

export interface NoteDetailRow extends NoteSummaryRow {
  content: string;
  videoUrl: string | null;
  updatedAt: Date;
}

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Repository: list all non-deleted notes for a student's enrolled courses.
 *
 * Notes have no studentId FK — ownership is enforced via courseId membership
 * in enrolledCourseIds only. All students enrolled in the same course see the
 * same notes.
 *
 * Returns [] immediately for an empty enrolledCourseIds array.
 *
 * Ordered by createdAt descending — newest first.
 *
 * @param enrolledCourseIds - From scope.enrolledCourseIds (session-derived).
 */
export async function listStudentNotes(
  enrolledCourseIds: number[],
): Promise<NoteSummaryRow[]> {
  if (enrolledCourseIds.length === 0) return [];

  return db
    .select({
      id: notesTable.id,
      courseId: notesTable.courseId,
      title: notesTable.title,
      topic: notesTable.topic,
      createdAt: notesTable.createdAt,
    })
    .from(notesTable)
    .where(
      and(
        inArray(notesTable.courseId, enrolledCourseIds),
        isNull(notesTable.deletedAt),
      ),
    )
    .orderBy(desc(notesTable.createdAt));
}

/**
 * Repository: fetch a single note by ID.
 *
 * Returns null for non-existent or soft-deleted notes.
 *
 * The enrollment check (courseId ∈ enrolledCourseIds) is the service layer's
 * responsibility — IDOR protection requires uniform denial across all cases.
 *
 * @param noteId - Path-param-derived note ID.
 */
export async function getStudentNote(noteId: number): Promise<NoteDetailRow | null> {
  const rows = await db
    .select({
      id: notesTable.id,
      courseId: notesTable.courseId,
      title: notesTable.title,
      topic: notesTable.topic,
      content: notesTable.content,
      videoUrl: notesTable.videoUrl,
      createdAt: notesTable.createdAt,
      updatedAt: notesTable.updatedAt,
    })
    .from(notesTable)
    .where(
      and(
        eq(notesTable.id, noteId),
        isNull(notesTable.deletedAt),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}
