import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, announcementsTable } from "@workspace/db";

// ── Row types ─────────────────────────────────────────────────────────────────

export interface AnnouncementSummaryRow {
  id: number;
  courseId: number;
  title: string;
  priority: string;
  authorName: string;
  createdAt: Date;
}

export interface AnnouncementDetailRow extends AnnouncementSummaryRow {
  content: string;
  updatedAt: Date;
}

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Repository: list all non-deleted announcements for a student's enrolled courses.
 *
 * Announcements have no studentId FK — ownership is enforced via courseId
 * membership in enrolledCourseIds only. All students enrolled in the same
 * course see the same announcements.
 *
 * Returns [] immediately for an empty enrolledCourseIds array.
 *
 * Ordered by createdAt descending — newest first.
 *
 * @param enrolledCourseIds - From scope.enrolledCourseIds (session-derived).
 */
export async function listStudentAnnouncements(
  enrolledCourseIds: number[],
): Promise<AnnouncementSummaryRow[]> {
  if (enrolledCourseIds.length === 0) return [];

  return db
    .select({
      id: announcementsTable.id,
      courseId: announcementsTable.courseId,
      title: announcementsTable.title,
      priority: announcementsTable.priority,
      authorName: announcementsTable.authorName,
      createdAt: announcementsTable.createdAt,
    })
    .from(announcementsTable)
    .where(
      and(
        inArray(announcementsTable.courseId, enrolledCourseIds),
        isNull(announcementsTable.deletedAt),
      ),
    )
    .orderBy(desc(announcementsTable.createdAt));
}

/**
 * Repository: fetch a single announcement by ID.
 *
 * Returns null for non-existent or soft-deleted announcements.
 *
 * The enrollment check (courseId ∈ enrolledCourseIds) is the service layer's
 * responsibility. This keeps the repository free of business logic and ensures
 * IDOR protection is applied uniformly across all denial cases.
 *
 * @param announcementId - Path-param-derived announcement ID.
 */
export async function getStudentAnnouncement(
  announcementId: number,
): Promise<AnnouncementDetailRow | null> {
  const rows = await db
    .select({
      id: announcementsTable.id,
      courseId: announcementsTable.courseId,
      title: announcementsTable.title,
      content: announcementsTable.content,
      priority: announcementsTable.priority,
      authorName: announcementsTable.authorName,
      createdAt: announcementsTable.createdAt,
      updatedAt: announcementsTable.updatedAt,
    })
    .from(announcementsTable)
    .where(
      and(
        eq(announcementsTable.id, announcementId),
        isNull(announcementsTable.deletedAt),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}
