import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: "./src/schema/index.ts",
  // Migration output directory — used by "drizzle-kit generate" and "drizzle-kit migrate".
  // All future schema changes must be made via generate+migrate, not push.
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  // Exclude the session table — it is managed by connect-pg-simple, not Drizzle.
  // Without this, drizzle-kit push prompts to delete it on every run.
  tablesFilter: ["!session"],
});
