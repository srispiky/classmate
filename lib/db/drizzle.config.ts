import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  // Migration output directory — used by "drizzle-kit generate" and "drizzle-kit migrate".
  // All future schema changes must be made via generate+migrate, not push.
  out: path.join(__dirname, "./migrations"),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
