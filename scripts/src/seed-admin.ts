import bcrypt from "bcryptjs";
import { createCipheriv, randomBytes } from "crypto";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getKey(): Buffer {
  const raw = process.env["PASSWORD_ENCRYPTION_KEY"];
  if (!raw) throw new Error("PASSWORD_ENCRYPTION_KEY is not set");
  const buf = Buffer.from(raw, "hex");
  if (buf.length !== 32) throw new Error("PASSWORD_ENCRYPTION_KEY must be 64 hex chars");
  return buf;
}

async function hashPassword(password: string): Promise<string> {
  const bcryptHash = await bcrypt.hash(password, 12);
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(bcryptHash, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

const USERNAME = process.env["ADMIN_USER"] ?? "admin";
const PASSWORD = process.env["ADMIN_PASS"] ?? "classmate123";
const DISPLAY  = process.env["ADMIN_NAME"] ?? "Administrator";

const hash = await hashPassword(PASSWORD);

const existing = await db.select().from(usersTable).where(eq(usersTable.username, USERNAME)).limit(1);

if (existing.length > 0) {
  await db
    .update(usersTable)
    .set({ passwordHash: hash, displayName: DISPLAY, isActive: true })
    .where(eq(usersTable.username, USERNAME));
  console.log(`Updated user '${USERNAME}'`);
} else {
  await db.insert(usersTable).values({
    username: USERNAME,
    passwordHash: hash,
    displayName: DISPLAY,
    role: "admin",
  });
  console.log(`Created user '${USERNAME}'`);
}

console.log(`Password: ${PASSWORD}`);
process.exit(0);
