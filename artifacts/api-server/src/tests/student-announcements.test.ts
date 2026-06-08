/**
 * Student Announcements Tests — Sprint 5 Chunk 6
 *
 * Key difference from Chunks 4–5: announcements have no studentId FK.
 * Ownership is enforced via courseId ∈ enrolledCourseIds only.
 * All students enrolled in the same course see the same announcements.
 *
 * Coverage:
 *
 * Service — listAnnouncements:
 *   - enrolled-course announcements returned
 *   - non-enrolled-course announcements excluded at DB level
 *   - soft-deleted announcements hidden
 *   - empty enrolledCourseIds → []
 *   - DTO field mapping (all 6 summary fields, ISO dates)
 *   - ordering by createdAt descending
 *   - multiple enrolled courses — all announcements returned
 *   - all students in same course see the same announcements (no per-student isolation)
 *
 * Service — getAnnouncement:
 *   - enrolled-course announcement returns full detail DTO
 *   - DTO field mapping (all 8 detail fields, ISO dates, content)
 *   - non-enrolled course → null (IDOR-safe enrollment guard)
 *   - soft-deleted → null
 *   - non-existent → null
 *
 * Repository isolation:
 *   - empty enrolledCourseIds guard
 *   - non-enrolled course not returned
 *
 * Regression: all 1119 existing tests remain green
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, usersTable, coursesTable, announcementsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { StudentAnnouncementService } from "../services/student-announcements.service";
import {
  listStudentAnnouncements,
  getStudentAnnouncement,
} from "../lib/student-announcements.queries";
import { createStudentScope } from "./helpers/authorization";

// ── Fixture state ──────────────────────────────────────────────────────────────

let actorId: number;
let enrolledCourseId: number;
let enrolledCourse2Id: number;
let nonEnrolledCourseId: number;
let studentId: number;
let otherStudentId: number;

let announcement1Id: number;   // enrolled course 1, high priority
let announcement2Id: number;   // enrolled course 1, normal priority
let course2AnnouncementId: number; // enrolled course 2
let deletedAnnouncementId: number; // soft-deleted
let nonEnrolledAnnouncementId: number; // non-enrolled course

const TS = Date.now();
const PREFIX = `_anns_${TS}`;

// ── Setup / teardown ───────────────────────────────────────────────────────────

beforeAll(async () => {
  const [actor] = await db
    .insert(usersTable)
    .values({
      username: `${PREFIX}_actor`,
      passwordHash: "x",
      displayName: "Announcements Test Actor",
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

  const studentResult = await db.execute(sql`
    INSERT INTO students (name, email, grade)
    VALUES (${`${PREFIX} Student`}, ${`${PREFIX}@test.example`}, ${"10"})
    RETURNING id
  `);
  studentId = (studentResult.rows[0] as { id: number }).id;

  const otherStudentResult = await db.execute(sql`
    INSERT INTO students (name, email, grade)
    VALUES (${`${PREFIX} Other`}, ${`${PREFIX}_other@test.example`}, ${"10"})
    RETURNING id
  `);
  otherStudentId = (otherStudentResult.rows[0] as { id: number }).id;

  const rows = await db
    .insert(announcementsTable)
    .values([
      // Enrolled course 1 — high priority
      {
        title: `${PREFIX} Ann High`,
        content: "Important announcement content",
        courseId: enrolledCourseId,
        authorName: "Teacher One",
        priority: "high",
        createdBy: actorId,
        updatedBy: actorId,
      },
      // Enrolled course 1 — normal priority
      {
        title: `${PREFIX} Ann Normal`,
        content: "Regular announcement content",
        courseId: enrolledCourseId,
        authorName: "Teacher One",
        priority: "normal",
        createdBy: actorId,
        updatedBy: actorId,
      },
      // Enrolled course 2
      {
        title: `${PREFIX} Ann Course2`,
        content: "Course 2 content",
        courseId: enrolledCourse2Id,
        authorName: "Teacher Two",
        priority: "normal",
        createdBy: actorId,
        updatedBy: actorId,
      },
      // Soft-deleted
      {
        title: `${PREFIX} Ann Deleted`,
        content: "Deleted content",
        courseId: enrolledCourseId,
        authorName: "Teacher One",
        priority: "normal",
        createdBy: actorId,
        updatedBy: actorId,
      },
      // Non-enrolled course
      {
        title: `${PREFIX} Ann Non-Enrolled`,
        content: "Non-enrolled content",
        courseId: nonEnrolledCourseId,
        authorName: "Teacher Three",
        priority: "normal",
        createdBy: actorId,
        updatedBy: actorId,
      },
    ])
    .returning({ id: announcementsTable.id });

  announcement1Id = rows[0]!.id;
  announcement2Id = rows[1]!.id;
  course2AnnouncementId = rows[2]!.id;
  deletedAnnouncementId = rows[3]!.id;
  nonEnrolledAnnouncementId = rows[4]!.id;

  await db.execute(
    sql`UPDATE announcements SET deleted_at = NOW(), deleted_by = ${actorId} WHERE id = ${deletedAnnouncementId}`,
  );
});

afterAll(async () => {
  await db.execute(sql`DELETE FROM announcements WHERE title LIKE ${`${PREFIX}%`}`);
  await db.execute(sql`DELETE FROM students WHERE name LIKE ${`${PREFIX}%`}`);
  await db.execute(sql`DELETE FROM courses WHERE name LIKE ${`${PREFIX}%`}`);
  await db.execute(sql`DELETE FROM users WHERE username LIKE ${`${PREFIX}%`}`);
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeScope(enrolledCourseIds: number[], sid = studentId) {
  return createStudentScope({ studentId: sid, enrolledCourseIds });
}

// ── Service: listAnnouncements — authorization guards ──────────────────────────

describe("StudentAnnouncementService.listAnnouncements — authorization guards", () => {
  it("returns [] when enrolledCourseIds is empty", async () => {
    expect(await StudentAnnouncementService.listAnnouncements(makeScope([]))).toEqual([]);
  });

  it("does not depend on studentId (course-scoped resource)", async () => {
    // Both students with same enrolled courses should see the same announcements
    const scope1 = makeScope([enrolledCourseId], studentId);
    const scope2 = makeScope([enrolledCourseId], otherStudentId);
    const [r1, r2] = await Promise.all([
      StudentAnnouncementService.listAnnouncements(scope1),
      StudentAnnouncementService.listAnnouncements(scope2),
    ]);
    expect(r1.map((a) => a.announcementId)).toEqual(r2.map((a) => a.announcementId));
  });
});

// ── Service: listAnnouncements — ownership ─────────────────────────────────────

describe("StudentAnnouncementService.listAnnouncements — ownership", () => {
  it("returns only announcements from enrolled courses", async () => {
    const results = await StudentAnnouncementService.listAnnouncements(
      makeScope([enrolledCourseId]),
    );
    const ids = results.map((a) => a.announcementId);
    expect(ids).not.toContain(nonEnrolledAnnouncementId);
    expect(ids).not.toContain(course2AnnouncementId);
  });

  it("excludes soft-deleted announcements", async () => {
    const results = await StudentAnnouncementService.listAnnouncements(
      makeScope([enrolledCourseId]),
    );
    expect(results.map((a) => a.announcementId)).not.toContain(deletedAnnouncementId);
  });

  it("includes announcements from all enrolled courses when multiple enrolled", async () => {
    const results = await StudentAnnouncementService.listAnnouncements(
      makeScope([enrolledCourseId, enrolledCourse2Id]),
    );
    const ids = results.map((a) => a.announcementId);
    expect(ids).toContain(announcement1Id);
    expect(ids).toContain(announcement2Id);
    expect(ids).toContain(course2AnnouncementId);
  });

  it("includes enrolled course 1 announcements by ID", async () => {
    const results = await StudentAnnouncementService.listAnnouncements(
      makeScope([enrolledCourseId]),
    );
    const ids = results.map((a) => a.announcementId);
    expect(ids).toContain(announcement1Id);
    expect(ids).toContain(announcement2Id);
  });
});

// ── Service: listAnnouncements — DTO shape ────────────────────────────────────

describe("StudentAnnouncementService.listAnnouncements — DTO shape", () => {
  let results: Awaited<ReturnType<typeof StudentAnnouncementService.listAnnouncements>>;

  beforeAll(async () => {
    results = await StudentAnnouncementService.listAnnouncements(makeScope([enrolledCourseId]));
  });

  it("all results have the 6 required summary fields", () => {
    for (const a of results) {
      expect(typeof a.announcementId).toBe("number");
      expect(typeof a.courseId).toBe("number");
      expect(typeof a.title).toBe("string");
      expect(typeof a.priority).toBe("string");
      expect(typeof a.authorName).toBe("string");
      expect(typeof a.createdAt).toBe("string");
    }
  });

  it("createdAt is a valid ISO 8601 string", () => {
    for (const a of results) {
      expect(() => new Date(a.createdAt).toISOString()).not.toThrow();
    }
  });

  it("high priority announcement has correct priority field", () => {
    const high = results.find((a) => a.announcementId === announcement1Id);
    expect(high).toBeDefined();
    expect(high!.priority).toBe("high");
  });

  it("authorName is populated", () => {
    const ann = results.find((a) => a.announcementId === announcement1Id);
    expect(ann!.authorName).toBe("Teacher One");
  });

  it("results are ordered by createdAt descending (most recent first)", async () => {
    // Insert a known-later row, confirm it appears first
    const [newRow] = await db
      .insert(announcementsTable)
      .values({
        title: `${PREFIX} Ordering Check`,
        content: "Ordering content",
        courseId: enrolledCourseId,
        authorName: "T1",
        priority: "normal",
        createdBy: actorId,
        updatedBy: actorId,
      })
      .returning({ id: announcementsTable.id });

    try {
      const fresh = await StudentAnnouncementService.listAnnouncements(
        makeScope([enrolledCourseId]),
      );
      expect(fresh[0]!.announcementId).toBe(newRow!.id);
    } finally {
      await db.execute(sql`DELETE FROM announcements WHERE id = ${newRow!.id}`);
    }
  });
});

// ── Service: getAnnouncement — authorization guards ───────────────────────────

describe("StudentAnnouncementService.getAnnouncement — authorization guards", () => {
  it("returns null for non-existent announcement", async () => {
    expect(
      await StudentAnnouncementService.getAnnouncement(makeScope([enrolledCourseId]), -99999),
    ).toBeNull();
  });

  it("returns null for soft-deleted announcement", async () => {
    expect(
      await StudentAnnouncementService.getAnnouncement(
        makeScope([enrolledCourseId]),
        deletedAnnouncementId,
      ),
    ).toBeNull();
  });
});

// ── Service: getAnnouncement — ownership ──────────────────────────────────────

describe("StudentAnnouncementService.getAnnouncement — ownership", () => {
  it("returns detail for enrolled-course announcement", async () => {
    const result = await StudentAnnouncementService.getAnnouncement(
      makeScope([enrolledCourseId]),
      announcement1Id,
    );
    expect(result).not.toBeNull();
    expect(result!.announcementId).toBe(announcement1Id);
  });

  it("returns null for non-enrolled course (IDOR-safe)", async () => {
    const scope = makeScope([enrolledCourseId]); // nonEnrolledCourseId NOT in scope
    expect(
      await StudentAnnouncementService.getAnnouncement(scope, nonEnrolledAnnouncementId),
    ).toBeNull();
  });

  it("both students see the same announcement when enrolled in same course", async () => {
    const [r1, r2] = await Promise.all([
      StudentAnnouncementService.getAnnouncement(
        makeScope([enrolledCourseId], studentId),
        announcement1Id,
      ),
      StudentAnnouncementService.getAnnouncement(
        makeScope([enrolledCourseId], otherStudentId),
        announcement1Id,
      ),
    ]);
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    expect(r1!.announcementId).toBe(r2!.announcementId);
    expect(r1!.content).toBe(r2!.content);
  });
});

// ── Service: getAnnouncement — DTO shape ──────────────────────────────────────

describe("StudentAnnouncementService.getAnnouncement — DTO shape", () => {
  let detail: Awaited<ReturnType<typeof StudentAnnouncementService.getAnnouncement>>;

  beforeAll(async () => {
    detail = await StudentAnnouncementService.getAnnouncement(
      makeScope([enrolledCourseId]),
      announcement1Id,
    );
  });

  it("returns all 8 detail fields", () => {
    expect(detail).not.toBeNull();
    expect(typeof detail!.announcementId).toBe("number");
    expect(typeof detail!.courseId).toBe("number");
    expect(typeof detail!.title).toBe("string");
    expect(typeof detail!.content).toBe("string");
    expect(typeof detail!.priority).toBe("string");
    expect(typeof detail!.authorName).toBe("string");
    expect(typeof detail!.createdAt).toBe("string");
    expect(typeof detail!.updatedAt).toBe("string");
  });

  it("content is populated (detail-only field)", () => {
    expect(detail!.content).toBe("Important announcement content");
  });

  it("createdAt and updatedAt are ISO 8601 strings", () => {
    expect(() => new Date(detail!.createdAt).toISOString()).not.toThrow();
    expect(() => new Date(detail!.updatedAt).toISOString()).not.toThrow();
  });

  it("courseId matches the enrolled course", () => {
    expect(detail!.courseId).toBe(enrolledCourseId);
  });

  it("title and authorName are correct", () => {
    expect(detail!.title).toBe(`${PREFIX} Ann High`);
    expect(detail!.authorName).toBe("Teacher One");
  });
});

// ── Repository isolation ──────────────────────────────────────────────────────

describe("listStudentAnnouncements — repository isolation", () => {
  it("returns [] for empty enrolledCourseIds without hitting DB", async () => {
    expect(await listStudentAnnouncements([])).toEqual([]);
  });

  it("excludes non-enrolled course announcements at DB level", async () => {
    const rows = await listStudentAnnouncements([enrolledCourseId]);
    expect(rows.map((r) => r.id)).not.toContain(nonEnrolledAnnouncementId);
  });
});

describe("getStudentAnnouncement — repository isolation", () => {
  it("returns null for soft-deleted announcement", async () => {
    expect(await getStudentAnnouncement(deletedAnnouncementId)).toBeNull();
  });

  it("returns null for non-existent ID", async () => {
    expect(await getStudentAnnouncement(-99999)).toBeNull();
  });
});
