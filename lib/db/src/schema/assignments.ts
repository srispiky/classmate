import { pgTable, text, serial, timestamp, integer, real, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { coursesTable } from "./courses";
import { studentsTable } from "./students";

export const assignmentsTable = pgTable(
  "assignments",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    courseId: integer("course_id")
      .notNull()
      .references(() => coursesTable.id, { onDelete: "cascade" }),
    studentId: integer("student_id")
      .notNull()
      .references(() => studentsTable.id, { onDelete: "cascade" }),
    dueDate: text("due_date").notNull(),
    status: text("status").notNull().default("pending"),
    score: real("score"),
    maxScore: real("max_score").notNull().default(100),
    feedback: text("feedback"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    updatedBy: integer("updated_by").references(() => usersTable.id, { onDelete: "set null" }),
    deletedBy: integer("deleted_by").references(() => usersTable.id, { onDelete: "set null" }),
  },
  (table) => ({
    // Supports teacher/student portal list queries filtered by student
    studentIdIdx: index("ix_assignments_student_id").on(table.studentId),
    // Supports teacher/student portal list queries filtered by course
    courseIdIdx: index("ix_assignments_course_id").on(table.courseId),
    // Supports soft-delete exclusion filters (WHERE deleted_at IS NULL)
    deletedAtIdx: index("ix_assignments_deleted_at").on(table.deletedAt),
  }),
);

export const insertAssignmentSchema = createInsertSchema(assignmentsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  createdBy: true,
  updatedBy: true,
  deletedBy: true,
});
export type InsertAssignment = z.infer<typeof insertAssignmentSchema>;
export type Assignment = typeof assignmentsTable.$inferSelect;
