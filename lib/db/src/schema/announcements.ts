import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { coursesTable } from "./courses";

export const announcementsTable = pgTable(
  "announcements",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    courseId: integer("course_id")
      .notNull()
      .references(() => coursesTable.id, { onDelete: "cascade" }),
    authorName: text("author_name").notNull(),
    priority: text("priority").notNull().default("normal"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
    updatedBy: integer("updated_by").references(() => usersTable.id, { onDelete: "set null" }),
    deletedBy: integer("deleted_by").references(() => usersTable.id, { onDelete: "set null" }),
  },
  (table) => ({
    // Supports teacher/student portal list queries filtered by course
    courseIdIdx: index("ix_announcements_course_id").on(table.courseId),
    // Supports soft-delete exclusion filters (WHERE deleted_at IS NULL)
    deletedAtIdx: index("ix_announcements_deleted_at").on(table.deletedAt),
  }),
);

export const insertAnnouncementSchema = createInsertSchema(announcementsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  createdBy: true,
  updatedBy: true,
  deletedBy: true,
});
export type InsertAnnouncement = z.infer<typeof insertAnnouncementSchema>;
export type Announcement = typeof announcementsTable.$inferSelect;
