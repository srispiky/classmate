import { pgTable, bigserial, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { rolesTable } from "./roles";
import { permissionsTable } from "./permissions";
import { usersTable } from "./users";

export const rolePermissionsTable = pgTable(
  "role_permissions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    roleId: integer("role_id")
      .notNull()
      .references(() => rolesTable.id, { onDelete: "cascade" }),
    permissionId: integer("permission_id")
      .notNull()
      .references(() => permissionsTable.id, { onDelete: "cascade" }),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    grantedBy: integer("granted_by")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
  },
  (table) => ({
    uniqueRolePermission: uniqueIndex("uq_role_permissions").on(table.roleId, table.permissionId),
  }),
);

export const insertRolePermissionSchema = createInsertSchema(rolePermissionsTable).omit({
  id: true,
  grantedAt: true,
});
export const selectRolePermissionSchema = createSelectSchema(rolePermissionsTable);
export type InsertRolePermission = z.infer<typeof insertRolePermissionSchema>;
export type RolePermission = typeof rolePermissionsTable.$inferSelect;
