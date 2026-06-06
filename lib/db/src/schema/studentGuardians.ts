import { pgTable, bigserial, integer, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { studentsTable } from "./students";
import { usersTable } from "./users";

export const studentGuardiansTable = pgTable(
  "student_guardians",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    studentId: integer("student_id")
      .notNull()
      .references(() => studentsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    relationship: text("relationship").notNull().default("guardian"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: integer("created_by")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
  },
  (table) => ({
    uniqueGuardian: uniqueIndex("uq_student_guardians").on(table.studentId, table.userId),
    userIdIdx: index("ix_student_guardians_user_id").on(table.userId),
  }),
);

export const insertStudentGuardianSchema = createInsertSchema(studentGuardiansTable).omit({
  id: true,
  createdAt: true,
});
export const selectStudentGuardianSchema = createSelectSchema(studentGuardiansTable);
export type InsertStudentGuardian = z.infer<typeof insertStudentGuardianSchema>;
export type StudentGuardian = typeof studentGuardiansTable.$inferSelect;
