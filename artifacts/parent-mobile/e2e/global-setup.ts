import { createCipheriv, randomBytes } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { Client } from "pg";
import bcrypt from "bcryptjs";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const SALT_ROUNDS = 12;
const TEST_PASSWORD = "E2eParent1!";

function getEncryptionKey(): Buffer {
  const raw = process.env.PASSWORD_ENCRYPTION_KEY;
  if (!raw) throw new Error("PASSWORD_ENCRYPTION_KEY is required for test setup");
  const buf = Buffer.from(raw, "hex");
  if (buf.length !== 32) throw new Error("PASSWORD_ENCRYPTION_KEY must be 64 hex chars");
  return buf;
}

function encryptValue(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

async function hashPassword(password: string): Promise<string> {
  const bcryptHash = await bcrypt.hash(password, SALT_ROUNDS);
  return encryptValue(bcryptHash);
}

export interface TestState {
  adminId: number;
  parentId: number;
  parentUsername: string;
  parentPassword: string;
  studentId: number;
  studentName: string;
}

const STATE_FILE = path.join(__dirname, ".test-state.json");

export default async function globalSetup() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const suffix = Date.now();
  const parentUsername = `e2e_parent_${suffix}`;
  const studentName = `E2E Student ${suffix}`;

  const adminHash = await hashPassword(TEST_PASSWORD);
  const parentHash = await hashPassword(TEST_PASSWORD);

  const adminResult = await client.query<{ id: number }>(
    `INSERT INTO users (username, password_hash, display_name, role, is_active, created_at, updated_at)
     VALUES ($1, $2, 'E2E Admin', 'admin', true, NOW(), NOW())
     RETURNING id`,
    [`e2e_admin_${suffix}`, adminHash],
  );
  const adminId: number = adminResult.rows[0]!.id;

  const parentResult = await client.query<{ id: number }>(
    `INSERT INTO users (username, password_hash, display_name, role, is_active, created_by, updated_by, created_at, updated_at)
     VALUES ($1, $2, 'E2E Parent', 'parent', true, $3, $3, NOW(), NOW())
     RETURNING id`,
    [parentUsername, parentHash, adminId],
  );
  const parentId: number = parentResult.rows[0]!.id;

  const studentResult = await client.query<{ id: number }>(
    `INSERT INTO students (name, email, grade, enrolled_course_ids, created_by, updated_by, created_at, updated_at)
     VALUES ($1, $2, '8', '{}', $3, $3, NOW(), NOW())
     RETURNING id`,
    [studentName, `e2e_${suffix}@test.invalid`, adminId],
  );
  const studentId: number = studentResult.rows[0]!.id;

  await client.query(
    `INSERT INTO student_guardians (user_id, student_id, relationship, created_by, created_at)
     VALUES ($1, $2, 'parent', $3, NOW())`,
    [parentId, studentId, adminId],
  );

  await client.end();

  const state: TestState = {
    adminId,
    parentId,
    parentUsername,
    parentPassword: TEST_PASSWORD,
    studentId,
    studentName,
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

  process.env.E2E_PARENT_USERNAME = parentUsername;
  process.env.E2E_PARENT_PASSWORD = TEST_PASSWORD;
  process.env.E2E_STUDENT_ID = String(studentId);
  process.env.E2E_STUDENT_NAME = studentName;
}
