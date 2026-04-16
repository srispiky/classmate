import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, assignmentsTable, studentsTable, coursesTable, activityTable } from "@workspace/db";
import {
  CreateAssignmentBody,
  GetAssignmentParams,
  GetAssignmentResponse,
  UpdateAssignmentParams,
  UpdateAssignmentBody,
  UpdateAssignmentResponse,
  ListAssignmentsQueryParams,
  ListAssignmentsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

function serializeAssignment(a: typeof assignmentsTable.$inferSelect, studentName: string, courseName: string) {
  return {
    ...a,
    studentName,
    courseName,
    score: a.score ?? null,
    feedback: a.feedback ?? null,
    createdAt: a.createdAt.toISOString(),
  };
}

router.get("/assignments", async (req, res): Promise<void> => {
  const queryParams = ListAssignmentsQueryParams.safeParse(req.query);
  if (!queryParams.success) {
    res.status(400).json({ error: queryParams.error.message });
    return;
  }

  const conditions = [];
  if (queryParams.data.courseId) conditions.push(eq(assignmentsTable.courseId, queryParams.data.courseId));
  if (queryParams.data.studentId) conditions.push(eq(assignmentsTable.studentId, queryParams.data.studentId));

  const assignments = await db.select().from(assignmentsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(assignmentsTable.dueDate);

  const enriched = await Promise.all(assignments.map(async (a) => {
    const [student] = await db.select({ name: studentsTable.name }).from(studentsTable).where(eq(studentsTable.id, a.studentId));
    const [course] = await db.select({ name: coursesTable.name }).from(coursesTable).where(eq(coursesTable.id, a.courseId));
    return serializeAssignment(a, student?.name ?? "Unknown", course?.name ?? "Unknown");
  }));

  res.json(ListAssignmentsResponse.parse(enriched));
});

router.post("/assignments", async (req, res): Promise<void> => {
  const parsed = CreateAssignmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [student] = await db.select({ name: studentsTable.name }).from(studentsTable).where(eq(studentsTable.id, parsed.data.studentId));
  const [course] = await db.select({ name: coursesTable.name }).from(coursesTable).where(eq(coursesTable.id, parsed.data.courseId));

  const [assignment] = await db.insert(assignmentsTable).values({
    ...parsed.data,
    status: "pending",
  }).returning();

  await db.insert(activityTable).values({
    type: "assignment_submitted",
    description: `New assignment "${parsed.data.title}" created`,
    studentName: student?.name ?? "Unknown",
    courseName: course?.name ?? "Unknown",
  });

  res.status(201).json(GetAssignmentResponse.parse(serializeAssignment(assignment, student?.name ?? "Unknown", course?.name ?? "Unknown")));
});

router.get("/assignments/:id", async (req, res): Promise<void> => {
  const params = GetAssignmentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [a] = await db.select().from(assignmentsTable).where(eq(assignmentsTable.id, params.data.id));
  if (!a) {
    res.status(404).json({ error: "Assignment not found" });
    return;
  }
  const [student] = await db.select({ name: studentsTable.name }).from(studentsTable).where(eq(studentsTable.id, a.studentId));
  const [course] = await db.select({ name: coursesTable.name }).from(coursesTable).where(eq(coursesTable.id, a.courseId));
  res.json(GetAssignmentResponse.parse(serializeAssignment(a, student?.name ?? "Unknown", course?.name ?? "Unknown")));
});

router.patch("/assignments/:id", async (req, res): Promise<void> => {
  const params = UpdateAssignmentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateAssignmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [a] = await db.update(assignmentsTable).set(parsed.data).where(eq(assignmentsTable.id, params.data.id)).returning();
  if (!a) {
    res.status(404).json({ error: "Assignment not found" });
    return;
  }

  const [student] = await db.select({ name: studentsTable.name }).from(studentsTable).where(eq(studentsTable.id, a.studentId));
  const [course] = await db.select({ name: coursesTable.name }).from(coursesTable).where(eq(coursesTable.id, a.courseId));

  if (parsed.data.status === "graded") {
    await db.insert(activityTable).values({
      type: "assignment_graded",
      description: `Assignment "${a.title}" graded${parsed.data.score != null ? ` with score ${parsed.data.score}/${a.maxScore}` : ""}`,
      studentName: student?.name ?? "Unknown",
      courseName: course?.name ?? "Unknown",
    });
  }

  res.json(UpdateAssignmentResponse.parse(serializeAssignment(a, student?.name ?? "Unknown", course?.name ?? "Unknown")));
});

export default router;
