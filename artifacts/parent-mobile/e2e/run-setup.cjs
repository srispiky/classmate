#!/usr/bin/env node
/**
 * Plain CJS setup script — creates E2E test data (parent user + student + guardian link).
 * Run: node e2e/run-setup.cjs
 * Requires: DATABASE_URL, PASSWORD_ENCRYPTION_KEY env vars.
 */
const { createCipheriv, randomBytes } = require("crypto");
const path = require("path");
const fs = require("fs");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const SALT_ROUNDS = 12;
const TEST_PASSWORD = "E2eParent1!";

function getKey() {
  const raw = process.env.PASSWORD_ENCRYPTION_KEY;
  if (!raw) throw new Error("PASSWORD_ENCRYPTION_KEY is required");
  const buf = Buffer.from(raw, "hex");
  if (buf.length !== 32) throw new Error("PASSWORD_ENCRYPTION_KEY must be 64 hex chars");
  return buf;
}

function encryptValue(plaintext) {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

async function hashPassword(password) {
  const bcrypt = require(path.join(__dirname, "../node_modules/bcryptjs"));
  const bcryptHash = await bcrypt.hash(password, SALT_ROUNDS);
  return encryptValue(bcryptHash);
}

async function main() {
  const { Client } = require(path.join(__dirname, "../node_modules/pg"));
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const suffix = Date.now();
  const parentUsername = `e2e_parent_${suffix}`;
  const studentName = `E2E Student ${suffix}`;

  const adminHash = await hashPassword(TEST_PASSWORD);
  const parentHash = await hashPassword(TEST_PASSWORD);

  const adminResult = await client.query(
    `INSERT INTO users (username, password_hash, display_name, role, is_active, created_at, updated_at)
     VALUES ($1, $2, 'E2E Admin', 'admin', true, NOW(), NOW())
     RETURNING id`,
    [`e2e_admin_${suffix}`, adminHash],
  );
  const adminId = adminResult.rows[0].id;

  const parentResult = await client.query(
    `INSERT INTO users (username, password_hash, display_name, role, is_active, created_by, updated_by, created_at, updated_at)
     VALUES ($1, $2, 'E2E Parent', 'parent', true, $3, $3, NOW(), NOW())
     RETURNING id`,
    [parentUsername, parentHash, adminId],
  );
  const parentId = parentResult.rows[0].id;

  const studentResult = await client.query(
    `INSERT INTO students (name, email, grade, enrolled_course_ids, created_by, updated_by, created_at, updated_at)
     VALUES ($1, $2, '8', '{}', $3, $3, NOW(), NOW())
     RETURNING id`,
    [studentName, `e2e_${suffix}@test.invalid`, adminId],
  );
  const studentId = studentResult.rows[0].id;

  await client.query(
    `INSERT INTO student_guardians (user_id, student_id, relationship, created_by, created_at)
     VALUES ($1, $2, 'parent', $3, NOW())`,
    [parentId, studentId, adminId],
  );

  await client.end();

  const state = {
    adminId,
    parentId,
    parentUsername,
    parentPassword: TEST_PASSWORD,
    studentId,
    studentName,
  };

  const stateFile = path.join(__dirname, ".test-state.json");
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  console.log("Test data created:", JSON.stringify(state, null, 2));
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
