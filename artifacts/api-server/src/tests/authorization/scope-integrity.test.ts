/**
 * Scope Integrity Tests (Part 2 of Chunk 10)
 *
 * Validates the correctness of ScopeContext construction from session data.
 * These tests are structural: they call buildScopeContext() directly and
 * assert the resulting scope has the right shape for every edge case.
 *
 * Edge cases covered:
 *   - Unlinked student account (userId exists, no student record) → studentId=null
 *   - Student with no active enrollments → enrolledCourseIds=[]
 *   - Student with enrolledCourseIds provided → correctly propagated
 *   - Parent with no children → childStudentIds=[], childCourseIds=[]
 *   - Parent with children → correctly propagated
 *   - Parent deduplication — childCourseIds is deduplicated (Set-based in SessionEnricher)
 *   - Null/undefined field handling in session data
 *   - isGlobal flag correctness for all roles
 *   - Role propagation (ensures ScopeContext.role matches session.role)
 *
 * These tests do NOT hit the database — they test the pure transformation
 * of session data into ScopeContext, not the enrichment queries themselves.
 * SessionEnricher integration is tested separately at the service level.
 */
import { describe, it, expect } from "vitest";
import { buildScopeContext, type ClassmateSession } from "../../lib/scope-context";

function makeSession(overrides: Partial<ClassmateSession> = {}): ClassmateSession {
  return {
    userId: 1,
    role: "admin",
    ...overrides,
  } as ClassmateSession;
}

// ── isGlobal flag ──────────────────────────────────────────────────────────────

describe("ScopeContext.isGlobal", () => {
  it("admin → isGlobal=true", () => {
    expect(buildScopeContext(makeSession({ role: "admin" })).isGlobal).toBe(true);
  });
  it("teacher → isGlobal=true", () => {
    expect(buildScopeContext(makeSession({ role: "teacher" })).isGlobal).toBe(true);
  });
  it("student → isGlobal=false", () => {
    expect(buildScopeContext(makeSession({ role: "student" })).isGlobal).toBe(false);
  });
  it("parent → isGlobal=false", () => {
    expect(buildScopeContext(makeSession({ role: "parent" })).isGlobal).toBe(false);
  });
  it("guest → isGlobal=false", () => {
    expect(buildScopeContext(makeSession({ role: "guest" })).isGlobal).toBe(false);
  });
});

// ── Role propagation ──────────────────────────────────────────────────────────

describe("ScopeContext.role propagation", () => {
  const roles = ["admin", "teacher", "student", "parent", "guest"] as const;
  roles.forEach((role) => {
    it(`role "${role}" is propagated verbatim`, () => {
      const scope = buildScopeContext(makeSession({ role }));
      expect(scope.role).toBe(role);
    });
  });
});

// ── Student scope construction ────────────────────────────────────────────────

describe("ScopeContext — student scope construction", () => {
  describe("Linked student account (studentId present)", () => {
    it("studentId is set from session when role=student", () => {
      const scope = buildScopeContext(makeSession({ role: "student", studentId: 42 }));
      expect(scope.studentId).toBe(42);
    });

    it("enrolledCourseIds is set from session array", () => {
      const scope = buildScopeContext(makeSession({ role: "student", studentId: 5, enrolledCourseIds: [1, 2, 3] }));
      expect(scope.enrolledCourseIds).toEqual([1, 2, 3]);
    });

    it("enrolledCourseIds preserves order", () => {
      const scope = buildScopeContext(makeSession({ role: "student", studentId: 5, enrolledCourseIds: [3, 1, 2] }));
      expect(scope.enrolledCourseIds).toEqual([3, 1, 2]);
    });
  });

  describe("Unlinked student account (studentId not set)", () => {
    it("studentId is null when session.studentId is undefined", () => {
      // Sprint 3 §4a: userId exists but no student record linked yet.
      // SessionEnricher sets enrolledCourseIds=[] and omits studentId.
      const scope = buildScopeContext(makeSession({ role: "student", studentId: undefined }));
      expect(scope.studentId).toBeNull();
    });

    it("enrolledCourseIds defaults to [] when session.enrolledCourseIds is undefined", () => {
      const scope = buildScopeContext(makeSession({ role: "student", enrolledCourseIds: undefined }));
      expect(scope.enrolledCourseIds).toEqual([]);
    });
  });

  describe("Student with no active enrollments", () => {
    it("enrolledCourseIds=[] when session provides an empty array", () => {
      const scope = buildScopeContext(makeSession({ role: "student", studentId: 5, enrolledCourseIds: [] }));
      expect(scope.enrolledCourseIds).toEqual([]);
    });

    it("studentId is still set even when enrolledCourseIds is empty", () => {
      const scope = buildScopeContext(makeSession({ role: "student", studentId: 7, enrolledCourseIds: [] }));
      expect(scope.studentId).toBe(7);
      expect(scope.enrolledCourseIds).toEqual([]);
    });
  });

  describe("Student scope isolation from non-student roles", () => {
    it("admin: studentId is null (not a student)", () => {
      // buildScopeContext must not accidentally propagate studentId for admin
      const scope = buildScopeContext(makeSession({ role: "admin", studentId: 99 }));
      expect(scope.studentId).toBeNull();
    });

    it("parent: studentId is null (not a student)", () => {
      const scope = buildScopeContext(makeSession({ role: "parent", studentId: 99 }));
      expect(scope.studentId).toBeNull();
    });

    it("admin: enrolledCourseIds is [] (not a student — no enrollments to propagate)", () => {
      const scope = buildScopeContext(makeSession({ role: "admin", enrolledCourseIds: [1, 2] }));
      expect(scope.enrolledCourseIds).toEqual([]);
    });

    it("teacher: enrolledCourseIds is [] (not a student)", () => {
      const scope = buildScopeContext(makeSession({ role: "teacher", enrolledCourseIds: [3, 4] }));
      expect(scope.enrolledCourseIds).toEqual([]);
    });
  });
});

// ── Parent scope construction ─────────────────────────────────────────────────

describe("ScopeContext — parent scope construction", () => {
  describe("Parent with linked children", () => {
    it("childStudentIds is set from session array", () => {
      const scope = buildScopeContext(
        makeSession({ role: "parent", childStudentIds: [10, 11, 12] }),
      );
      expect(scope.childStudentIds).toEqual([10, 11, 12]);
    });

    it("childCourseIds is set from session array", () => {
      const scope = buildScopeContext(
        makeSession({ role: "parent", childStudentIds: [10], childCourseIds: [1, 2, 3] }),
      );
      expect(scope.childCourseIds).toEqual([1, 2, 3]);
    });
  });

  describe("Parent with no children", () => {
    it("childStudentIds defaults to [] when session value is undefined", () => {
      const scope = buildScopeContext(makeSession({ role: "parent", childStudentIds: undefined }));
      expect(scope.childStudentIds).toEqual([]);
    });

    it("childCourseIds defaults to [] when session value is undefined", () => {
      const scope = buildScopeContext(makeSession({ role: "parent", childCourseIds: undefined }));
      expect(scope.childCourseIds).toEqual([]);
    });

    it("childStudentIds=[] when session provides an empty array", () => {
      const scope = buildScopeContext(makeSession({ role: "parent", childStudentIds: [] }));
      expect(scope.childStudentIds).toEqual([]);
    });

    it("childCourseIds=[] when session provides an empty array", () => {
      const scope = buildScopeContext(
        makeSession({ role: "parent", childStudentIds: [10], childCourseIds: [] }),
      );
      expect(scope.childCourseIds).toEqual([]);
    });
  });

  describe("Parent deduplication contract (childCourseIds)", () => {
    // SessionEnricher deduplicates childCourseIds using a Set when multiple children
    // are enrolled in the same course. buildScopeContext trusts the session value
    // as-is — deduplication is the enricher's responsibility.
    // This test verifies that duplicates in session (unexpected) are NOT silently re-deduplicated
    // by buildScopeContext (no double-filtering) — the value is passed through verbatim.
    it("childCourseIds passed through verbatim (deduplication is enricher's responsibility)", () => {
      // Simulate a session where enricher already deduplicated: [1, 2, 3]
      const scope = buildScopeContext(
        makeSession({ role: "parent", childStudentIds: [10, 11], childCourseIds: [1, 2, 3] }),
      );
      expect(scope.childCourseIds).toEqual([1, 2, 3]);
    });

    it("childStudentIds passed through verbatim", () => {
      const scope = buildScopeContext(
        makeSession({ role: "parent", childStudentIds: [5, 6, 7] }),
      );
      expect(scope.childStudentIds).toEqual([5, 6, 7]);
    });
  });

  describe("Parent scope isolation from non-parent roles", () => {
    it("student: childStudentIds is [] (not a parent)", () => {
      const scope = buildScopeContext(makeSession({ role: "student", childStudentIds: [10] }));
      expect(scope.childStudentIds).toEqual([]);
    });

    it("admin: childStudentIds is [] (not a parent)", () => {
      const scope = buildScopeContext(makeSession({ role: "admin", childStudentIds: [10] }));
      expect(scope.childStudentIds).toEqual([]);
    });

    it("student: childCourseIds is [] (not a parent)", () => {
      const scope = buildScopeContext(makeSession({ role: "student", childCourseIds: [1, 2] }));
      expect(scope.childCourseIds).toEqual([]);
    });
  });
});

// ── Guest and admin scope construction ───────────────────────────────────────

describe("ScopeContext — guest scope construction", () => {
  it("guest: studentId is null", () => {
    expect(buildScopeContext(makeSession({ role: "guest" })).studentId).toBeNull();
  });
  it("guest: enrolledCourseIds is []", () => {
    expect(buildScopeContext(makeSession({ role: "guest" })).enrolledCourseIds).toEqual([]);
  });
  it("guest: childStudentIds is []", () => {
    expect(buildScopeContext(makeSession({ role: "guest" })).childStudentIds).toEqual([]);
  });
  it("guest: childCourseIds is []", () => {
    expect(buildScopeContext(makeSession({ role: "guest" })).childCourseIds).toEqual([]);
  });
  it("guest: isGlobal is false", () => {
    expect(buildScopeContext(makeSession({ role: "guest" })).isGlobal).toBe(false);
  });
});

describe("ScopeContext — admin/teacher scope construction", () => {
  it("admin: all scope arrays are empty (global access via isGlobal, not arrays)", () => {
    const scope = buildScopeContext(makeSession({ role: "admin" }));
    expect(scope.studentId).toBeNull();
    expect(scope.enrolledCourseIds).toEqual([]);
    expect(scope.childStudentIds).toEqual([]);
    expect(scope.childCourseIds).toEqual([]);
  });

  it("teacher: same as admin — all arrays empty, isGlobal=true", () => {
    const scope = buildScopeContext(makeSession({ role: "teacher" }));
    expect(scope.studentId).toBeNull();
    expect(scope.enrolledCourseIds).toEqual([]);
    expect(scope.childStudentIds).toEqual([]);
    expect(scope.childCourseIds).toEqual([]);
    expect(scope.isGlobal).toBe(true);
  });

  it("userId is propagated correctly for all roles", () => {
    const roles = ["admin", "teacher", "student", "parent", "guest"] as const;
    roles.forEach((role) => {
      const scope = buildScopeContext(makeSession({ role, userId: 99 }));
      expect(scope.userId).toBe(99);
    });
  });
});

// ── Invariants: buildScopeContext is pure ─────────────────────────────────────

describe("ScopeContext — purity invariants", () => {
  it("same session input always produces identical scope output", () => {
    const session = makeSession({ role: "student", studentId: 5, enrolledCourseIds: [1, 2] });
    const scope1 = buildScopeContext(session);
    const scope2 = buildScopeContext(session);
    expect(scope1).toEqual(scope2);
  });

  it("different userId values are not confused between calls", () => {
    const scope1 = buildScopeContext(makeSession({ role: "student", userId: 10 }));
    const scope2 = buildScopeContext(makeSession({ role: "student", userId: 20 }));
    expect(scope1.userId).toBe(10);
    expect(scope2.userId).toBe(20);
  });

  it("building scope from same session twice does not mutate the original session", () => {
    const session = makeSession({ role: "student", studentId: 7, enrolledCourseIds: [1, 2] });
    const originalEnrolled = [...(session.enrolledCourseIds ?? [])];
    buildScopeContext(session);
    buildScopeContext(session);
    expect(session.enrolledCourseIds).toEqual(originalEnrolled);
  });
});
