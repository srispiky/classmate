import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

// ── Status enum ───────────────────────────────────────────────────────────────

export const COURSE_STATUS = ["active", "archived"] as const;
export type CourseStatus = (typeof COURSE_STATUS)[number];

// ── Table definition ──────────────────────────────────────────────────────────

export const coursesTable = pgTable(
  "courses",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    subject: text("subject").notNull(),
    grade: text("grade"),
    academicYear: text("academic_year"),
    teacherName: text("teacher_name").notNull().default(""),
    teacherId: integer("teacher_id").references(() => usersTable.id, { onDelete: "restrict" }),
    studentCount: integer("student_count").notNull().default(0),
    status: text("status").$type<CourseStatus>().notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    updatedBy: integer("updated_by").references(() => usersTable.id, { onDelete: "set null" }),
    deletedBy: integer("deleted_by").references(() => usersTable.id, { onDelete: "set null" }),
  },
  (table) => ({
    // Supports teacher-scoped course list queries (WHERE teacher_id = ?)
    teacherIdIdx: index("ix_courses_teacher_id").on(table.teacherId),
    // Supports soft-delete exclusion filters (WHERE deleted_at IS NULL)
    deletedAtIdx: index("ix_courses_deleted_at").on(table.deletedAt),
  }),
);

// ── Domain validation constants ───────────────────────────────────────────────

export const COURSE_NAME_MAX_LENGTH = 120;
export const ACADEMIC_YEAR_REGEX = /^\d{4}-\d{4}$/;

// ── Field-level Zod schemas ───────────────────────────────────────────────────
// These are exported individually so consumers can compose partial schemas
// (e.g. PATCH bodies) without duplicating validation logic.

export const courseNameSchema = z
  .string()
  .trim()
  .min(1, "Course name is required")
  .max(COURSE_NAME_MAX_LENGTH, `Course name must be ${COURSE_NAME_MAX_LENGTH} characters or fewer`);

export const courseSubjectSchema = z.string().trim().min(1, "Subject is required");

export const courseGradeSchema = z.string().trim().min(1, "Grade is required");

export const courseAcademicYearSchema = z
  .string()
  .trim()
  .regex(ACADEMIC_YEAR_REGEX, "Academic year must be in YYYY-YYYY format (e.g. 2025-2026)");

export const courseStatusSchema = z.enum(COURSE_STATUS);

export const courseTeacherIdSchema = z
  .number()
  .int()
  .positive("Teacher ID must be a positive integer");

// ── Composite domain schemas ──────────────────────────────────────────────────

/** Full schema for creating a new course (all required fields enforced). */
export const createCourseInputSchema = z.object({
  name: courseNameSchema,
  subject: courseSubjectSchema,
  grade: courseGradeSchema,
  academicYear: courseAcademicYearSchema,
  teacherId: courseTeacherIdSchema,
  status: courseStatusSchema.default("active"),
  description: z.string().trim().default(""),
});

/** Partial schema for updating an existing course (at least one field required). */
export const updateCourseInputSchema = z
  .object({
    name: courseNameSchema,
    subject: courseSubjectSchema,
    grade: courseGradeSchema,
    academicYear: courseAcademicYearSchema,
    teacherId: courseTeacherIdSchema,
    status: courseStatusSchema,
    description: z.string().trim(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided for update",
  });

// ── Drizzle-generated schemas ─────────────────────────────────────────────────
// insertCourseSchema is the raw Drizzle insert shape (used by the existing route
// until the API layer is updated in Sprint 4 Chunk 2+).

export const insertCourseSchema = createInsertSchema(coursesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  studentCount: true,
  createdBy: true,
  updatedBy: true,
  deletedBy: true,
});

export const selectCourseSchema = createSelectSchema(coursesTable);

// ── TypeScript types ──────────────────────────────────────────────────────────

export type InsertCourse = z.infer<typeof insertCourseSchema>;
export type Course = typeof coursesTable.$inferSelect;
export type CreateCourseInput = z.infer<typeof createCourseInputSchema>;
export type UpdateCourseInput = z.infer<typeof updateCourseInputSchema>;
