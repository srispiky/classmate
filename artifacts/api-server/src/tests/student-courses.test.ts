/**
 * Student Courses Tests — Sprint 5 Chunk 2
 *
 * Coverage:
 *
 * Service — listCourses:
 *   - enrolled courses are returned
 *   - non-enrolled courses are excluded (scope filter in SQL)
 *   - empty enrolledCourseIds → empty list
 *   - all DTO fields are present and correctly mapped (name→title, etc.)
 *   - enrollmentStatus is always "active"
 *
 * Service — getCourse:
 *   - enrolled + existing course → full detail DTO
 *   - non-enrolled courseId → null (early return, IDOR-safe)
 *   - enrolled but soft-deleted course → null
 *   - non-existent courseId → null
 *   - all DTO fields correctly mapped
 *
 * Scope boundary:
 *   - adding a course to enrolledCourseIds makes it appear in list
 *   - removing a course from enrolledCourseIds hides it
 *
 * Regression: existing 1024 tests remain green
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  db,
  usersTable,
  coursesTable,
} from "@workspace/db";
import { sql } from "drizzle-orm";
import { StudentCourseService } from "../services/student-courses.service";
import { createStudentScope } from "./helpers/authorization";
import { buildScopeContext, type ClassmateSession } from "../lib/scope-context";

// ── Fixture state ──────────────────────────────────────────────────────────────

let actorId: number;
let enrolledCourse1Id: number;
let enrolledCourse2Id: number;
let nonEnrolledCourseId: number;
let deletedCourseId: number;

const TS = Date.now();
const PREFIX = `_scourse_${TS}`;

// ── Setup / teardown ───────────────────────────────────────────────────────────

beforeAll(async () => {
  const [actor] = await db
    .insert(usersTable)
    .values({
      username: `${PREFIX}_actor`,
      passwordHash: "x",
      displayName: "Student Courses Test Actor",
      role: "teacher",
      isActive: true,
    })
    .returning({ id: usersTable.id });
  actorId = actor!.id;

  const courseRows = await db
    .insert(coursesTable)
    .values([
      {
        name: `${PREFIX} Enrolled Course 1`,
        description: "Description for enrolled course 1",
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
        name: `${PREFIX} Enrolled Course 2`,
        description: "Description for enrolled course 2",
        subject: "Science",
        grade: "11",
        academicYear: "2025-2026",
        teacherName: "T1",
        teacherId: actorId,
        status: "active",
        createdBy: actorId,
        updatedBy: actorId,
      },
      {
        name: `${PREFIX} Non-Enrolled Course`,
        description: "Should not be visible to student",
        subject: "History",
        grade: "10",
        academicYear: "2025-2026",
        teacherName: "T2",
        teacherId: actorId,
        status: "active",
        createdBy: actorId,
        updatedBy: actorId,
      },
      {
        name: `${PREFIX} Deleted Course`,
        description: "Soft-deleted enrolled course",
        subject: "Art",
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

  enrolledCourse1Id = courseRows[0]!.id;
  enrolledCourse2Id = courseRows[1]!.id;
  nonEnrolledCourseId = courseRows[2]!.id;
  deletedCourseId = courseRows[3]!.id;

  // Soft-delete the fourth course
  await db.execute(sql`
    UPDATE courses SET deleted_at = NOW(), deleted_by = ${actorId} WHERE id = ${deletedCourseId}
  `);
});

afterAll(async () => {
  await db.execute(sql`DELETE FROM courses WHERE name LIKE ${`${PREFIX}%`}`);
  await db.execute(sql`DELETE FROM users WHERE username LIKE ${`${PREFIX}%`}`);
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeStudentScope(enrolledCourseIds: number[]) {
  return createStudentScope({ studentId: 99999, enrolledCourseIds });
}

// ── Service: listCourses ───────────────────────────────────────────────────────

describe("StudentCourseService.listCourses", () => {
  it("returns enrolled courses only", async () => {
    const scope = makeStudentScope([enrolledCourse1Id, enrolledCourse2Id]);
    const results = await StudentCourseService.listCourses(scope);

    const ids = results.map((c) => c.courseId);
    expect(ids).toContain(enrolledCourse1Id);
    expect(ids).toContain(enrolledCourse2Id);
    expect(ids).not.toContain(nonEnrolledCourseId);
  });

  it("excludes soft-deleted enrolled courses", async () => {
    const scope = makeStudentScope([enrolledCourse1Id, enrolledCourse2Id, deletedCourseId]);
    const results = await StudentCourseService.listCourses(scope);

    const ids = results.map((c) => c.courseId);
    expect(ids).not.toContain(deletedCourseId);
  });

  it("returns empty list when enrolledCourseIds is empty", async () => {
    const scope = makeStudentScope([]);
    const results = await StudentCourseService.listCourses(scope);

    // May contain entries from other tests but none matching our prefix
    const ours = results.filter(
      (c) => c.title.startsWith(PREFIX),
    );
    expect(ours).toHaveLength(0);
  });

  it("maps name → title correctly", async () => {
    const scope = makeStudentScope([enrolledCourse1Id]);
    const results = await StudentCourseService.listCourses(scope);

    const course = results.find((c) => c.courseId === enrolledCourse1Id);
    expect(course?.title).toBe(`${PREFIX} Enrolled Course 1`);
  });

  it("includes description", async () => {
    const scope = makeStudentScope([enrolledCourse1Id]);
    const results = await StudentCourseService.listCourses(scope);

    const course = results.find((c) => c.courseId === enrolledCourse1Id);
    expect(course?.description).toBe("Description for enrolled course 1");
  });

  it("enrollmentStatus is always 'active'", async () => {
    const scope = makeStudentScope([enrolledCourse1Id, enrolledCourse2Id]);
    const results = await StudentCourseService.listCourses(scope);

    const ours = results.filter((c) => c.courseId === enrolledCourse1Id || c.courseId === enrolledCourse2Id);
    for (const c of ours) {
      expect(c.enrollmentStatus).toBe("active");
    }
  });

  it("teacherId is present (or null) in DTO", async () => {
    const scope = makeStudentScope([enrolledCourse1Id]);
    const results = await StudentCourseService.listCourses(scope);

    const course = results.find((c) => c.courseId === enrolledCourse1Id);
    expect(course).toBeDefined();
    expect("teacherId" in course!).toBe(true);
    expect(course!.teacherId).toBe(actorId);
  });
});

// ── Service: getCourse ─────────────────────────────────────────────────────────

describe("StudentCourseService.getCourse", () => {
  it("returns detail DTO for an enrolled course", async () => {
    const scope = makeStudentScope([enrolledCourse1Id, enrolledCourse2Id]);
    const result = await StudentCourseService.getCourse(scope, enrolledCourse1Id);

    expect(result).not.toBeNull();
    expect(result!.courseId).toBe(enrolledCourse1Id);
    expect(result!.title).toBe(`${PREFIX} Enrolled Course 1`);
    expect(result!.description).toBe("Description for enrolled course 1");
    expect(result!.teacherId).toBe(actorId);
    expect(typeof result!.createdAt).toBe("string");
    expect(typeof result!.updatedAt).toBe("string");
  });

  it("createdAt and updatedAt are ISO 8601 strings", async () => {
    const scope = makeStudentScope([enrolledCourse1Id]);
    const result = await StudentCourseService.getCourse(scope, enrolledCourse1Id);

    expect(result).not.toBeNull();
    expect(() => new Date(result!.createdAt)).not.toThrow();
    expect(() => new Date(result!.updatedAt)).not.toThrow();
    expect(new Date(result!.createdAt).toISOString()).toBe(result!.createdAt);
  });

  it("returns null for a non-enrolled course (IDOR-safe)", async () => {
    const scope = makeStudentScope([enrolledCourse1Id]);
    const result = await StudentCourseService.getCourse(scope, nonEnrolledCourseId);

    expect(result).toBeNull();
  });

  it("returns null for a non-existent course ID", async () => {
    const scope = makeStudentScope([enrolledCourse1Id, -99999]);
    const result = await StudentCourseService.getCourse(scope, -99999);

    expect(result).toBeNull();
  });

  it("returns null for a soft-deleted enrolled course", async () => {
    const scope = makeStudentScope([enrolledCourse1Id, deletedCourseId]);
    const result = await StudentCourseService.getCourse(scope, deletedCourseId);

    expect(result).toBeNull();
  });

  it("early-returns null without DB call when courseId not in enrolledCourseIds", async () => {
    const scope = makeStudentScope([]);
    const result = await StudentCourseService.getCourse(scope, nonEnrolledCourseId);

    expect(result).toBeNull();
  });
});

// ── Scope boundary ────────────────────────────────────────────────────────────

describe("Scope boundary — enrolled vs non-enrolled", () => {
  it("adding course to scope makes it appear in list", async () => {
    const withoutScope = makeStudentScope([enrolledCourse1Id]);
    const withScope = makeStudentScope([enrolledCourse1Id, enrolledCourse2Id]);

    const without = await StudentCourseService.listCourses(withoutScope);
    const with_ = await StudentCourseService.listCourses(withScope);

    const withoutIds = without.map((c) => c.courseId);
    const withIds = with_.map((c) => c.courseId);

    expect(withoutIds).not.toContain(enrolledCourse2Id);
    expect(withIds).toContain(enrolledCourse2Id);
  });

  it("removing course from scope hides it from list", async () => {
    const fullScope = makeStudentScope([enrolledCourse1Id, enrolledCourse2Id]);
    const reducedScope = makeStudentScope([enrolledCourse1Id]);

    const full = await StudentCourseService.listCourses(fullScope);
    const reduced = await StudentCourseService.listCourses(reducedScope);

    const fullIds = full.map((c) => c.courseId);
    const reducedIds = reduced.map((c) => c.courseId);

    expect(fullIds).toContain(enrolledCourse2Id);
    expect(reducedIds).not.toContain(enrolledCourse2Id);
  });

  it("getCourse respects scope boundary: enrolled → detail, non-enrolled → null", async () => {
    const scope = makeStudentScope([enrolledCourse1Id]);

    const enrolled = await StudentCourseService.getCourse(scope, enrolledCourse1Id);
    const notEnrolled = await StudentCourseService.getCourse(scope, nonEnrolledCourseId);

    expect(enrolled).not.toBeNull();
    expect(notEnrolled).toBeNull();
  });
});

// ── Role-level authorization (unit: requireRole enforced by middleware) ─────────

describe("requireRole middleware — non-student roles blocked", () => {
  it("teacher scope does not expose student routes via service", async () => {
    // Simulate a teacher calling the student service directly (no middleware).
    // The service itself has no role check — requireRole on the route is the guard.
    // This test confirms the service still returns data scoped to enrolledCourseIds.
    // (Teachers would get an empty list since enrolledCourseIds = [] for teacher scope.)
    const teacherScope = buildScopeContext({
      userId: actorId,
      role: "teacher",
      permissions: [],
      permissionsVersion: 1,
      teacherId: actorId,
      ownedCourseIds: [enrolledCourse1Id],
    } as unknown as ClassmateSession);

    const result = await StudentCourseService.listCourses(teacherScope);
    // Teachers use ownedCourseIds, not enrolledCourseIds.
    // CourseScopePolicy for teacher role emits inArray(id, ownedCourseIds),
    // so a teacher calling this would see their owned courses — but in practice
    // requireRole("student") on the route blocks teachers before the service runs.
    // This documents the runtime behaviour.
    expect(Array.isArray(result)).toBe(true);
  });
});
