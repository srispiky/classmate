import { pgTable, text, serial, timestamp, integer, real, json, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { coursesTable } from "./courses";
import { studentsTable } from "./students";

export const assessmentsTable = pgTable(
  "assessments",
  {
    id: serial("id").primaryKey(),
    studentId: integer("student_id")
      .notNull()
      .references(() => studentsTable.id, { onDelete: "cascade" }),
    courseId: integer("course_id")
      .notNull()
      .references(() => coursesTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    score: real("score").notNull(),
    maxScore: real("max_score").notNull().default(100),
    strengths: json("strengths").$type<string[]>().notNull().default([]),
    weaknesses: json("weaknesses").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    updatedBy: integer("updated_by").references(() => usersTable.id, { onDelete: "set null" }),
    deletedBy: integer("deleted_by").references(() => usersTable.id, { onDelete: "set null" }),
  },
  (table) => ({
    // Supports teacher/student portal list queries filtered by student
    studentIdIdx: index("ix_assessments_student_id").on(table.studentId),
    // Supports teacher/student portal list queries filtered by course
    courseIdIdx: index("ix_assessments_course_id").on(table.courseId),
    // Supports soft-delete exclusion filters (WHERE deleted_at IS NULL)
    deletedAtIdx: index("ix_assessments_deleted_at").on(table.deletedAt),
  }),
);

export const insertAssessmentSchema = createInsertSchema(assessmentsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  createdBy: true,
  updatedBy: true,
  deletedBy: true,
});
export type InsertAssessment = z.infer<typeof insertAssessmentSchema>;
export type Assessment = typeof assessmentsTable.$inferSelect;
