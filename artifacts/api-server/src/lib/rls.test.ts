import { describe, it, expect } from "vitest";
import { buildScopeContext, type ClassmateSession } from "./scope-context";
import { studentIdScopeFilter, courseIdScopeFilter, parentCourseEnrollmentFilter, SQL_FALSE } from "./scope-filter";
import { canAccessStudentResource, canAccessCourseResource } from "./ownership";

// ── Helpers ─────────────────────────────────────────────────────────────────

function session(overrides: Partial<ClassmateSession>): ClassmateSession {
  return { userId: 1, role: "admin", permissions: [], permissionsVersion: 0, ...overrides };
}

/**
 * Minimal Column stand-in that satisfies Drizzle's Column type structurally.
 * Used only to verify the scope filter returns / does not return undefined.
 * The actual SQL generated is exercised in integration tests.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MOCK_COLUMN = { name: "student_id", table: { _: {} } } as any;

// ── studentIdScopeFilter ─────────────────────────────────────────────────────

describe("studentIdScopeFilter", () => {
  it("admin scope — returns undefined (no filter applied)", () => {
    const scope = buildScopeContext(session({ role: "admin" }));
    expect(studentIdScopeFilter(MOCK_COLUMN, scope)).toBeUndefined();
  });

  it("teacher scope — returns undefined (no filter applied)", () => {
    const scope = buildScopeContext(session({ role: "teacher" }));
    expect(studentIdScopeFilter(MOCK_COLUMN, scope)).toBeUndefined();
  });

  it("student scope — returns SQL condition (non-null)", () => {
    const scope = buildScopeContext(session({ role: "student", studentId: 5, enrolledCourseIds: [1] }));
    const filter = studentIdScopeFilter(MOCK_COLUMN, scope);
    expect(filter).toBeDefined();
    expect(filter).not.toBe(SQL_FALSE);
  });

  it("parent scope — returns SQL condition (non-null)", () => {
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: [7, 12] }));
    const filter = studentIdScopeFilter(MOCK_COLUMN, scope);
    expect(filter).toBeDefined();
    expect(filter).not.toBe(SQL_FALSE);
  });

  it("empty childStudentIds — returns SQL_FALSE (parent with no linked children)", () => {
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: [] }));
    expect(studentIdScopeFilter(MOCK_COLUMN, scope)).toBe(SQL_FALSE);
  });

  it("unlinked student (studentId=null) — returns SQL_FALSE", () => {
    const scope = buildScopeContext(session({ role: "student" }));
    expect(studentIdScopeFilter(MOCK_COLUMN, scope)).toBe(SQL_FALSE);
  });
});

// ── courseIdScopeFilter ──────────────────────────────────────────────────────

describe("courseIdScopeFilter", () => {
  it("admin scope — returns undefined", () => {
    const scope = buildScopeContext(session({ role: "admin" }));
    expect(courseIdScopeFilter(MOCK_COLUMN, scope)).toBeUndefined();
  });

  it("teacher scope — returns undefined", () => {
    const scope = buildScopeContext(session({ role: "teacher" }));
    expect(courseIdScopeFilter(MOCK_COLUMN, scope)).toBeUndefined();
  });

  it("student scope — returns SQL condition for enrolled courses", () => {
    const scope = buildScopeContext(session({ role: "student", studentId: 3, enrolledCourseIds: [2, 4] }));
    const filter = courseIdScopeFilter(MOCK_COLUMN, scope);
    expect(filter).toBeDefined();
    expect(filter).not.toBe(SQL_FALSE);
  });

  it("empty enrolledCourseIds — returns SQL_FALSE", () => {
    const scope = buildScopeContext(session({ role: "student", studentId: 3, enrolledCourseIds: [] }));
    expect(courseIdScopeFilter(MOCK_COLUMN, scope)).toBe(SQL_FALSE);
  });

  it("parent scope with childCourseIds — returns SQL condition (inArray, not SQL_FALSE)", () => {
    // childCourseIds is now pre-computed by SessionEnricher (Sprint 3 §9e refactor).
    // courseIdScopeFilter handles parent directly — no subquery needed at query time.
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: [7], childCourseIds: [2, 5] }));
    const filter = courseIdScopeFilter(MOCK_COLUMN, scope);
    expect(filter).toBeDefined();
    expect(filter).not.toBe(SQL_FALSE);
  });

  it("parent scope with empty childCourseIds — returns SQL_FALSE", () => {
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: [7], childCourseIds: [] }));
    expect(courseIdScopeFilter(MOCK_COLUMN, scope)).toBe(SQL_FALSE);
  });

  it("parentCourseEnrollmentFilter with empty childStudentIds — returns SQL_FALSE", () => {
    expect(parentCourseEnrollmentFilter(MOCK_COLUMN, [])).toBe(SQL_FALSE);
  });

  it("parentCourseEnrollmentFilter with child IDs — returns defined SQL", () => {
    const result = parentCourseEnrollmentFilter(MOCK_COLUMN, [7, 12]);
    expect(result).toBeDefined();
    expect(result).not.toBe(SQL_FALSE);
  });
});

// ── canAccessStudentResource (Layer 3) ───────────────────────────────────────

describe("canAccessStudentResource", () => {
  it("admin — always allowed regardless of resourceStudentId", () => {
    const scope = buildScopeContext(session({ role: "admin" }));
    expect(canAccessStudentResource(99, scope)).toBe("allowed");
    expect(canAccessStudentResource(null, scope)).toBe("allowed");
  });

  it("teacher — always allowed", () => {
    const scope = buildScopeContext(session({ role: "teacher" }));
    expect(canAccessStudentResource(5, scope)).toBe("allowed");
  });

  it("student — ownership allowed when resourceStudentId matches scope.studentId", () => {
    const scope = buildScopeContext(session({ role: "student", studentId: 5 }));
    expect(canAccessStudentResource(5, scope)).toBe("allowed");
  });

  it("student — ownership denied when resourceStudentId does not match", () => {
    const scope = buildScopeContext(session({ role: "student", studentId: 5 }));
    expect(canAccessStudentResource(9, scope)).toBe("denied");
  });

  it("parent — ownership allowed when resourceStudentId is in childStudentIds", () => {
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: [7, 12] }));
    expect(canAccessStudentResource(12, scope)).toBe("allowed");
  });

  it("parent — ownership denied when resourceStudentId is NOT in childStudentIds", () => {
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: [7, 12] }));
    expect(canAccessStudentResource(99, scope)).toBe("denied");
  });

  it("parent — empty childStudentIds always denied", () => {
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: [] }));
    expect(canAccessStudentResource(7, scope)).toBe("denied");
  });

  it("resourceStudentId=null — always denied for non-global roles", () => {
    const studentScope = buildScopeContext(session({ role: "student", studentId: 5 }));
    const parentScope = buildScopeContext(session({ role: "parent", childStudentIds: [5] }));
    expect(canAccessStudentResource(null, studentScope)).toBe("denied");
    expect(canAccessStudentResource(null, parentScope)).toBe("denied");
  });
});

// ── canAccessCourseResource (Layer 3) ────────────────────────────────────────

describe("canAccessCourseResource", () => {
  it("admin — always allowed", () => {
    const scope = buildScopeContext(session({ role: "admin" }));
    expect(canAccessCourseResource(3, scope)).toBe("allowed");
  });

  it("student — allowed when resourceCourseId is in enrolledCourseIds", () => {
    const scope = buildScopeContext(session({ role: "student", studentId: 1, enrolledCourseIds: [2, 5] }));
    expect(canAccessCourseResource(5, scope)).toBe("allowed");
  });

  it("student — denied when resourceCourseId is not enrolled", () => {
    const scope = buildScopeContext(session({ role: "student", studentId: 1, enrolledCourseIds: [2, 5] }));
    expect(canAccessCourseResource(9, scope)).toBe("denied");
  });

  it("parent — allowed (Layer 2 subquery already filtered; no childEnrolledCourseIds in scope)", () => {
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: [7] }));
    expect(canAccessCourseResource(3, scope)).toBe("allowed");
  });
});
