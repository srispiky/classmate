import { pgTable, serial, text, timestamp, boolean, integer, check } from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    username: text("username").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull(),
    role: text("role").notNull().default("teacher"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: integer("created_by").references(
      (): AnyPgColumn => usersTable.id,
      { onDelete: "set null" },
    ),
    updatedBy: integer("updated_by").references(
      (): AnyPgColumn => usersTable.id,
      { onDelete: "set null" },
    ),
  },
  (table) => ({
    roleCheck: check(
      "chk_users_role",
      sql`${table.role} IN ('admin','teacher','student','parent','guest')`,
    ),
  }),
);

export const insertUserSchema = createInsertSchema(usersTable);
export const selectUserSchema = createSelectSchema(usersTable);

export type User = typeof usersTable.$inferSelect;
export type InsertUser = typeof usersTable.$inferInsert;
