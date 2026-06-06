import { pgTable, text, serial, timestamp, integer, json, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const studentsTable = pgTable(
  "students",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    grade: text("grade").notNull(),
    avatarUrl: text("avatar_url"),
    enrolledCourseIds: json("enrolled_course_ids").$type<number[]>().notNull().default([]),
    userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdUnique: uniqueIndex("uq_students_user_id")
      .on(table.userId)
      .where(sql`${table.userId} IS NOT NULL`),
  }),
);

export const insertStudentSchema = createInsertSchema(studentsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertStudent = z.infer<typeof insertStudentSchema>;
export type Student = typeof studentsTable.$inferSelect;
