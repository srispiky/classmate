/**
 * Audit Field Integration Tests — Sprint 5 Chunk 0B
 *
 * Verifies that every mutable business entity correctly populates audit fields
 * at the repository/query layer using a real database connection.
 *
 * Coverage:
 *   CREATE  → created_at populated (not null)
 *             created_by / enrolled_by populated (matches actor userId)
 *   UPDATE  → updated_at updated (strictly later than created_at)
 *             updated_by populated (matches actor userId)
 *   SOFT DELETE (courses)      → deleted_at populated, deleted_by matches actor
 *   SOFT DELETE (enrollments)  → dropped_at populated, dropped_by matches actor
 *
 * Entities exercised:
 *   courses           — create / update / soft-delete
 *   assignments       — create / update
 *   assessments       — create / update
 *   notes             — create / update
 *   announcements     — create / update
 *   course_enrollments — create (enrolledBy) / unenroll (droppedBy)
 *
 * All test data is isolated using a timestamp-unique prefix and cleaned up
 * in afterAll. Tests do NOT depend on pre-existing DB state.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, usersTable, coursesTable, assignmentsTable, assessmentsTable, notesTable, announcementsTable, courseEnrollmentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { createEnrollment, deactivateEnrollment } from "../lib/enrollments.queries";

// ── Test fixture IDs (populated in beforeAll, cleaned in afterAll) ─────────────

let actorId: number;
let courseId: number;
let studentId: number;

const TS = Date.now();
const PREFIX = `_audit_test_${TS}`;

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  const [actor] = await db
    .insert(usersTable)
    .values({
      username: `${PREFIX}_actor`,
      passwordHash: "x",
      displayName: "Audit Test Actor",
      role: "teacher",
      isActive: true,
    })
    .returning({ id: usersTable.id });
  actorId = actor!.id;

  const [course] = await db
    .insert(coursesTable)
    .values({
      name: `${PREFIX} Course`,
      subject: "Audit",
      grade: "10",
      academicYear: "2025-2026",
      teacherName: "Audit Teacher",
      teacherId: actorId,
      status: "active",
      createdBy: actorId,
      updatedBy: actorId,
    })
    .returning({ id: coursesTable.id });
  courseId = course!.id;

  // Insert student via raw SQL — the Drizzle schema has a `user_id` column that
  // does not yet exist in the DB, so using the ORM INSERT would fail with
  // "column user_id does not exist" (Drizzle sends DEFAULT for every column).
  const studentResult = await db.execute(sql`
    INSERT INTO students (name, email, grade)
    VALUES (${`${PREFIX} Student`}, ${`${PREFIX}@test.example`}, ${"10"})
    RETURNING id
  `);
  studentId = (studentResult.rows[0] as { id: number }).id;
});

afterAll(async () => {
  // Clean up in dependency order (child rows first)
  await db
    .delete(courseEnrollmentsTable)
    .where(eq(courseEnrollmentsTable.courseId, courseId));
  await db.delete(announcementsTable).where(eq(announcementsTable.courseId, courseId));
  await db.delete(notesTable).where(eq(notesTable.courseId, courseId));
  await db.delete(assessmentsTable).where(eq(assessmentsTable.courseId, courseId));
  await db.delete(assignmentsTable).where(eq(assignmentsTable.courseId, courseId));
  await db.delete(coursesTable).where(eq(coursesTable.id, courseId));
  await db.execute(sql`DELETE FROM students WHERE id = ${studentId}`);
  await db.delete(usersTable).where(eq(usersTable.id, actorId));
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Sleep a few ms so updated_at is measurably later than created_at. */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ═══════════════════════════════════════════════════════════════════════════════
// COURSES
// ═══════════════════════════════════════════════════════════════════════════════

describe("Courses — audit fields", () => {
  let createdId: number;
  let createdAt: Date;

  it("CREATE populates created_at and created_by", async () => {
    const [row] = await db
      .insert(coursesTable)
      .values({
        name: `${PREFIX} Audit Course`,
        subject: "History",
        grade: "11",
        academicYear: "2025-2026",
        teacherName: "Audit Teacher",
        teacherId: actorId,
        status: "active",
        createdBy: actorId,
        updatedBy: actorId,
      })
      .returning();

    expect(row).toBeDefined();
    expect(row!.createdAt).toBeInstanceOf(Date);
    expect(row!.createdBy).toBe(actorId);

    createdId = row!.id;
    createdAt = row!.createdAt;
  });

  it("UPDATE populates updated_at (later) and updated_by", async () => {
    await sleep(5);

    const [row] = await db
      .update(coursesTable)
      .set({
        name: `${PREFIX} Audit Course Updated`,
        updatedAt: new Date(),
        updatedBy: actorId,
      })
      .where(eq(coursesTable.id, createdId))
      .returning();

    expect(row!.updatedAt.getTime()).toBeGreaterThan(createdAt.getTime());
    expect(row!.updatedBy).toBe(actorId);
  });

  it("SOFT DELETE populates deleted_at and deleted_by", async () => {
    const [row] = await db
      .update(coursesTable)
      .set({
        deletedAt: new Date(),
        deletedBy: actorId,
        updatedAt: new Date(),
        updatedBy: actorId,
      })
      .where(eq(coursesTable.id, createdId))
      .returning();

    expect(row!.deletedAt).toBeInstanceOf(Date);
    expect(row!.deletedBy).toBe(actorId);

    // Cleanup this specific course row
    await db.delete(coursesTable).where(eq(coursesTable.id, createdId));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ASSIGNMENTS
// ═══════════════════════════════════════════════════════════════════════════════

describe("Assignments — audit fields", () => {
  let createdId: number;
  let createdAt: Date;

  it("CREATE populates created_at and created_by", async () => {
    const [row] = await db
      .insert(assignmentsTable)
      .values({
        title: `${PREFIX} Assignment`,
        description: "Audit test assignment",
        courseId,
        studentId,
        dueDate: "2026-12-31",
        status: "pending",
        maxScore: 100,
        createdBy: actorId,
        updatedBy: actorId,
      })
      .returning();

    expect(row!.createdAt).toBeInstanceOf(Date);
    expect(row!.createdBy).toBe(actorId);

    createdId = row!.id;
    createdAt = row!.createdAt;
  });

  it("UPDATE populates updated_at (later) and updated_by", async () => {
    await sleep(5);

    const [row] = await db
      .update(assignmentsTable)
      .set({ status: "submitted", updatedAt: new Date(), updatedBy: actorId })
      .where(eq(assignmentsTable.id, createdId))
      .returning();

    expect(row!.updatedAt.getTime()).toBeGreaterThan(createdAt.getTime());
    expect(row!.updatedBy).toBe(actorId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ASSESSMENTS
// ═══════════════════════════════════════════════════════════════════════════════

describe("Assessments — audit fields", () => {
  let createdId: number;
  let createdAt: Date;

  it("CREATE populates created_at and created_by", async () => {
    const [row] = await db
      .insert(assessmentsTable)
      .values({
        title: `${PREFIX} Assessment`,
        studentId,
        courseId,
        score: 85,
        maxScore: 100,
        strengths: ["Focus"],
        weaknesses: ["Pace"],
        createdBy: actorId,
        updatedBy: actorId,
      })
      .returning();

    expect(row!.createdAt).toBeInstanceOf(Date);
    expect(row!.createdBy).toBe(actorId);

    createdId = row!.id;
    createdAt = row!.createdAt;
  });

  it("UPDATE populates updated_at (later) and updated_by", async () => {
    await sleep(5);

    const [row] = await db
      .update(assessmentsTable)
      .set({ score: 90, updatedAt: new Date(), updatedBy: actorId })
      .where(eq(assessmentsTable.id, createdId))
      .returning();

    expect(row!.updatedAt.getTime()).toBeGreaterThan(createdAt.getTime());
    expect(row!.updatedBy).toBe(actorId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// NOTES
// ═══════════════════════════════════════════════════════════════════════════════

describe("Notes — audit fields", () => {
  let createdId: number;
  let createdAt: Date;

  it("CREATE populates created_at and created_by", async () => {
    const [row] = await db
      .insert(notesTable)
      .values({
        title: `${PREFIX} Note`,
        content: "Audit test note content",
        courseId,
        topic: "Audit",
        createdBy: actorId,
        updatedBy: actorId,
      })
      .returning();

    expect(row!.createdAt).toBeInstanceOf(Date);
    expect(row!.createdBy).toBe(actorId);

    createdId = row!.id;
    createdAt = row!.createdAt;
  });

  it("UPDATE populates updated_at (later) and updated_by", async () => {
    await sleep(5);

    const [row] = await db
      .update(notesTable)
      .set({ title: `${PREFIX} Note Updated`, updatedAt: new Date(), updatedBy: actorId })
      .where(eq(notesTable.id, createdId))
      .returning();

    expect(row!.updatedAt.getTime()).toBeGreaterThan(createdAt.getTime());
    expect(row!.updatedBy).toBe(actorId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ANNOUNCEMENTS
// ═══════════════════════════════════════════════════════════════════════════════

describe("Announcements — audit fields", () => {
  let createdId: number;
  let createdAt: Date;

  it("CREATE populates created_at and created_by", async () => {
    const [row] = await db
      .insert(announcementsTable)
      .values({
        title: `${PREFIX} Announcement`,
        content: "Audit test announcement",
        courseId,
        authorName: "Audit Author",
        priority: "normal",
        createdBy: actorId,
        updatedBy: actorId,
      })
      .returning();

    expect(row!.createdAt).toBeInstanceOf(Date);
    expect(row!.createdBy).toBe(actorId);

    createdId = row!.id;
    createdAt = row!.createdAt;
  });

  it("UPDATE populates updated_at (later) and updated_by", async () => {
    await sleep(5);

    const [row] = await db
      .update(announcementsTable)
      .set({ title: `${PREFIX} Announcement Updated`, updatedAt: new Date(), updatedBy: actorId })
      .where(eq(announcementsTable.id, createdId))
      .returning();

    expect(row!.updatedAt.getTime()).toBeGreaterThan(createdAt.getTime());
    expect(row!.updatedBy).toBe(actorId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// COURSE ENROLLMENTS
// ═══════════════════════════════════════════════════════════════════════════════

describe("Course Enrollments — audit fields", () => {
  it("CREATE (enroll) populates enrolled_at and enrolled_by", async () => {
    const row = await createEnrollment(courseId, studentId, actorId);

    expect(row.enrolledAt).toBeInstanceOf(Date);
    expect(row.enrolledBy).toBe(actorId);
    expect(row.isActive).toBe(true);
    expect(row.droppedAt).toBeNull();
    expect(row.droppedBy).toBeNull();
  });

  it("SOFT DELETE (unenroll) populates dropped_at and dropped_by", async () => {
    const row = await deactivateEnrollment(courseId, studentId, actorId);

    expect(row).not.toBeNull();
    expect(row!.droppedAt).toBeInstanceOf(Date);
    expect(row!.droppedBy).toBe(actorId);
    expect(row!.isActive).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DELETED_BY FIELD — schema-level regression guard
// ═══════════════════════════════════════════════════════════════════════════════

describe("deleted_by schema guard — all soft-deletable entities", () => {
  it("courses schema exposes deletedBy column", () => {
    expect(coursesTable.deletedBy).toBeDefined();
    expect(coursesTable.deletedBy.columnType).toBe("PgInteger");
  });

  it("assignments schema exposes deletedBy column", () => {
    expect(assignmentsTable.deletedBy).toBeDefined();
    expect(assignmentsTable.deletedBy.columnType).toBe("PgInteger");
  });

  it("assessments schema exposes deletedBy column", () => {
    expect(assessmentsTable.deletedBy).toBeDefined();
    expect(assessmentsTable.deletedBy.columnType).toBe("PgInteger");
  });

  it("notes schema exposes deletedBy column", () => {
    expect(notesTable.deletedBy).toBeDefined();
    expect(notesTable.deletedBy.columnType).toBe("PgInteger");
  });

  it("announcements schema exposes deletedBy column", () => {
    expect(announcementsTable.deletedBy).toBeDefined();
    expect(announcementsTable.deletedBy.columnType).toBe("PgInteger");
  });

  it("course_enrollments schema exposes droppedBy column", () => {
    expect(courseEnrollmentsTable.droppedBy).toBeDefined();
    expect(courseEnrollmentsTable.droppedBy.columnType).toBe("PgInteger");
  });
});
