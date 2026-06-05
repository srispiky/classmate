import { describe, it, expect } from "vitest";
import { buildScopeContext, type ClassmateSession } from "../scope-context";
import { SQL_FALSE } from "../scope-filter";
import { CourseAuthorizationError } from "../course-scope-validator";
import {
  PolicyAuthorizationError,
  AssignmentScopePolicy,
  AssessmentScopePolicy,
  NotesScopePolicy,
  assignmentPolicy,
  assessmentPolicy,
  notesPolicy,
} from "./index";

// ── helpers ──────────────────────────────────────────────────────────────────

function session(overrides: Partial<ClassmateSession> = {}): ClassmateSession {
  return {
    userId: 1,
    username: "test",
    displayName: "Test",
    role: "admin",
    studentId: undefined,
    childStudentIds: undefined,
    childCourseIds: undefined,
    enrolledCourseIds: undefined,
    ...overrides,
  } as ClassmateSession;
}

// ── singleton exports ─────────────────────────────────────────────────────────

describe("policy singletons", () => {
  it("assignmentPolicy is an instance of AssignmentScopePolicy", () => {
    expect(assignmentPolicy).toBeInstanceOf(AssignmentScopePolicy);
  });

  it("assessmentPolicy is an instance of AssessmentScopePolicy", () => {
    expect(assessmentPolicy).toBeInstanceOf(AssessmentScopePolicy);
  });

  it("notesPolicy is an instance of NotesScopePolicy", () => {
    expect(notesPolicy).toBeInstanceOf(NotesScopePolicy);
  });
});

// ── PolicyAuthorizationError ──────────────────────────────────────────────────

describe("PolicyAuthorizationError", () => {
  it("is a subclass of Error", () => {
    expect(new PolicyAuthorizationError()).toBeInstanceOf(Error);
  });

  it("CourseAuthorizationError IS a PolicyAuthorizationError (subclass)", () => {
    const err = new CourseAuthorizationError(5);
    expect(err).toBeInstanceOf(PolicyAuthorizationError);
  });

  it("has name PolicyAuthorizationError", () => {
    expect(new PolicyAuthorizationError().name).toBe("PolicyAuthorizationError");
  });

  it("accepts custom message", () => {
    expect(new PolicyAuthorizationError("nope").message).toBe("nope");
  });
});

// ── AssignmentScopePolicy ─────────────────────────────────────────────────────

describe("AssignmentScopePolicy.getScopeCondition", () => {
  it("admin → undefined (no filter)", () => {
    const scope = buildScopeContext(session({ role: "admin" }));
    expect(assignmentPolicy.getScopeCondition(scope)).toBeUndefined();
  });

  it("teacher → undefined (no filter)", () => {
    const scope = buildScopeContext(session({ role: "teacher" }));
    expect(assignmentPolicy.getScopeCondition(scope)).toBeUndefined();
  });

  it("student with id → SQL condition (not SQL_FALSE)", () => {
    const scope = buildScopeContext(session({ role: "student", studentId: 3 }));
    const cond = assignmentPolicy.getScopeCondition(scope);
    expect(cond).toBeDefined();
    expect(cond).not.toBe(SQL_FALSE);
  });

  it("student without id → SQL_FALSE", () => {
    const scope = buildScopeContext(session({ role: "student", studentId: undefined }));
    expect(assignmentPolicy.getScopeCondition(scope)).toBe(SQL_FALSE);
  });

  it("parent with childStudentIds → SQL condition (not SQL_FALSE)", () => {
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: [2, 4] }));
    const cond = assignmentPolicy.getScopeCondition(scope);
    expect(cond).toBeDefined();
    expect(cond).not.toBe(SQL_FALSE);
  });

  it("parent without childStudentIds → SQL_FALSE", () => {
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: undefined }));
    expect(assignmentPolicy.getScopeCondition(scope)).toBe(SQL_FALSE);
  });

  it("guest → SQL_FALSE", () => {
    const scope = buildScopeContext(session({ role: "guest" }));
    expect(assignmentPolicy.getScopeCondition(scope)).toBe(SQL_FALSE);
  });
});

describe("AssignmentScopePolicy.validateAccess", () => {
  it("admin: does not throw for any resource", () => {
    const scope = buildScopeContext(session({ role: "admin" }));
    expect(() => assignmentPolicy.validateAccess(scope, { studentId: 99 })).not.toThrow();
  });

  it("teacher: does not throw for any resource", () => {
    const scope = buildScopeContext(session({ role: "teacher" }));
    expect(() => assignmentPolicy.validateAccess(scope, { studentId: 42 })).not.toThrow();
  });

  it("student: passes when resource.studentId === scope.studentId", () => {
    const scope = buildScopeContext(session({ role: "student", studentId: 7 }));
    expect(() => assignmentPolicy.validateAccess(scope, { studentId: 7 })).not.toThrow();
  });

  it("student: throws PolicyAuthorizationError when resource.studentId !== scope.studentId", () => {
    const scope = buildScopeContext(session({ role: "student", studentId: 7 }));
    expect(() => assignmentPolicy.validateAccess(scope, { studentId: 99 })).toThrow(
      PolicyAuthorizationError,
    );
  });

  it("student: throws when resource.studentId is null", () => {
    const scope = buildScopeContext(session({ role: "student", studentId: 7 }));
    expect(() => assignmentPolicy.validateAccess(scope, { studentId: null })).toThrow(
      PolicyAuthorizationError,
    );
  });

  it("parent: passes when resource.studentId ∈ childStudentIds", () => {
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: [3, 5, 8] }));
    expect(() => assignmentPolicy.validateAccess(scope, { studentId: 5 })).not.toThrow();
  });

  it("parent: throws when resource.studentId ∉ childStudentIds", () => {
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: [3, 5, 8] }));
    expect(() => assignmentPolicy.validateAccess(scope, { studentId: 99 })).toThrow(
      PolicyAuthorizationError,
    );
  });

  it("guest: always throws", () => {
    const scope = buildScopeContext(session({ role: "guest" }));
    expect(() => assignmentPolicy.validateAccess(scope, { studentId: 1 })).toThrow(
      PolicyAuthorizationError,
    );
  });
});

// ── AssessmentScopePolicy ─────────────────────────────────────────────────────

describe("AssessmentScopePolicy.getScopeCondition", () => {
  it("admin → undefined", () => {
    const scope = buildScopeContext(session({ role: "admin" }));
    expect(assessmentPolicy.getScopeCondition(scope)).toBeUndefined();
  });

  it("teacher → undefined", () => {
    const scope = buildScopeContext(session({ role: "teacher" }));
    expect(assessmentPolicy.getScopeCondition(scope)).toBeUndefined();
  });

  it("student with id → SQL condition", () => {
    const scope = buildScopeContext(session({ role: "student", studentId: 2 }));
    const cond = assessmentPolicy.getScopeCondition(scope);
    expect(cond).toBeDefined();
    expect(cond).not.toBe(SQL_FALSE);
  });

  it("student without id → SQL_FALSE", () => {
    const scope = buildScopeContext(session({ role: "student" }));
    expect(assessmentPolicy.getScopeCondition(scope)).toBe(SQL_FALSE);
  });

  it("parent with childStudentIds → SQL condition", () => {
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: [1, 2] }));
    const cond = assessmentPolicy.getScopeCondition(scope);
    expect(cond).toBeDefined();
    expect(cond).not.toBe(SQL_FALSE);
  });

  it("parent without childStudentIds → SQL_FALSE", () => {
    const scope = buildScopeContext(session({ role: "parent" }));
    expect(assessmentPolicy.getScopeCondition(scope)).toBe(SQL_FALSE);
  });
});

describe("AssessmentScopePolicy.validateAccess", () => {
  it("admin: does not throw", () => {
    const scope = buildScopeContext(session({ role: "admin" }));
    expect(() => assessmentPolicy.validateAccess(scope, { studentId: 10 })).not.toThrow();
  });

  it("teacher: does not throw", () => {
    const scope = buildScopeContext(session({ role: "teacher" }));
    expect(() => assessmentPolicy.validateAccess(scope, { studentId: 10 })).not.toThrow();
  });

  it("student: passes for own resource", () => {
    const scope = buildScopeContext(session({ role: "student", studentId: 4 }));
    expect(() => assessmentPolicy.validateAccess(scope, { studentId: 4 })).not.toThrow();
  });

  it("student: throws for other student's resource", () => {
    const scope = buildScopeContext(session({ role: "student", studentId: 4 }));
    expect(() => assessmentPolicy.validateAccess(scope, { studentId: 5 })).toThrow(
      PolicyAuthorizationError,
    );
  });

  it("parent: passes for child student resource", () => {
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: [6, 7] }));
    expect(() => assessmentPolicy.validateAccess(scope, { studentId: 6 })).not.toThrow();
  });

  it("parent: throws for non-child student resource", () => {
    const scope = buildScopeContext(session({ role: "parent", childStudentIds: [6, 7] }));
    expect(() => assessmentPolicy.validateAccess(scope, { studentId: 99 })).toThrow(
      PolicyAuthorizationError,
    );
  });
});

// ── NotesScopePolicy ──────────────────────────────────────────────────────────

describe("NotesScopePolicy.getScopeCondition", () => {
  it("admin → undefined (no filter)", () => {
    const scope = buildScopeContext(session({ role: "admin" }));
    expect(notesPolicy.getScopeCondition(scope)).toBeUndefined();
  });

  it("teacher → undefined", () => {
    const scope = buildScopeContext(session({ role: "teacher" }));
    expect(notesPolicy.getScopeCondition(scope)).toBeUndefined();
  });

  it("student with enrolledCourseIds → SQL condition", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [1, 2] }));
    const cond = notesPolicy.getScopeCondition(scope);
    expect(cond).toBeDefined();
    expect(cond).not.toBe(SQL_FALSE);
  });

  it("student with empty enrolledCourseIds → SQL_FALSE", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [] }));
    expect(notesPolicy.getScopeCondition(scope)).toBe(SQL_FALSE);
  });

  it("parent with childCourseIds → SQL condition", () => {
    const scope = buildScopeContext(session({ role: "parent", childCourseIds: [3, 4] }));
    const cond = notesPolicy.getScopeCondition(scope);
    expect(cond).toBeDefined();
    expect(cond).not.toBe(SQL_FALSE);
  });

  it("parent with empty childCourseIds → SQL_FALSE", () => {
    const scope = buildScopeContext(session({ role: "parent", childCourseIds: [] }));
    expect(notesPolicy.getScopeCondition(scope)).toBe(SQL_FALSE);
  });

  it("guest → SQL_FALSE", () => {
    const scope = buildScopeContext(session({ role: "guest" }));
    expect(notesPolicy.getScopeCondition(scope)).toBe(SQL_FALSE);
  });
});

describe("NotesScopePolicy.validateAccess", () => {
  it("admin: does not throw for any courseId", () => {
    const scope = buildScopeContext(session({ role: "admin" }));
    expect(() => notesPolicy.validateAccess(scope, { courseId: 99 })).not.toThrow();
  });

  it("teacher: does not throw for any courseId", () => {
    const scope = buildScopeContext(session({ role: "teacher" }));
    expect(() => notesPolicy.validateAccess(scope, { courseId: 42 })).not.toThrow();
  });

  it("student: passes when courseId ∈ enrolledCourseIds", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [3, 5, 7] }));
    expect(() => notesPolicy.validateAccess(scope, { courseId: 5 })).not.toThrow();
  });

  it("student: throws PolicyAuthorizationError when courseId ∉ enrolledCourseIds", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [3, 5, 7] }));
    expect(() => notesPolicy.validateAccess(scope, { courseId: 99 })).toThrow(
      PolicyAuthorizationError,
    );
  });

  it("student: thrown error is also a CourseAuthorizationError (subclass chain intact)", () => {
    const scope = buildScopeContext(session({ role: "student", enrolledCourseIds: [1] }));
    expect(() => notesPolicy.validateAccess(scope, { courseId: 99 })).toThrow(
      CourseAuthorizationError,
    );
  });

  it("parent: passes when courseId ∈ childCourseIds", () => {
    const scope = buildScopeContext(session({ role: "parent", childCourseIds: [2, 8, 11] }));
    expect(() => notesPolicy.validateAccess(scope, { courseId: 8 })).not.toThrow();
  });

  it("parent: throws PolicyAuthorizationError when courseId ∉ childCourseIds", () => {
    const scope = buildScopeContext(session({ role: "parent", childCourseIds: [2, 8, 11] }));
    expect(() => notesPolicy.validateAccess(scope, { courseId: 99 })).toThrow(
      PolicyAuthorizationError,
    );
  });

  it("guest: always throws", () => {
    const scope = buildScopeContext(session({ role: "guest" }));
    expect(() => notesPolicy.validateAccess(scope, { courseId: 1 })).toThrow(
      PolicyAuthorizationError,
    );
  });
});

// ── interface conformance ─────────────────────────────────────────────────────

describe("ResourceScopePolicy interface conformance", () => {
  it("all three policies expose getScopeCondition and validateAccess", () => {
    for (const policy of [assignmentPolicy, assessmentPolicy, notesPolicy]) {
      expect(typeof policy.getScopeCondition).toBe("function");
      expect(typeof policy.validateAccess).toBe("function");
    }
  });
});
