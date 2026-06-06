import { pgTable, bigserial, integer, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { rolesTable } from "./roles";

export const userRolesTable = pgTable(
  "user_roles",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    roleId: integer("role_id")
      .notNull()
      .references(() => rolesTable.id, { onDelete: "restrict" }),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    grantedBy: integer("granted_by")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: integer("revoked_by").references(() => usersTable.id, { onDelete: "restrict" }),
  },
  (table) => ({
    activeRoleUnique: uniqueIndex("uq_user_roles_active")
      .on(table.userId, table.roleId)
      .where(sql`${table.expiresAt} IS NULL AND ${table.revokedAt} IS NULL`),
    userIdIdx: index("idx_user_roles_user_id").on(table.userId),
  }),
);

export const insertUserRoleSchema = createInsertSchema(userRolesTable).omit({
  id: true,
  grantedAt: true,
  revokedAt: true,
  revokedBy: true,
});
export const selectUserRoleSchema = createSelectSchema(userRolesTable);
export type InsertUserRole = z.infer<typeof insertUserRoleSchema>;
export type UserRole = typeof userRolesTable.$inferSelect;
