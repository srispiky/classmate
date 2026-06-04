import { db, studentsTable, courseEnrollmentsTable, users } from "@workspace/db";
import { eq } from "drizzle-orm";

const ENROLLED_BY_USER_ID = parseInt(process.env["ENROLLED_BY_USER_ID"] ?? "1", 10);

async function verifyAdminUser(): Promise<void> {
  const rows = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(eq(users.id, ENROLLED_BY_USER_ID))
    .limit(1);

  if (rows.length === 0) {
    console.error(
      `ERROR: No user found with ID ${ENROLLED_BY_USER_ID}.\n` +
        `       Set ENROLLED_BY_USER_ID environment variable to a valid user ID.`,
    );
    process.exit(1);
  }

  console.log(`Using user ${rows[0]!.id} (${rows[0]!.username}) as enrolled_by for historical records.`);
}

async function migrateEnrollments(): Promise<{ inserted: number; skipped: number }> {
  const students = await db
    .select({
      id: studentsTable.id,
      name: studentsTable.name,
      enrolledCourseIds: studentsTable.enrolledCourseIds,
    })
    .from(studentsTable);

  const studentsWithEnrollments = students.filter(
    (s) => Array.isArray(s.enrolledCourseIds) && s.enrolledCourseIds.length > 0,
  );

  console.log(`\nFound ${students.length} student(s) total.`);
  console.log(`Found ${studentsWithEnrollments.length} student(s) with course enrollments to migrate.\n`);

  let totalInserted = 0;
  let totalSkipped = 0;

  for (const student of studentsWithEnrollments) {
    const uniqueCourseIds = [...new Set(student.enrolledCourseIds)];

    const values = uniqueCourseIds.map((courseId) => ({
      studentId: student.id,
      courseId,
      enrolledBy: ENROLLED_BY_USER_ID,
      isActive: true as const,
    }));

    const inserted = await db
      .insert(courseEnrollmentsTable)
      .values(values)
      .onConflictDoNothing()
      .returning({ id: courseEnrollmentsTable.id });

    const insertedCount = inserted.length;
    const skippedCount = values.length - insertedCount;
    totalInserted += insertedCount;
    totalSkipped += skippedCount;

    const skippedNote = skippedCount > 0 ? ` (${skippedCount} already existed)` : "";
    console.log(`  Student ${student.id} (${student.name}): ${insertedCount} row(s) inserted${skippedNote}`);
  }

  return { inserted: totalInserted, skipped: totalSkipped };
}

async function verifyCounts(students: Array<{ id: number; name: string; enrolledCourseIds: number[] }>): Promise<boolean> {
  console.log("\n=== CE-03 Verification ===");
  console.log("Comparing enrolled_course_ids JSON array lengths against course_enrollments row counts...\n");

  const activeEnrollments = await db
    .select({ studentId: courseEnrollmentsTable.studentId })
    .from(courseEnrollmentsTable)
    .where(eq(courseEnrollmentsTable.isActive, true));

  const ceCountByStudent = new Map<number, number>();
  for (const row of activeEnrollments) {
    ceCountByStudent.set(row.studentId, (ceCountByStudent.get(row.studentId) ?? 0) + 1);
  }

  let mismatchCount = 0;

  for (const student of students) {
    const uniqueJsonCount = new Set(student.enrolledCourseIds ?? []).size;
    const ceCount = ceCountByStudent.get(student.id) ?? 0;

    if (uniqueJsonCount !== ceCount) {
      console.error(
        `  MISMATCH — Student ${student.id} (${student.name}): ` +
          `JSON has ${uniqueJsonCount} unique course(s), course_enrollments has ${ceCount} active row(s)`,
      );
      mismatchCount++;
    }
  }

  if (mismatchCount === 0) {
    console.log(`  ✓ CE-03 PASSED — all ${students.length} student(s) match.`);
    console.log(`  ✓ Total active rows in course_enrollments: ${activeEnrollments.length}`);
    return true;
  }

  console.error(`\n  ✗ CE-03 FAILED — ${mismatchCount} mismatch(es) found.`);
  console.error(`    Do NOT deploy SessionEnricher migration (Chunk J) until this is resolved.`);
  return false;
}

async function main(): Promise<void> {
  console.log("============================================");
  console.log(" Classmate Connect — course_enrollments migration");
  console.log(" Sprint 3 · Deliverable I");
  console.log("============================================\n");

  await verifyAdminUser();

  const students = await db
    .select({
      id: studentsTable.id,
      name: studentsTable.name,
      enrolledCourseIds: studentsTable.enrolledCourseIds,
    })
    .from(studentsTable);

  const { inserted, skipped } = await migrateEnrollments();

  console.log(
    `\nMigration complete: ${inserted} row(s) inserted, ${skipped} row(s) skipped (already existed).\n`,
  );

  const passed = await verifyCounts(students);

  if (!passed) {
    process.exit(1);
  }

  console.log("\n============================================");
  console.log(" Migration successful. Next step:");
  console.log(" Deploy Chunk J (SessionEnricher migration)");
  console.log("============================================\n");
}

main().catch((err: unknown) => {
  console.error("\nFatal error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
