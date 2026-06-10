import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { coursesTable } from "./courses";

export const activityTable = pgTable(
  "activity",
  {
    id: serial("id").primaryKey(),
    type: text("type").notNull(),
    description: text("description").notNull(),
    studentName: text("student_name").notNull(),
    courseName: text("course_name").notNull(),
    courseId: integer("course_id").references((): AnyPgColumn => coursesTable.id, { onDelete: "set null" }),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Supports dashboard recent-activity queries filtered by course
    courseIdIdx: index("ix_activity_course_id").on(table.courseId),
  }),
);

export const insertActivitySchema = createInsertSchema(activityTable).omit({ id: true, timestamp: true });
export type InsertActivity = z.infer<typeof insertActivitySchema>;
export type Activity = typeof activityTable.$inferSelect;
