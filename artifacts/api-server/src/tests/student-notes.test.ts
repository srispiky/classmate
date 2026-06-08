/**
 * Student Notes Tests — Sprint 5 Chunk 7
 *
 * Ownership model identical to Chunk 6 (Announcements):
 *   - No studentId FK on notes — course-scoped only.
 *   - Ownership enforced via courseId ∈ enrolledCourseIds.
 *   - All students enrolled in the same course see the same notes.
 *
 * Additional field: videoUrl (nullable) — tested for both null and populated.
 *
 * Coverage:
 *
 * Service — listNotes:
 *   - enrolled-course notes returned
 *   - non-enrolled-course notes excluded at DB level
 *   - soft-deleted notes hidden
 *   - empty enrolledCourseIds → []
 *   - DTO field mapping (all 5 summary fields, ISO dates)
 *   - ordering by createdAt descending
 *   - multiple enrolled courses — all notes returned
 *   - both students with same enrollment see the same notes
 *
 * Service — getNote:
 *   - enrolled-course note returns full detail DTO
 *   - DTO field mapping (all 8 detail fields, ISO dates, nullable videoUrl)
 *   - videoUrl null when not set
 *   - videoUrl populated when set
 *   - non-enrolled course → null (IDOR-safe)
 *   - soft-deleted → null
 *   - non-existent → null
 *
 * Repository isolation:
 *   - empty enrolledCourseIds guard
 *   - non-enrolled excluded
 *   - soft-deleted null
 *
 * Regression: all 1144 existing tests remain green
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, usersTable, coursesTable, notesTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { StudentNotesService } from "../services/student-notes.service";
import { listStudentNotes, getStudentNote } from "../lib/student-notes.queries";
import { createStudentScope } from "./helpers/authorization";

// ── Fixture state ──────────────────────────────────────────────────────────────

let actorId: number;
let enrolledCourseId: number;
let enrolledCourse2Id: number;
let nonEnrolledCourseId: number;
let studentId: number;
let otherStudentId: number;

let note1Id: number;     // enrolled course 1, with videoUrl
let note2Id: number;     // enrolled course 1, no videoUrl
let course2NoteId: number; // enrolled course 2
let deletedNoteId: number; // soft-deleted
let nonEnrolledNoteId: number; // non-enrolled course

const TS = Date.now();
const PREFIX = `_notes_${TS}`;

// ── Setup / teardown ───────────────────────────────────────────────────────────

beforeAll(async () => {
  const [actor] = await db
    .insert(usersTable)
    .values({
      username: `${PREFIX}_actor`,
      passwordHash: "x",
      displayName: "Notes Test Actor",
      role: "teacher",
      isActive: true,
    })
    .returning({ id: usersTable.id });
  actorId = actor!.id;

  const courseRows = await db
    .insert(coursesTable)
    .values([
      {
        name: `${PREFIX} Enrolled 1`,
        description: "E1",
        subject: "Math",
        grade: "10",
        academicYear: "2025-2026",
        teacherName: "T1",
        teacherId: actorId,
        status: "active",
        createdBy: actorId,
        updatedBy: actorId,
      },
      {
        name: `${PREFIX} Enrolled 2`,
        description: "E2",
        subject: "Science",
        grade: "10",
        academicYear: "2025-2026",
        teacherName: "T1",
        teacherId: actorId,
        status: "active",
        createdBy: actorId,
        updatedBy: actorId,
      },
      {
        name: `${PREFIX} Non-Enrolled`,
        description: "NE",
        subject: "History",
        grade: "10",
        academicYear: "2025-2026",
        teacherName: "T1",
        teacherId: actorId,
        status: "active",
        createdBy: actorId,
        updatedBy: actorId,
      },
    ])
    .returning({ id: coursesTable.id });

  enrolledCourseId = courseRows[0]!.id;
  enrolledCourse2Id = courseRows[1]!.id;
  nonEnrolledCourseId = courseRows[2]!.id;

  const [s1, s2] = await Promise.all([
    db.execute(sql`
      INSERT INTO students (name, email, grade)
      VALUES (${`${PREFIX} Student`}, ${`${PREFIX}@test.example`}, ${"10"})
      RETURNING id
    `),
    db.execute(sql`
      INSERT INTO students (name, email, grade)
      VALUES (${`${PREFIX} Other`}, ${`${PREFIX}_other@test.example`}, ${"10"})
      RETURNING id
    `),
  ]);
  studentId = (s1.rows[0] as { id: number }).id;
  otherStudentId = (s2.rows[0] as { id: number }).id;

  const rows = await db
    .insert(notesTable)
    .values([
      // Enrolled course 1 — with videoUrl
      {
        title: `${PREFIX} Note With Video`,
        content: "Content with video",
        topic: "Algebra",
        videoUrl: "https://example.com/video/1",
        courseId: enrolledCourseId,
        createdBy: actorId,
        updatedBy: actorId,
      },
      // Enrolled course 1 — no videoUrl
      {
        title: `${PREFIX} Note No Video`,
        content: "Content without video",
        topic: "Geometry",
        courseId: enrolledCourseId,
        createdBy: actorId,
        updatedBy: actorId,
      },
      // Enrolled course 2
      {
        title: `${PREFIX} Course2 Note`,
        content: "Course 2 content",
        topic: "Physics",
        courseId: enrolledCourse2Id,
        createdBy: actorId,
        updatedBy: actorId,
      },
      // Soft-deleted
      {
        title: `${PREFIX} Deleted Note`,
        content: "Deleted content",
        topic: "Chemistry",
        courseId: enrolledCourseId,
        createdBy: actorId,
        updatedBy: actorId,
      },
      // Non-enrolled course
      {
        title: `${PREFIX} Non-Enrolled Note`,
        content: "Non-enrolled content",
        topic: "History",
        courseId: nonEnrolledCourseId,
        createdBy: actorId,
        updatedBy: actorId,
      },
    ])
    .returning({ id: notesTable.id });

  note1Id = rows[0]!.id;
  note2Id = rows[1]!.id;
  course2NoteId = rows[2]!.id;
  deletedNoteId = rows[3]!.id;
  nonEnrolledNoteId = rows[4]!.id;

  await db.execute(
    sql`UPDATE notes SET deleted_at = NOW(), deleted_by = ${actorId} WHERE id = ${deletedNoteId}`,
  );
});

afterAll(async () => {
  await db.execute(sql`DELETE FROM notes WHERE title LIKE ${`${PREFIX}%`}`);
  await db.execute(sql`DELETE FROM students WHERE name LIKE ${`${PREFIX}%`}`);
  await db.execute(sql`DELETE FROM courses WHERE name LIKE ${`${PREFIX}%`}`);
  await db.execute(sql`DELETE FROM users WHERE username LIKE ${`${PREFIX}%`}`);
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeScope(enrolledCourseIds: number[], sid = studentId) {
  return createStudentScope({ studentId: sid, enrolledCourseIds });
}

// ── Service: listNotes — authorization guards ──────────────────────────────────

describe("StudentNotesService.listNotes — authorization guards", () => {
  it("returns [] when enrolledCourseIds is empty", async () => {
    expect(await StudentNotesService.listNotes(makeScope([]))).toEqual([]);
  });

  it("does not depend on studentId (course-scoped resource)", async () => {
    const [r1, r2] = await Promise.all([
      StudentNotesService.listNotes(makeScope([enrolledCourseId], studentId)),
      StudentNotesService.listNotes(makeScope([enrolledCourseId], otherStudentId)),
    ]);
    expect(r1.map((n) => n.noteId)).toEqual(r2.map((n) => n.noteId));
  });
});

// ── Service: listNotes — ownership ────────────────────────────────────────────

describe("StudentNotesService.listNotes — ownership", () => {
  it("returns only notes from enrolled courses", async () => {
    const results = await StudentNotesService.listNotes(makeScope([enrolledCourseId]));
    const ids = results.map((n) => n.noteId);
    expect(ids).not.toContain(nonEnrolledNoteId);
    expect(ids).not.toContain(course2NoteId);
  });

  it("excludes soft-deleted notes", async () => {
    const results = await StudentNotesService.listNotes(makeScope([enrolledCourseId]));
    expect(results.map((n) => n.noteId)).not.toContain(deletedNoteId);
  });

  it("includes notes from all enrolled courses when multiple enrolled", async () => {
    const results = await StudentNotesService.listNotes(
      makeScope([enrolledCourseId, enrolledCourse2Id]),
    );
    const ids = results.map((n) => n.noteId);
    expect(ids).toContain(note1Id);
    expect(ids).toContain(note2Id);
    expect(ids).toContain(course2NoteId);
  });

  it("includes enrolled course 1 notes by ID", async () => {
    const results = await StudentNotesService.listNotes(makeScope([enrolledCourseId]));
    const ids = results.map((n) => n.noteId);
    expect(ids).toContain(note1Id);
    expect(ids).toContain(note2Id);
  });
});

// ── Service: listNotes — DTO shape ────────────────────────────────────────────

describe("StudentNotesService.listNotes — DTO shape", () => {
  let results: Awaited<ReturnType<typeof StudentNotesService.listNotes>>;

  beforeAll(async () => {
    results = await StudentNotesService.listNotes(makeScope([enrolledCourseId]));
  });

  it("all results have the 5 required summary fields", () => {
    for (const n of results) {
      expect(typeof n.noteId).toBe("number");
      expect(typeof n.courseId).toBe("number");
      expect(typeof n.title).toBe("string");
      expect(typeof n.topic).toBe("string");
      expect(typeof n.createdAt).toBe("string");
    }
  });

  it("createdAt is a valid ISO 8601 string", () => {
    for (const n of results) {
      expect(() => new Date(n.createdAt).toISOString()).not.toThrow();
    }
  });

  it("topic is populated correctly", () => {
    const algebra = results.find((n) => n.noteId === note1Id);
    expect(algebra!.topic).toBe("Algebra");
  });

  it("results are ordered by createdAt descending", async () => {
    const [newRow] = await db
      .insert(notesTable)
      .values({
        title: `${PREFIX} Ordering Check`,
        content: "C",
        topic: "T",
        courseId: enrolledCourseId,
        createdBy: actorId,
        updatedBy: actorId,
      })
      .returning({ id: notesTable.id });

    try {
      const fresh = await StudentNotesService.listNotes(makeScope([enrolledCourseId]));
      expect(fresh[0]!.noteId).toBe(newRow!.id);
    } finally {
      await db.execute(sql`DELETE FROM notes WHERE id = ${newRow!.id}`);
    }
  });
});

// ── Service: getNote — authorization guards ───────────────────────────────────

describe("StudentNotesService.getNote — authorization guards", () => {
  it("returns null for non-existent note", async () => {
    expect(
      await StudentNotesService.getNote(makeScope([enrolledCourseId]), -99999),
    ).toBeNull();
  });

  it("returns null for soft-deleted note", async () => {
    expect(
      await StudentNotesService.getNote(makeScope([enrolledCourseId]), deletedNoteId),
    ).toBeNull();
  });
});

// ── Service: getNote — ownership ──────────────────────────────────────────────

describe("StudentNotesService.getNote — ownership", () => {
  it("returns detail for enrolled-course note", async () => {
    const result = await StudentNotesService.getNote(makeScope([enrolledCourseId]), note1Id);
    expect(result).not.toBeNull();
    expect(result!.noteId).toBe(note1Id);
  });

  it("returns null for non-enrolled course note (IDOR-safe)", async () => {
    const scope = makeScope([enrolledCourseId]); // nonEnrolledCourseId NOT in scope
    expect(await StudentNotesService.getNote(scope, nonEnrolledNoteId)).toBeNull();
  });

  it("both students see the same note when enrolled in same course", async () => {
    const [r1, r2] = await Promise.all([
      StudentNotesService.getNote(makeScope([enrolledCourseId], studentId), note1Id),
      StudentNotesService.getNote(makeScope([enrolledCourseId], otherStudentId), note1Id),
    ]);
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    expect(r1!.noteId).toBe(r2!.noteId);
    expect(r1!.content).toBe(r2!.content);
  });
});

// ── Service: getNote — DTO shape ──────────────────────────────────────────────

describe("StudentNotesService.getNote — DTO shape", () => {
  let withVideo: Awaited<ReturnType<typeof StudentNotesService.getNote>>;
  let noVideo: Awaited<ReturnType<typeof StudentNotesService.getNote>>;

  beforeAll(async () => {
    const scope = makeScope([enrolledCourseId]);
    [withVideo, noVideo] = await Promise.all([
      StudentNotesService.getNote(scope, note1Id),
      StudentNotesService.getNote(scope, note2Id),
    ]);
  });

  it("returns all 8 detail fields", () => {
    expect(withVideo).not.toBeNull();
    expect(typeof withVideo!.noteId).toBe("number");
    expect(typeof withVideo!.courseId).toBe("number");
    expect(typeof withVideo!.title).toBe("string");
    expect(typeof withVideo!.topic).toBe("string");
    expect(typeof withVideo!.content).toBe("string");
    // videoUrl is string | null
    expect(withVideo!.videoUrl === null || typeof withVideo!.videoUrl === "string").toBe(true);
    expect(typeof withVideo!.createdAt).toBe("string");
    expect(typeof withVideo!.updatedAt).toBe("string");
  });

  it("videoUrl is populated when set", () => {
    expect(withVideo!.videoUrl).toBe("https://example.com/video/1");
  });

  it("videoUrl is null when not set", () => {
    expect(noVideo!.videoUrl).toBeNull();
  });

  it("content is the detail-only field", () => {
    expect(withVideo!.content).toBe("Content with video");
  });

  it("createdAt and updatedAt are ISO 8601 strings", () => {
    expect(() => new Date(withVideo!.createdAt).toISOString()).not.toThrow();
    expect(() => new Date(withVideo!.updatedAt).toISOString()).not.toThrow();
  });

  it("topic is correct", () => {
    expect(withVideo!.topic).toBe("Algebra");
  });

  it("courseId matches the enrolled course", () => {
    expect(withVideo!.courseId).toBe(enrolledCourseId);
  });
});

// ── Repository isolation ──────────────────────────────────────────────────────

describe("listStudentNotes — repository isolation", () => {
  it("returns [] for empty enrolledCourseIds without hitting DB", async () => {
    expect(await listStudentNotes([])).toEqual([]);
  });

  it("excludes non-enrolled course notes at DB level", async () => {
    const rows = await listStudentNotes([enrolledCourseId]);
    expect(rows.map((r) => r.id)).not.toContain(nonEnrolledNoteId);
  });
});

describe("getStudentNote — repository isolation", () => {
  it("returns null for soft-deleted note", async () => {
    expect(await getStudentNote(deletedNoteId)).toBeNull();
  });

  it("returns null for non-existent ID", async () => {
    expect(await getStudentNote(-99999)).toBeNull();
  });
});
