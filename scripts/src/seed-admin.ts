import bcrypt from "bcryptjs";
import { db, users } from "@workspace/db";
import { eq } from "drizzle-orm";

const USERNAME = process.env["ADMIN_USER"] ?? "admin";
const PASSWORD = process.env["ADMIN_PASS"] ?? "classmate123";
const DISPLAY  = process.env["ADMIN_NAME"] ?? "Administrator";

const hash = await bcrypt.hash(PASSWORD, 12);

const existing = await db.select().from(users).where(eq(users.username, USERNAME)).limit(1);

if (existing.length > 0) {
  await db
    .update(users)
    .set({ passwordHash: hash, displayName: DISPLAY, isActive: true })
    .where(eq(users.username, USERNAME));
  console.log(`Updated user '${USERNAME}'`);
} else {
  await db.insert(users).values({
    username: USERNAME,
    passwordHash: hash,
    displayName: DISPLAY,
    role: "admin",
  });
  console.log(`Created user '${USERNAME}'`);
}

console.log(`Password: ${PASSWORD}`);
process.exit(0);
