import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
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
import { buildScopeContext, type ClassmateSession } from "../lib/scope-context";
import { ownershipDenied } from "../lib/query-contracts";
import { listAssignments, getAssignmentById, type AssignmentRow } from "../lib/assignments.queries";
import { assignmentPolicy, PolicyAuthorizationError } from "../lib/policies";

const router: IRouter = Router();

function serializeAssignment(a: AssignmentRow) {
  return {
    id: a.id,
    title: a.title,
    description: a.description,
    courseId: a.courseId,
    courseName: a.courseName,
    studentId: a.studentId,
    studentName: a.studentName,
    dueDate: a.dueDate,
    status: a.status,
    score: a.score ?? null,
    maxScore: a.maxScore,
    feedback: a.feedback ?? null,
    createdAt: a.createdAt.toISOString(),
  };
}

// ── GET /api/assignments ─────────────────────────────────────────────────────

router.get("/assignments", async (req, res): Promise<void> => {
  const scope = buildScopeContext(req.session as ClassmateSession);

  const queryParams = ListAssignmentsQueryParams.safeParse(req.query);
  if (!queryParams.success) {
    res.status(400).json({ error: queryParams.error.message });
    return;
  }

  // Layer 2 applied inside listAssignments() via assignmentPolicy.getScopeCondition()
  const assignments = await listAssignments(scope, {
    courseId: queryParams.data.courseId,
    studentId: queryParams.data.studentId,
  });

  res.json(ListAssignmentsResponse.parse(assignments.map(serializeAssignment)));
});

// ── POST /api/assignments ────────────────────────────────────────────────────

router.post("/assignments", async (req, res): Promise<void> => {
  const scope = buildScopeContext(req.session as ClassmateSession);
  const parsed = CreateAssignmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [student] = await db
    .select({ name: studentsTable.name })
    .from(studentsTable)
    .where(eq(studentsTable.id, parsed.data.studentId));

  const [course] = await db
    .select({ name: coursesTable.name })
    .from(coursesTable)
    .where(eq(coursesTable.id, parsed.data.courseId));

  const [assignment] = await db
    .insert(assignmentsTable)
    .values({ ...parsed.data, status: "pending", createdBy: scope.userId })
    .returning();

  await db.insert(activityTable).values({
    type: "assignment_submitted",
    description: `New assignment "${parsed.data.title}" created`,
    studentName: student?.name ?? "Unknown",
    courseName: course?.name ?? "Unknown",
  });

  res.status(201).json(
    GetAssignmentResponse.parse(
      serializeAssignment({
        ...assignment,
        studentName: student?.name ?? "Unknown",
        courseName: course?.name ?? "Unknown",
        deletedAt: null,
      }),
    ),
  );
});

// ── GET /api/assignments/:id ─────────────────────────────────────────────────

router.get("/assignments/:id", async (req, res): Promise<void> => {
  const scope = buildScopeContext(req.session as ClassmateSession);

  const params = GetAssignmentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const assignment = await getAssignmentById(params.data.id);
  if (!assignment) {
    res.status(404).json({ error: "Assignment not found" });
    return;
  }

  // Layer 3: delegate ownership check to AssignmentScopePolicy.
  // Services do not contain authorization rules — policies own that logic.
  try {
    assignmentPolicy.validateAccess(scope, assignment);
  } catch (err) {
    if (err instanceof PolicyAuthorizationError) {
      res.status(403).json(ownershipDenied("assignment", params.data.id));
      return;
    }
    throw err;
  }

  res.json(GetAssignmentResponse.parse(serializeAssignment(assignment)));
});

// ── PATCH /api/assignments/:id ───────────────────────────────────────────────

router.patch("/assignments/:id", async (req, res): Promise<void> => {
  const scope = buildScopeContext(req.session as ClassmateSession);

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

  const existing = await getAssignmentById(params.data.id);
  if (!existing) {
    res.status(404).json({ error: "Assignment not found" });
    return;
  }

  // Layer 3: enforce ownership before mutating.
  // A student must own the assignment; a parent must be a guardian of the student;
  // admin/teacher have global write access. Without this check a student
  // could PATCH any assignment ID they enumerate.
  try {
    assignmentPolicy.validateAccess(scope, existing);
  } catch (err) {
    if (err instanceof PolicyAuthorizationError) {
      res.status(403).json(ownershipDenied("assignment", params.data.id));
      return;
    }
    throw err;
  }

  const [updated] = await db
    .update(assignmentsTable)
    .set({ ...parsed.data, updatedAt: new Date(), updatedBy: scope.userId })
    .where(eq(assignmentsTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Assignment not found" });
    return;
  }

  if (parsed.data.status === "graded") {
    await db.insert(activityTable).values({
      type: "assignment_graded",
      description: `Assignment "${updated.title}" graded${
        parsed.data.score != null ? ` with score ${parsed.data.score}/${updated.maxScore}` : ""
      }`,
      studentName: existing.studentName,
      courseName: existing.courseName,
    });
  }

  res.json(
    UpdateAssignmentResponse.parse(
      serializeAssignment({
        ...updated,
        studentName: existing.studentName,
        courseName: existing.courseName,
        deletedAt: updated.deletedAt ?? null,
      }),
    ),
  );
});

export default router;
