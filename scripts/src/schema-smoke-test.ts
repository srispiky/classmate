/**
 * Classmate Connect — Post-merge Schema Smoke Test
 *
 * Verifies that the live database schema matches the Drizzle ORM schema by
 * running a zero-row SELECT against every table and every column defined in
 * the schema.  Any missing table or column causes PostgreSQL to reject the
 * query, and this script exits non-zero with a clear diagnostic.
 *
 * Run automatically by post-merge.sh after `drizzle-kit push`.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run schema-smoke-test
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — DATABASE_URL is not set, DB is unreachable, or one or more tables/columns are missing
 */

import { sql } from "drizzle-orm";

// Guard: if DATABASE_URL is not set, fail loudly so broken environments are
// caught immediately rather than silently passing.  post-merge.sh guards for
// this before invoking the script; this exit is a safety net for direct
// invocations without a database configured.
if (!process.env.DATABASE_URL) {
  console.error(
    "schema-smoke-test: DATABASE_URL is not set — cannot verify DB schema.",
  );
  console.error(
    "Set DATABASE_URL to a reachable PostgreSQL connection string and re-run.",
  );
  process.exit(1);
}

const {
  db,
  pool,
  usersTable,
  studentsTable,
  coursesTable,
  assignmentsTable,
  notesTable,
  assessmentsTable,
  activityTable,
  rolesTable,
  permissionsTable,
  rolePermissionsTable,
  userRolesTable,
  studentGuardiansTable,
  courseEnrollmentsTable,
  rbacVersionTable,
  announcementsTable,
} = await import("@workspace/db");

interface CheckResult {
  table: string;
  status: "ok" | "fail";
  error?: string;
}

async function checkTable(
  tableName: string,
  query: () => Promise<unknown>,
): Promise<CheckResult> {
  try {
    await query();
    return { table: tableName, status: "ok" };
  } catch (err: unknown) {
    return {
      table: tableName,
      status: "fail",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

const checks: Array<{ name: string; fn: () => Promise<unknown> }> = [
  {
    name: "users (including push_token)",
    fn: () =>
      db
        .select({
          id: usersTable.id,
          username: usersTable.username,
          passwordHash: usersTable.passwordHash,
          displayName: usersTable.displayName,
          role: usersTable.role,
          isActive: usersTable.isActive,
          pushToken: usersTable.pushToken,
          createdAt: usersTable.createdAt,
          updatedAt: usersTable.updatedAt,
          createdBy: usersTable.createdBy,
          updatedBy: usersTable.updatedBy,
        })
        .from(usersTable)
        .limit(0),
  },
  {
    name: "students",
    fn: () =>
      db
        .select({
          id: studentsTable.id,
          name: studentsTable.name,
          email: studentsTable.email,
          grade: studentsTable.grade,
          avatarUrl: studentsTable.avatarUrl,
          enrolledCourseIds: studentsTable.enrolledCourseIds,
          userId: studentsTable.userId,
          createdAt: studentsTable.createdAt,
          updatedAt: studentsTable.updatedAt,
          createdBy: studentsTable.createdBy,
          updatedBy: studentsTable.updatedBy,
          deletedAt: studentsTable.deletedAt,
          deletedBy: studentsTable.deletedBy,
        })
        .from(studentsTable)
        .limit(0),
  },
  {
    name: "courses",
    fn: () =>
      db
        .select({
          id: coursesTable.id,
          name: coursesTable.name,
          description: coursesTable.description,
          subject: coursesTable.subject,
          grade: coursesTable.grade,
          academicYear: coursesTable.academicYear,
          teacherName: coursesTable.teacherName,
          teacherId: coursesTable.teacherId,
          studentCount: coursesTable.studentCount,
          status: coursesTable.status,
          createdAt: coursesTable.createdAt,
          updatedAt: coursesTable.updatedAt,
          deletedAt: coursesTable.deletedAt,
          createdBy: coursesTable.createdBy,
          updatedBy: coursesTable.updatedBy,
          deletedBy: coursesTable.deletedBy,
        })
        .from(coursesTable)
        .limit(0),
  },
  {
    name: "assignments",
    fn: () => db.select().from(assignmentsTable).limit(0),
  },
  {
    name: "notes",
    fn: () => db.select().from(notesTable).limit(0),
  },
  {
    name: "assessments",
    fn: () => db.select().from(assessmentsTable).limit(0),
  },
  {
    name: "activity",
    fn: () => db.select().from(activityTable).limit(0),
  },
  {
    name: "roles",
    fn: () =>
      db
        .select({
          id: rolesTable.id,
          name: rolesTable.name,
          displayName: rolesTable.displayName,
          description: rolesTable.description,
          isSystem: rolesTable.isSystem,
          createdAt: rolesTable.createdAt,
        })
        .from(rolesTable)
        .limit(0),
  },
  {
    name: "permissions",
    fn: () =>
      db
        .select({
          id: permissionsTable.id,
          key: permissionsTable.key,
          description: permissionsTable.description,
          resource: permissionsTable.resource,
          action: permissionsTable.action,
          createdAt: permissionsTable.createdAt,
        })
        .from(permissionsTable)
        .limit(0),
  },
  {
    name: "role_permissions",
    fn: () => db.select().from(rolePermissionsTable).limit(0),
  },
  {
    name: "user_roles",
    fn: () =>
      db
        .select({
          id: userRolesTable.id,
          userId: userRolesTable.userId,
          roleId: userRolesTable.roleId,
          grantedAt: userRolesTable.grantedAt,
          grantedBy: userRolesTable.grantedBy,
          expiresAt: userRolesTable.expiresAt,
          revokedAt: userRolesTable.revokedAt,
          revokedBy: userRolesTable.revokedBy,
        })
        .from(userRolesTable)
        .limit(0),
  },
  {
    name: "student_guardians",
    fn: () =>
      db
        .select({
          id: studentGuardiansTable.id,
          studentId: studentGuardiansTable.studentId,
          userId: studentGuardiansTable.userId,
          relationship: studentGuardiansTable.relationship,
          createdAt: studentGuardiansTable.createdAt,
          createdBy: studentGuardiansTable.createdBy,
        })
        .from(studentGuardiansTable)
        .limit(0),
  },
  {
    name: "course_enrollments",
    fn: () =>
      db
        .select({
          id: courseEnrollmentsTable.id,
          studentId: courseEnrollmentsTable.studentId,
          courseId: courseEnrollmentsTable.courseId,
          enrolledAt: courseEnrollmentsTable.enrolledAt,
          enrolledBy: courseEnrollmentsTable.enrolledBy,
          isActive: courseEnrollmentsTable.isActive,
          droppedAt: courseEnrollmentsTable.droppedAt,
          droppedBy: courseEnrollmentsTable.droppedBy,
        })
        .from(courseEnrollmentsTable)
        .limit(0),
  },
  {
    name: "rbac_version",
    fn: () =>
      db
        .select({
          id: rbacVersionTable.id,
          version: rbacVersionTable.version,
          updatedAt: rbacVersionTable.updatedAt,
        })
        .from(rbacVersionTable)
        .limit(0),
  },
  {
    name: "announcements",
    fn: () =>
      db
        .select({
          id: announcementsTable.id,
          title: announcementsTable.title,
          content: announcementsTable.content,
          courseId: announcementsTable.courseId,
          authorName: announcementsTable.authorName,
          priority: announcementsTable.priority,
          createdAt: announcementsTable.createdAt,
          updatedAt: announcementsTable.updatedAt,
          deletedAt: announcementsTable.deletedAt,
          createdBy: announcementsTable.createdBy,
          updatedBy: announcementsTable.updatedBy,
          deletedBy: announcementsTable.deletedBy,
        })
        .from(announcementsTable)
        .limit(0),
  },
];

console.log("schema-smoke-test: verifying live DB schema against ORM definitions…\n");

// Connectivity check — fail fast with a clear message before any table checks.
try {
  await db.execute(sql`SELECT 1`);
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`schema-smoke-test: cannot connect to database — ${msg}`);
  console.error("Check that DATABASE_URL is set correctly and the database is reachable.");
  await pool.end();
  process.exit(1);
}

let passed = 0;
let failed = 0;
const failures: CheckResult[] = [];

for (const check of checks) {
  const result = await checkTable(check.name, check.fn);
  if (result.status === "ok") {
    console.log(`  ✓  ${result.table}`);
    passed++;
  } else {
    console.error(`  ✗  ${result.table}`);
    console.error(`       ${result.error}`);
    failed++;
    failures.push(result);
  }
}

await pool.end();

console.log(`\nschema-smoke-test: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.error("\nMigration or push did not fully apply. Failing tables:");
  for (const f of failures) {
    console.error(`  • ${f.table}: ${f.error}`);
  }
  console.error(
    "\nRun `pnpm --filter @workspace/db run push` and check for errors, then re-run post-merge.sh.",
  );
  process.exit(1);
}

console.log("schema-smoke-test: all checks passed — DB schema is in sync.");
process.exit(0);
