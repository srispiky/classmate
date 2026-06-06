import {
  pgTable,
  bigserial,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { studentsTable } from "./students";
import { coursesTable } from "./courses";
import { usersTable } from "./users";

export const courseEnrollmentsTable = pgTable(
  "course_enrollments",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    studentId: integer("student_id")
      .notNull()
      .references(() => studentsTable.id, { onDelete: "cascade" }),
    courseId: integer("course_id")
      .notNull()
      .references(() => coursesTable.id, { onDelete: "restrict" }),
    enrolledAt: timestamp("enrolled_at", { withTimezone: true }).notNull().defaultNow(),
    enrolledBy: integer("enrolled_by")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    isActive: boolean("is_active").notNull().default(true),
    droppedAt: timestamp("dropped_at", { withTimezone: true }),
  },
  (table) => ({
    activeEnrollmentUnique: uniqueIndex("uq_course_enrollments_active")
      .on(table.studentId, table.courseId)
      .where(sql`${table.isActive} = true`),
    studentActiveIdx: index("idx_course_enrollments_student_id")
      .on(table.studentId)
      .where(sql`${table.isActive} = true`),
    courseActiveIdx: index("idx_course_enrollments_course_id")
      .on(table.courseId)
      .where(sql`${table.isActive} = true`),
  }),
);

export const insertCourseEnrollmentSchema = createInsertSchema(courseEnrollmentsTable).omit({
  id: true,
  enrolledAt: true,
  droppedAt: true,
});
export const selectCourseEnrollmentSchema = createSelectSchema(courseEnrollmentsTable);
export type InsertCourseEnrollment = z.infer<typeof insertCourseEnrollmentSchema>;
export type CourseEnrollment = typeof courseEnrollmentsTable.$inferSelect;
