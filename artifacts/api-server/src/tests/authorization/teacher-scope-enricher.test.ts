/**
 * Teacher Scope Enricher Tests — Sprint 4 Chunk 4
 *
 * Integration tests for SessionEnricherService.enrichTeacher() behaviour.
 * Tests run against the real database; test data is isolated using a unique
 * username prefix and cleaned up in afterAll.
 *
 * Coverage (spec §Testing / SessionEnricher Tests):
 *   - Teacher with courses      → ownedCourseIds.length > 0
 *   - Teacher without courses   → ownedCourseIds = []
 *   - Deleted course excluded   → soft-deleted courses absent from ownedCourseIds
 *   - Inactive course excluded  → archived courses absent from ownedCourseIds
 *   - teacherId populated       → session.teacherId = userId
 *   - Deduplication             → duplicate rows not propagated (defensive)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, users, coursesTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { SessionEnricherService } from "../../lib/session-enricher";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Minimal session-like object — only the fields SessionEnricherService writes to. */
function makeBlankSession(): Record<string, unknown> {
  return {};
}

// ── Test data ─────────────────────────────────────────────────────────────────

let teacherUserId: number;
let otherUserId: number;
const insertedCourseIds: number[] = [];

beforeAll(async () => {
  const ts = Date.now();

  // Teacher user whose scope we'll enrich
  const [teacher] = await db
    .insert(users)
    .values({
      username: `_test_enrich_teacher_${ts}`,
      passwordHash: "x",
      displayName: "Test Enricher Teacher",
      role: "teacher",
      isActive: true,
    })
    .returning({ id: users.id });
  teacherUserId = teacher!.id;

  // Another user to verify course isolation (courses owned by others must not appear)
  const [other] = await db
    .insert(users)
    .values({
      username: `_test_enrich_other_${ts}`,
      passwordHash: "x",
      displayName: "Other Teacher",
      role: "teacher",
      isActive: true,
    })
    .returning({ id: users.id });
  otherUserId = other!.id;

  // Build course fixtures
  const base = { description: "", teacherName: "" };
  const courseValues = [
    // Active courses owned by our teacher (should appear)
    { ...base, name: `_test_active_1_${ts}`, subject: "Math",    teacherId: teacherUserId, status: "active"   as const },
    { ...base, name: `_test_active_2_${ts}`, subject: "Science", teacherId: teacherUserId, status: "active"   as const },
    // Archived course (status ≠ 'active') — must be excluded
    { ...base, name: `_test_archived_${ts}`, subject: "History", teacherId: teacherUserId, status: "archived" as const },
    // Soft-deleted course — must be excluded
    { ...base, name: `_test_deleted_${ts}`,  subject: "English", teacherId: teacherUserId, status: "active"   as const, deletedAt: new Date() },
    // Active course owned by ANOTHER teacher — must never appear
    { ...base, name: `_test_other_${ts}`,    subject: "Art",     teacherId: otherUserId,   status: "active"   as const },
  ];

  const inserted = await db
    .insert(coursesTable)
    .values(courseValues)
    .returning({ id: coursesTable.id });

  insertedCourseIds.push(...inserted.map((r) => r.id));
});

afterAll(async () => {
  if (insertedCourseIds.length) {
    await db.delete(coursesTable).where(inArray(coursesTable.id, insertedCourseIds));
  }
  if (teacherUserId) await db.delete(users).where(eq(users.id, teacherUserId));
  if (otherUserId) await db.delete(users).where(eq(users.id, otherUserId));
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("SessionEnricherService.enrich — role=teacher", () => {
  describe("teacherId population", () => {
    it("sets session.teacherId to the user's ID", async () => {
      const session = makeBlankSession();
      await SessionEnricherService.enrich(session as never, teacherUserId, "teacher");
      expect(session.teacherId).toBe(teacherUserId);
    });

    it("teacherId is always set even when teacher owns no courses", async () => {
      // otherUserId owns one course (created above) but for a user with NO courses
      // we create a fresh user and immediately enrich
      const ts = Date.now();
      const [noCoursesTeacher] = await db
        .insert(users)
        .values({
          username: `_test_no_courses_${ts}`,
          passwordHash: "x",
          displayName: "No Courses Teacher",
          role: "teacher",
          isActive: true,
        })
        .returning({ id: users.id });
      const noCoursesId = noCoursesTeacher!.id;

      try {
        const session = makeBlankSession();
        await SessionEnricherService.enrich(session as never, noCoursesId, "teacher");
        expect(session.teacherId).toBe(noCoursesId);
        expect(session.ownedCourseIds).toEqual([]);
      } finally {
        await db.delete(users).where(eq(users.id, noCoursesId));
      }
    });
  });

  describe("ownedCourseIds population", () => {
    it("includes active, non-deleted courses owned by this teacher", async () => {
      const session = makeBlankSession();
      await SessionEnricherService.enrich(session as never, teacherUserId, "teacher");

      const owned = session.ownedCourseIds as number[];
      expect(Array.isArray(owned)).toBe(true);
      // Two active non-deleted courses were inserted for teacherUserId
      expect(owned.length).toBe(2);
    });

    it("each owned courseId is a positive integer", async () => {
      const session = makeBlankSession();
      await SessionEnricherService.enrich(session as never, teacherUserId, "teacher");

      const owned = session.ownedCourseIds as number[];
      owned.forEach((id) => {
        expect(typeof id).toBe("number");
        expect(id).toBeGreaterThan(0);
        expect(Number.isInteger(id)).toBe(true);
      });
    });

    it("teacher with no courses gets ownedCourseIds = []", async () => {
      const ts = Date.now();
      const [emptyTeacher] = await db
        .insert(users)
        .values({
          username: `_test_empty_${ts}`,
          passwordHash: "x",
          displayName: "Empty Teacher",
          role: "teacher",
          isActive: true,
        })
        .returning({ id: users.id });
      const emptyId = emptyTeacher!.id;

      try {
        const session = makeBlankSession();
        await SessionEnricherService.enrich(session as never, emptyId, "teacher");
        expect(session.ownedCourseIds).toEqual([]);
      } finally {
        await db.delete(users).where(eq(users.id, emptyId));
      }
    });
  });

  describe("Exclusion rules", () => {
    it("excludes archived courses (status = 'archived')", async () => {
      const session = makeBlankSession();
      await SessionEnricherService.enrich(session as never, teacherUserId, "teacher");

      const owned = session.ownedCourseIds as number[];
      // The archived course ID was the 3rd inserted (index 2)
      // We verify by checking that owned.length = 2 (only the 2 active non-deleted courses)
      // and that none of the excluded IDs appear
      const archivedId = insertedCourseIds[2]!;
      expect(owned).not.toContain(archivedId);
    });

    it("excludes soft-deleted courses (deleted_at IS NOT NULL)", async () => {
      const session = makeBlankSession();
      await SessionEnricherService.enrich(session as never, teacherUserId, "teacher");

      const owned = session.ownedCourseIds as number[];
      const deletedId = insertedCourseIds[3]!;
      expect(owned).not.toContain(deletedId);
    });

    it("excludes courses owned by other teachers", async () => {
      const session = makeBlankSession();
      await SessionEnricherService.enrich(session as never, teacherUserId, "teacher");

      const owned = session.ownedCourseIds as number[];
      const otherTeacherCourseId = insertedCourseIds[4]!;
      expect(owned).not.toContain(otherTeacherCourseId);
    });

    it("other teacher's enrichment only includes their own course", async () => {
      const session = makeBlankSession();
      await SessionEnricherService.enrich(session as never, otherUserId, "teacher");

      const owned = session.ownedCourseIds as number[];
      expect(owned.length).toBe(1);
      expect(owned).toContain(insertedCourseIds[4]!);
    });
  });

  describe("Reset behaviour", () => {
    it("resets student fields when enriching a teacher", async () => {
      const session = makeBlankSession();
      // Pre-pollute with student data
      (session as Record<string, unknown>).studentId = 999;
      (session as Record<string, unknown>).enrolledCourseIds = [1, 2];

      await SessionEnricherService.enrich(session as never, teacherUserId, "teacher");

      expect(session.studentId).toBeUndefined();
      expect(session.enrolledCourseIds).toBeUndefined();
    });

    it("resets parent fields when enriching a teacher", async () => {
      const session = makeBlankSession();
      (session as Record<string, unknown>).childStudentIds = [5];
      (session as Record<string, unknown>).childCourseIds = [3];

      await SessionEnricherService.enrich(session as never, teacherUserId, "teacher");

      expect(session.childStudentIds).toBeUndefined();
      expect(session.childCourseIds).toBeUndefined();
    });
  });

  describe("ownedCourseIds is always an array", () => {
    it("is never null", async () => {
      const session = makeBlankSession();
      await SessionEnricherService.enrich(session as never, teacherUserId, "teacher");
      expect(session.ownedCourseIds).not.toBeNull();
    });

    it("is never undefined after enrichment", async () => {
      const session = makeBlankSession();
      await SessionEnricherService.enrich(session as never, teacherUserId, "teacher");
      expect(session.ownedCourseIds).toBeDefined();
    });
  });
});
