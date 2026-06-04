import { pgTable, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createSelectSchema } from "drizzle-zod";

export const rbacVersionTable = pgTable("rbac_version", {
  id: serial("id").primaryKey(),
  version: integer("version").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const selectRbacVersionSchema = createSelectSchema(rbacVersionTable);
export type RbacVersion = typeof rbacVersionTable.$inferSelect;
