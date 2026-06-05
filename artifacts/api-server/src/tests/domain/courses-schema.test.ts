/**
 * Course Domain Schema Validation Tests
 *
 * Validates the field-level and composite Zod schemas introduced in Sprint 4
 * Chunk 1. These are pure unit tests — no database access, no HTTP layer.
 *
 * Coverage:
 *   - courseNameSchema         — required, trimmed, max length
 *   - courseSubjectSchema      — required, trimmed
 *   - courseGradeSchema        — required, trimmed
 *   - courseAcademicYearSchema — required, YYYY-YYYY format
 *   - courseStatusSchema       — enum: active | archived
 *   - courseTeacherIdSchema    — positive integer
 *   - createCourseInputSchema  — all fields, defaults, composition
 *   - updateCourseInputSchema  — partial, at-least-one-field invariant
 */
import { describe, it, expect } from "vitest";
import {
  COURSE_NAME_MAX_LENGTH,
  courseNameSchema,
  courseSubjectSchema,
  courseGradeSchema,
  courseAcademicYearSchema,
  courseStatusSchema,
  courseTeacherIdSchema,
  createCourseInputSchema,
  updateCourseInputSchema,
  type CreateCourseInput,
  type UpdateCourseInput,
} from "@workspace/db";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeValidInput(overrides: Partial<CreateCourseInput> = {}): CreateCourseInput {
  return {
    name: "Algebra I",
    subject: "Mathematics",
    grade: "9",
    academicYear: "2025-2026",
    teacherId: 1,
    status: "active",
    description: "",
    ...overrides,
  };
}

// ── courseNameSchema ───────────────────────────────────────────────────────────

describe("courseNameSchema", () => {
  it("accepts a standard course name", () => {
    expect(courseNameSchema.safeParse("Algebra I").success).toBe(true);
  });

  it("accepts a name at exactly the max length", () => {
    expect(courseNameSchema.safeParse("A".repeat(COURSE_NAME_MAX_LENGTH)).success).toBe(true);
  });

  it("rejects a name exceeding max length", () => {
    expect(courseNameSchema.safeParse("A".repeat(COURSE_NAME_MAX_LENGTH + 1)).success).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(courseNameSchema.safeParse("").success).toBe(false);
  });

  it("rejects a whitespace-only string", () => {
    expect(courseNameSchema.safeParse("   ").success).toBe(false);
  });

  it("trims leading/trailing whitespace before validation", () => {
    const result = courseNameSchema.safeParse("  Algebra I  ");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("Algebra I");
  });

  it("rejects null", () => {
    expect(courseNameSchema.safeParse(null).success).toBe(false);
  });

  it("rejects undefined", () => {
    expect(courseNameSchema.safeParse(undefined).success).toBe(false);
  });

  it("rejects a number", () => {
    expect(courseNameSchema.safeParse(42).success).toBe(false);
  });

  it("accepts names with special characters (punctuation, hyphens)", () => {
    expect(courseNameSchema.safeParse("AP Calculus BC \u2013 Part 1").success).toBe(true);
  });
});

// ── courseSubjectSchema ───────────────────────────────────────────────────────

describe("courseSubjectSchema", () => {
  it("accepts a valid subject", () => {
    expect(courseSubjectSchema.safeParse("Mathematics").success).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(courseSubjectSchema.safeParse("").success).toBe(false);
  });

  it("rejects whitespace-only", () => {
    expect(courseSubjectSchema.safeParse("   ").success).toBe(false);
  });

  it("trims whitespace", () => {
    const result = courseSubjectSchema.safeParse("  Science  ");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("Science");
  });

  it("rejects null", () => {
    expect(courseSubjectSchema.safeParse(null).success).toBe(false);
  });
});

// ── courseGradeSchema ─────────────────────────────────────────────────────────

describe("courseGradeSchema", () => {
  it("accepts numeric grade string '9'", () => {
    expect(courseGradeSchema.safeParse("9").success).toBe(true);
  });

  it("accepts label-style grade 'Grade 10'", () => {
    expect(courseGradeSchema.safeParse("Grade 10").success).toBe(true);
  });

  it("accepts 'K' for kindergarten", () => {
    expect(courseGradeSchema.safeParse("K").success).toBe(true);
  });

  it("rejects empty string", () => {
    expect(courseGradeSchema.safeParse("").success).toBe(false);
  });

  it("rejects whitespace-only", () => {
    expect(courseGradeSchema.safeParse("   ").success).toBe(false);
  });

  it("trims whitespace", () => {
    const result = courseGradeSchema.safeParse("  10  ");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("10");
  });

  it("rejects null", () => {
    expect(courseGradeSchema.safeParse(null).success).toBe(false);
  });
});

// ── courseAcademicYearSchema ──────────────────────────────────────────────────

describe("courseAcademicYearSchema", () => {
  it("accepts a correctly formatted academic year", () => {
    expect(courseAcademicYearSchema.safeParse("2025-2026").success).toBe(true);
  });

  it("accepts minimum valid year (four digits each side)", () => {
    expect(courseAcademicYearSchema.safeParse("1900-1901").success).toBe(true);
  });

  it("rejects year with three-digit first component '202-2026'", () => {
    expect(courseAcademicYearSchema.safeParse("202-2026").success).toBe(false);
  });

  it("rejects year with five-digit first component '20255-2026'", () => {
    expect(courseAcademicYearSchema.safeParse("20255-2026").success).toBe(false);
  });

  it("rejects single year '2025'", () => {
    expect(courseAcademicYearSchema.safeParse("2025").success).toBe(false);
  });

  it("rejects slash-separated year '2025/2026'", () => {
    expect(courseAcademicYearSchema.safeParse("2025/2026").success).toBe(false);
  });

  it("rejects year with letters '20AB-2026'", () => {
    expect(courseAcademicYearSchema.safeParse("20AB-2026").success).toBe(false);
  });

  it("rejects empty string", () => {
    expect(courseAcademicYearSchema.safeParse("").success).toBe(false);
  });

  it("rejects null", () => {
    expect(courseAcademicYearSchema.safeParse(null).success).toBe(false);
  });

  it("trims surrounding whitespace before format check", () => {
    const result = courseAcademicYearSchema.safeParse("  2025-2026  ");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("2025-2026");
  });
});

// ── courseStatusSchema ────────────────────────────────────────────────────────

describe("courseStatusSchema", () => {
  it("accepts 'active'", () => {
    expect(courseStatusSchema.safeParse("active").success).toBe(true);
  });

  it("accepts 'archived'", () => {
    expect(courseStatusSchema.safeParse("archived").success).toBe(true);
  });

  it("rejects 'inactive' (not a valid status)", () => {
    expect(courseStatusSchema.safeParse("inactive").success).toBe(false);
  });

  it("rejects 'ACTIVE' (case-sensitive)", () => {
    expect(courseStatusSchema.safeParse("ACTIVE").success).toBe(false);
  });

  it("rejects empty string", () => {
    expect(courseStatusSchema.safeParse("").success).toBe(false);
  });

  it("rejects null", () => {
    expect(courseStatusSchema.safeParse(null).success).toBe(false);
  });

  it("rejects number 1", () => {
    expect(courseStatusSchema.safeParse(1).success).toBe(false);
  });
});

// ── courseTeacherIdSchema ─────────────────────────────────────────────────────

describe("courseTeacherIdSchema", () => {
  it("accepts a positive integer", () => {
    expect(courseTeacherIdSchema.safeParse(1).success).toBe(true);
  });

  it("accepts a large positive integer", () => {
    expect(courseTeacherIdSchema.safeParse(999999).success).toBe(true);
  });

  it("rejects zero", () => {
    expect(courseTeacherIdSchema.safeParse(0).success).toBe(false);
  });

  it("rejects negative integer", () => {
    expect(courseTeacherIdSchema.safeParse(-1).success).toBe(false);
  });

  it("rejects float", () => {
    expect(courseTeacherIdSchema.safeParse(1.5).success).toBe(false);
  });

  it("rejects string '1'", () => {
    expect(courseTeacherIdSchema.safeParse("1").success).toBe(false);
  });

  it("rejects null", () => {
    expect(courseTeacherIdSchema.safeParse(null).success).toBe(false);
  });
});

// ── createCourseInputSchema ───────────────────────────────────────────────────

describe("createCourseInputSchema", () => {
  describe("Valid inputs", () => {
    it("accepts a complete valid input", () => {
      expect(createCourseInputSchema.safeParse(makeValidInput()).success).toBe(true);
    });

    it("status defaults to 'active' when omitted", () => {
      const { status: _s, ...withoutStatus } = makeValidInput();
      const result = createCourseInputSchema.safeParse(withoutStatus);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.status).toBe("active");
    });

    it("description defaults to empty string when omitted", () => {
      const { description: _d, ...withoutDesc } = makeValidInput();
      const result = createCourseInputSchema.safeParse(withoutDesc);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.description).toBe("");
    });

    it("accepts status 'archived'", () => {
      expect(createCourseInputSchema.safeParse(makeValidInput({ status: "archived" })).success).toBe(true);
    });

    it("trims whitespace on name, subject, grade, academicYear", () => {
      const result = createCourseInputSchema.safeParse({
        name: "  Algebra I  ",
        subject: "  Mathematics  ",
        grade: "  9  ",
        academicYear: "  2025-2026  ",
        teacherId: 1,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("Algebra I");
        expect(result.data.subject).toBe("Mathematics");
        expect(result.data.grade).toBe("9");
        expect(result.data.academicYear).toBe("2025-2026");
      }
    });
  });

  describe("Required field validation", () => {
    it("rejects when name is missing", () => {
      const { name: _n, ...input } = makeValidInput();
      expect(createCourseInputSchema.safeParse(input).success).toBe(false);
    });

    it("rejects when subject is missing", () => {
      const { subject: _s, ...input } = makeValidInput();
      expect(createCourseInputSchema.safeParse(input).success).toBe(false);
    });

    it("rejects when grade is missing", () => {
      const { grade: _g, ...input } = makeValidInput();
      expect(createCourseInputSchema.safeParse(input).success).toBe(false);
    });

    it("rejects when academicYear is missing", () => {
      const { academicYear: _a, ...input } = makeValidInput();
      expect(createCourseInputSchema.safeParse(input).success).toBe(false);
    });

    it("rejects when teacherId is missing", () => {
      const { teacherId: _t, ...input } = makeValidInput();
      expect(createCourseInputSchema.safeParse(input).success).toBe(false);
    });
  });

  describe("Field-level rule delegation", () => {
    it("delegates name max length check", () => {
      expect(
        createCourseInputSchema.safeParse(makeValidInput({ name: "A".repeat(COURSE_NAME_MAX_LENGTH + 1) })).success,
      ).toBe(false);
    });

    it("delegates academicYear format check", () => {
      expect(
        createCourseInputSchema.safeParse(makeValidInput({ academicYear: "2025/2026" })).success,
      ).toBe(false);
    });

    it("delegates status enum check", () => {
      expect(
        createCourseInputSchema.safeParse(makeValidInput({ status: "inactive" as "active" })).success,
      ).toBe(false);
    });

    it("delegates teacherId positive integer check", () => {
      expect(createCourseInputSchema.safeParse(makeValidInput({ teacherId: 0 })).success).toBe(false);
    });
  });

  describe("TypeScript type inference", () => {
    it("inferred type has all expected fields at runtime", () => {
      const input = makeValidInput();
      const typed: CreateCourseInput = input;
      expect(typeof typed.name).toBe("string");
      expect(typeof typed.subject).toBe("string");
      expect(typeof typed.grade).toBe("string");
      expect(typeof typed.academicYear).toBe("string");
      expect(typeof typed.teacherId).toBe("number");
    });
  });
});

// ── updateCourseInputSchema ───────────────────────────────────────────────────

describe("updateCourseInputSchema", () => {
  describe("Valid partial updates", () => {
    it("accepts updating name only", () => {
      expect(updateCourseInputSchema.safeParse({ name: "New Course Name" }).success).toBe(true);
    });

    it("accepts updating status only", () => {
      expect(updateCourseInputSchema.safeParse({ status: "archived" }).success).toBe(true);
    });

    it("accepts updating subject only", () => {
      expect(updateCourseInputSchema.safeParse({ subject: "Physics" }).success).toBe(true);
    });

    it("accepts updating academicYear only", () => {
      expect(updateCourseInputSchema.safeParse({ academicYear: "2026-2027" }).success).toBe(true);
    });

    it("accepts updating grade only", () => {
      expect(updateCourseInputSchema.safeParse({ grade: "10" }).success).toBe(true);
    });

    it("accepts updating teacherId only", () => {
      expect(updateCourseInputSchema.safeParse({ teacherId: 5 }).success).toBe(true);
    });

    it("accepts updating multiple fields", () => {
      expect(
        updateCourseInputSchema.safeParse({ name: "Updated", subject: "Science", status: "archived" }).success,
      ).toBe(true);
    });

    it("accepts a full update (all fields present)", () => {
      expect(updateCourseInputSchema.safeParse(makeValidInput()).success).toBe(true);
    });
  });

  describe("At-least-one-field invariant", () => {
    it("rejects an empty object (no fields)", () => {
      expect(updateCourseInputSchema.safeParse({}).success).toBe(false);
    });
  });

  describe("Field-level rule delegation in partial context", () => {
    it("name: rejects empty string even in partial update", () => {
      expect(updateCourseInputSchema.safeParse({ name: "" }).success).toBe(false);
    });

    it("name: rejects exceeding max length in partial update", () => {
      expect(
        updateCourseInputSchema.safeParse({ name: "A".repeat(COURSE_NAME_MAX_LENGTH + 1) }).success,
      ).toBe(false);
    });

    it("academicYear: rejects wrong format in partial update", () => {
      expect(updateCourseInputSchema.safeParse({ academicYear: "2025/2026" }).success).toBe(false);
    });

    it("status: rejects invalid value in partial update", () => {
      expect(updateCourseInputSchema.safeParse({ status: "deleted" as "archived" }).success).toBe(false);
    });

    it("teacherId: rejects zero in partial update", () => {
      expect(updateCourseInputSchema.safeParse({ teacherId: 0 }).success).toBe(false);
    });

    it("teacherId: rejects negative in partial update", () => {
      expect(updateCourseInputSchema.safeParse({ teacherId: -5 }).success).toBe(false);
    });

    it("teacherId: rejects float in partial update", () => {
      expect(updateCourseInputSchema.safeParse({ teacherId: 2.7 }).success).toBe(false);
    });
  });

  describe("TypeScript type inference", () => {
    it("all fields are optional in the inferred type", () => {
      const partial: UpdateCourseInput = { name: "Only Name" };
      expect(partial.subject).toBeUndefined();
      expect(partial.grade).toBeUndefined();
      expect(partial.academicYear).toBeUndefined();
    });
  });
});
