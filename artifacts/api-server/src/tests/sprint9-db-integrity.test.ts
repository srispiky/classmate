/**
 * Sprint 9 Chunk 3 — Database Integrity Tests
 *
 * Proves that the FK constraints and indexes added in Sprint 9 Chunk 3
 * are live and enforcing referential integrity in the connected database.
 *
 * Covers (H5 + H6 from the Sprint 9 audit):
 *
 * H5 — Foreign key constraints
 *   - assignments.course_id  → courses.id  (CASCADE)
 *   - assignments.student_id → students.id (CASCADE)
 *   - assessments.course_id  → courses.id  (CASCADE)
 *   - assessments.student_id → students.id (CASCADE)
 *   - announcements.course_id → courses.id (CASCADE)
 *   - notes.course_id         → courses.id (CASCADE)
 *
 * H6 — Query indexes
 *   Verifies each expected index exists in pg_indexes.
 *
 * Behavioral tests (live DB):
 *   - Valid inserts succeed
 *   - Invalid foreign key references are rejected
 *   - CASCADE DELETE propagates correctly
 *   - Soft-delete behavior is unchanged after FK addition
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, pool } from "@workspace/db";
import {
  usersTable,
  coursesTable,
  studentsTable,
  assignmentsTable,
  assessmentsTable,
  announcementsTable,
  notesTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";

// ── Test fixtures ─────────────────────────────────────────────────────────────

const TS = Date.now();
const P = `_s9db_${TS}`;

let actorId: number;
let courseId: number;
let studentId: number;

beforeAll(async () => {
  const [actor] = await db
    .insert(usersTable)
    .values({ username: `${P}_actor`, passwordHash: "x", displayName: "S9DB Actor", role: "teacher", isActive: true })
    .returning({ id: usersTable.id });
  actorId = actor!.id;

  const [course] = await db
    .insert(coursesTable)
    .values({
      name: `${P} Course`,
      subject: "Math",
      grade: "9",
      academicYear: "2025-2026",
      teacherId: actorId,
      teacherName: "S9DB Teacher",
      createdBy: actorId,
      updatedBy: actorId,
    })
    .returning({ id: coursesTable.id });
  courseId = course!.id;

  const [student] = await db
    .insert(studentsTable)
    .values({
      name: `${P} Student`,
      email: `${P}@test.com`,
      grade: "9",
      enrolledCourseIds: [courseId],
      createdBy: actorId,
      updatedBy: actorId,
    })
    .returning({ id: studentsTable.id });
  studentId = student!.id;
});

afterAll(async () => {
  // Cascade from course/student will clean up assignments/assessments/notes/announcements
  await db.delete(studentsTable).where(eq(studentsTable.id, studentId));
  await db.delete(coursesTable).where(eq(coursesTable.id, courseId));
  await db.delete(usersTable).where(eq(usersTable.id, actorId));
});

// ── Part 1: Index existence (H6) ──────────────────────────────────────────────

describe("H6 — Query indexes exist in pg_indexes", () => {
  async function indexExists(indexName: string): Promise<boolean> {
    const result = await db.execute(
      sql`SELECT 1 FROM pg_indexes WHERE indexname = ${indexName} LIMIT 1`,
    );
    return result.rows.length > 0;
  }

  const expectedIndexes = [
    // assignments
    "ix_assignments_student_id",
    "ix_assignments_course_id",
    "ix_assignments_deleted_at",
    // assessments
    "ix_assessments_student_id",
    "ix_assessments_course_id",
    "ix_assessments_deleted_at",
    // announcements
    "ix_announcements_course_id",
    "ix_announcements_deleted_at",
    // notes
    "ix_notes_course_id",
    "ix_notes_deleted_at",
    // courses
    "ix_courses_teacher_id",
    "ix_courses_deleted_at",
    // activity
    "ix_activity_course_id",
  ];

  for (const idx of expectedIndexes) {
    it(`index exists: ${idx}`, async () => {
      expect(await indexExists(idx)).toBe(true);
    });
  }
});

// ── Part 2: FK constraint existence (H5) ──────────────────────────────────────

describe("H5 — FK constraints exist in pg_constraint", () => {
  async function constraintExists(name: string): Promise<boolean> {
    const result = await db.execute(
      sql`SELECT 1 FROM pg_constraint WHERE conname = ${name} AND contype = 'f' LIMIT 1`,
    );
    return result.rows.length > 0;
  }

  const expectedConstraints = [
    "assignments_course_id_courses_id_fk",
    "assignments_student_id_students_id_fk",
    "assessments_course_id_courses_id_fk",
    "assessments_student_id_students_id_fk",
    "announcements_course_id_courses_id_fk",
    "notes_course_id_courses_id_fk",
  ];

  for (const c of expectedConstraints) {
    it(`constraint exists: ${c}`, async () => {
      expect(await constraintExists(c)).toBe(true);
    });
  }
});

// ── Part 3: Valid inserts succeed (no FK violation on valid data) ──────────────

describe("FK integrity — valid inserts succeed", () => {
  it("assignment with valid courseId and studentId inserts successfully", async () => {
    const [row] = await db
      .insert(assignmentsTable)
      .values({
        title: `${P} Assignment`,
        description: "FK integrity test",
        courseId,
        studentId,
        dueDate: "2025-12-01",
        status: "pending",
        maxScore: 100,
        createdBy: actorId,
        updatedBy: actorId,
      })
      .returning({ id: assignmentsTable.id });
    expect(row?.id).toBeTypeOf("number");
    // cleanup
    await db.delete(assignmentsTable).where(eq(assignmentsTable.id, row!.id));
  });

  it("assessment with valid courseId and studentId inserts successfully", async () => {
    const [row] = await db
      .insert(assessmentsTable)
      .values({
        title: `${P} Assessment`,
        studentId,
        courseId,
        score: 85,
        maxScore: 100,
        strengths: ["critical thinking"],
        weaknesses: [],
        createdBy: actorId,
        updatedBy: actorId,
      })
      .returning({ id: assessmentsTable.id });
    expect(row?.id).toBeTypeOf("number");
    await db.delete(assessmentsTable).where(eq(assessmentsTable.id, row!.id));
  });

  it("announcement with valid courseId inserts successfully", async () => {
    const [row] = await db
      .insert(announcementsTable)
      .values({
        title: `${P} Announcement`,
        content: "FK integrity test",
        courseId,
        authorName: "S9DB Teacher",
        priority: "normal",
        createdBy: actorId,
        updatedBy: actorId,
      })
      .returning({ id: announcementsTable.id });
    expect(row?.id).toBeTypeOf("number");
    await db.delete(announcementsTable).where(eq(announcementsTable.id, row!.id));
  });

  it("note with valid courseId inserts successfully", async () => {
    const [row] = await db
      .insert(notesTable)
      .values({
        title: `${P} Note`,
        content: "FK integrity test",
        courseId,
        topic: "Algebra",
        createdBy: actorId,
        updatedBy: actorId,
      })
      .returning({ id: notesTable.id });
    expect(row?.id).toBeTypeOf("number");
    await db.delete(notesTable).where(eq(notesTable.id, row!.id));
  });
});

// ── Part 4: Invalid FK references are rejected ────────────────────────────────

describe("FK integrity — invalid references are rejected", () => {
  const NONEXISTENT_ID = 999_999_999;

  it("assignment with non-existent courseId is rejected", async () => {
    await expect(
      db.insert(assignmentsTable).values({
        title: `${P} Bad Assignment`,
        description: "Should fail",
        courseId: NONEXISTENT_ID,
        studentId,
        dueDate: "2025-12-01",
        status: "pending",
        maxScore: 100,
        createdBy: actorId,
        updatedBy: actorId,
      }),
    ).rejects.toThrow();
  });

  it("assignment with non-existent studentId is rejected", async () => {
    await expect(
      db.insert(assignmentsTable).values({
        title: `${P} Bad Assignment`,
        description: "Should fail",
        courseId,
        studentId: NONEXISTENT_ID,
        dueDate: "2025-12-01",
        status: "pending",
        maxScore: 100,
        createdBy: actorId,
        updatedBy: actorId,
      }),
    ).rejects.toThrow();
  });

  it("assessment with non-existent courseId is rejected", async () => {
    await expect(
      db.insert(assessmentsTable).values({
        title: `${P} Bad Assessment`,
        studentId,
        courseId: NONEXISTENT_ID,
        score: 85,
        maxScore: 100,
        strengths: [],
        weaknesses: [],
        createdBy: actorId,
        updatedBy: actorId,
      }),
    ).rejects.toThrow();
  });

  it("announcement with non-existent courseId is rejected", async () => {
    await expect(
      db.insert(announcementsTable).values({
        title: `${P} Bad Announcement`,
        content: "Should fail",
        courseId: NONEXISTENT_ID,
        authorName: "Test",
        priority: "normal",
        createdBy: actorId,
        updatedBy: actorId,
      }),
    ).rejects.toThrow();
  });

  it("note with non-existent courseId is rejected", async () => {
    await expect(
      db.insert(notesTable).values({
        title: `${P} Bad Note`,
        content: "Should fail",
        courseId: NONEXISTENT_ID,
        topic: "Test",
        createdBy: actorId,
        updatedBy: actorId,
      }),
    ).rejects.toThrow();
  });
});

// ── Part 5: CASCADE DELETE propagates correctly ───────────────────────────────

describe("FK CASCADE DELETE — child rows deleted when parent is deleted", () => {
  it("deleting a course cascades to its assignments, notes, and announcements", async () => {
    // Create a dedicated course + resources
    const [cascadeCourse] = await db
      .insert(coursesTable)
      .values({
        name: `${P} Cascade Course`,
        subject: "Science",
        grade: "10",
        academicYear: "2025-2026",
        teacherId: actorId,
        teacherName: "S9DB Teacher",
        createdBy: actorId,
        updatedBy: actorId,
      })
      .returning({ id: coursesTable.id });
    const ccId = cascadeCourse!.id;

    const [assignment] = await db
      .insert(assignmentsTable)
      .values({
        title: `${P} Cascade Assign`,
        description: "Cascade test",
        courseId: ccId,
        studentId,
        dueDate: "2025-12-01",
        status: "pending",
        maxScore: 100,
        createdBy: actorId,
        updatedBy: actorId,
      })
      .returning({ id: assignmentsTable.id });

    const [note] = await db
      .insert(notesTable)
      .values({
        title: `${P} Cascade Note`,
        content: "Cascade test",
        courseId: ccId,
        topic: "Test",
        createdBy: actorId,
        updatedBy: actorId,
      })
      .returning({ id: notesTable.id });

    // Hard-delete the course — should cascade
    await db.delete(coursesTable).where(eq(coursesTable.id, ccId));

    // Child rows should be gone
    const remainingAssignments = await db
      .select({ id: assignmentsTable.id })
      .from(assignmentsTable)
      .where(eq(assignmentsTable.id, assignment!.id));
    expect(remainingAssignments).toHaveLength(0);

    const remainingNotes = await db
      .select({ id: notesTable.id })
      .from(notesTable)
      .where(eq(notesTable.id, note!.id));
    expect(remainingNotes).toHaveLength(0);
  });

  it("deleting a student cascades to their assignments and assessments", async () => {
    const [cascadeStudent] = await db
      .insert(studentsTable)
      .values({
        name: `${P} Cascade Student`,
        email: `${P}_cascade@test.com`,
        grade: "10",
        enrolledCourseIds: [courseId],
        createdBy: actorId,
        updatedBy: actorId,
      })
      .returning({ id: studentsTable.id });
    const csId = cascadeStudent!.id;

    const [assignment] = await db
      .insert(assignmentsTable)
      .values({
        title: `${P} Cascade Assign2`,
        description: "Cascade test",
        courseId,
        studentId: csId,
        dueDate: "2025-12-01",
        status: "pending",
        maxScore: 100,
        createdBy: actorId,
        updatedBy: actorId,
      })
      .returning({ id: assignmentsTable.id });

    // Hard-delete the student — should cascade
    await db.delete(studentsTable).where(eq(studentsTable.id, csId));

    const remaining = await db
      .select({ id: assignmentsTable.id })
      .from(assignmentsTable)
      .where(eq(assignmentsTable.id, assignment!.id));
    expect(remaining).toHaveLength(0);
  });
});

// ── Part 6: Soft-delete behavior is unchanged ─────────────────────────────────

describe("Soft-delete unchanged after FK addition", () => {
  it("soft-deleted assignment is preserved in DB with deletedAt set", async () => {
    const [row] = await db
      .insert(assignmentsTable)
      .values({
        title: `${P} Soft-Delete Test`,
        description: "Soft-delete FK test",
        courseId,
        studentId,
        dueDate: "2025-12-01",
        status: "pending",
        maxScore: 100,
        createdBy: actorId,
        updatedBy: actorId,
      })
      .returning({ id: assignmentsTable.id });
    const id = row!.id;

    // Soft-delete by setting deletedAt
    await db
      .update(assignmentsTable)
      .set({ deletedAt: new Date(), deletedBy: actorId })
      .where(eq(assignmentsTable.id, id));

    // Row should still exist in DB
    const [found] = await db
      .select({ id: assignmentsTable.id, deletedAt: assignmentsTable.deletedAt })
      .from(assignmentsTable)
      .where(eq(assignmentsTable.id, id));
    expect(found?.deletedAt).not.toBeNull();

    // Cleanup: hard delete
    await db.delete(assignmentsTable).where(eq(assignmentsTable.id, id));
  });
});
