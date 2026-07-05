import * as fs from "fs";
import * as path from "path";
import { Client } from "pg";
import type { TestState } from "./global-setup";

const STATE_FILE = path.join(__dirname, ".test-state.json");

export default async function globalTeardown() {
  if (!fs.existsSync(STATE_FILE)) return;

  const state: TestState = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  await client.query(
    `DELETE FROM student_guardians WHERE user_id = $1`,
    [state.parentId],
  );

  await client.query(
    `DELETE FROM students WHERE id = $1`,
    [state.studentId],
  );

  await client.query(
    `DELETE FROM users WHERE id = ANY($1::int[])`,
    [[state.parentId, state.adminId]],
  );

  await client.end();

  fs.unlinkSync(STATE_FILE);
}
