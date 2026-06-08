import { Router, type IRouter } from "express";
import { eq, isNull, sql } from "drizzle-orm";
import { db, studentsTable, assignmentsTable, assessmentsTable } from "@workspace/db";
import {
  CreateStudentBody,
  GetStudentParams,
  GetStudentResponse,
  UpdateStudentParams,
  UpdateStudentBody,
  UpdateStudentResponse,
  ListStudentsResponse,
  GetStudentProgressParams,
  GetStudentProgressResponse,
} from "@workspace/api-zod";
import { buildScopeContext, type ClassmateSession } from "../lib/scope-context";
import { requireRole } from "../middleware/require-role";

const router: IRouter = Router();

// ── GET /api/students ─────────────────────────────────────────────────────────

// Layer 1: only admin and teacher may list students.
router.get("/students", requireRole("admin", "teacher"), async (_req, res): Promise<void> => {
  const students = await db
    .select()
    .from(studentsTable)
    .where(isNull(studentsTable.deletedAt))
    .orderBy(studentsTable.name);

  res.json(
    ListStudentsResponse.parse(
      students.map((s) => ({
        ...s,
        avatarUrl: s.avatarUrl ?? null,
        createdAt: s.createdAt.toISOString(),
      })),
    ),
  );
});

// ── POST /api/students ────────────────────────────────────────────────────────

// Layer 1: only admin and teacher may create students.
router.post("/students", requireRole("admin", "teacher"), async (req, res): Promise<void> => {
  const scope = buildScopeContext(req.session as ClassmateSession);
  const parsed = CreateStudentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [student] = await db
    .insert(studentsTable)
    .values({
      name: parsed.data.name,
      email: parsed.data.email,
      grade: parsed.data.grade,
      avatarUrl: parsed.data.avatarUrl ?? null,
      enrolledCourseIds: [],
    })
    .returning();

  res.status(201).json(
    GetStudentResponse.parse({
      ...student,
      avatarUrl: student.avatarUrl ?? null,
      createdAt: student.createdAt.toISOString(),
    }),
  );

  void scope;
});

// ── GET /api/students/:id ─────────────────────────────────────────────────────

// Layer 1: only admin and teacher may view student detail.
router.get("/students/:id", requireRole("admin", "teacher"), async (req, res): Promise<void> => {
  const params = GetStudentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [student] = await db
    .select()
    .from(studentsTable)
    .where(eq(studentsTable.id, params.data.id));

  if (!student || student.deletedAt !== null) {
    res.status(404).json({ error: "Student not found" });
    return;
  }

  res.json(
    GetStudentResponse.parse({
      ...student,
      avatarUrl: student.avatarUrl ?? null,
      createdAt: student.createdAt.toISOString(),
    }),
  );
});

// ── PATCH /api/students/:id ───────────────────────────────────────────────────

// Layer 1: only admin and teacher may update students.
router.patch("/students/:id", requireRole("admin", "teacher"), async (req, res): Promise<void> => {
  const params = UpdateStudentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateStudentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Soft-delete guard: refuse to mutate a deleted student.
  const [existing] = await db
    .select({ id: studentsTable.id, deletedAt: studentsTable.deletedAt })
    .from(studentsTable)
    .where(eq(studentsTable.id, params.data.id));

  if (!existing || existing.deletedAt !== null) {
    res.status(404).json({ error: "Student not found" });
    return;
  }

  const [student] = await db
    .update(studentsTable)
    .set(parsed.data)
    .where(eq(studentsTable.id, params.data.id))
    .returning();

  if (!student) {
    res.status(404).json({ error: "Student not found" });
    return;
  }

  res.json(
    UpdateStudentResponse.parse({
      ...student,
      avatarUrl: student.avatarUrl ?? null,
      createdAt: student.createdAt.toISOString(),
    }),
  );
});

// ── GET /api/students/:id/progress ───────────────────────────────────────────

// Layer 1: only admin and teacher may view student progress.
router.get(
  "/students/:id/progress",
  requireRole("admin", "teacher"),
  async (req, res): Promise<void> => {
    const params = GetStudentProgressParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const studentId = params.data.id;
    const [student] = await db
      .select()
      .from(studentsTable)
      .where(eq(studentsTable.id, studentId));

    if (!student || student.deletedAt !== null) {
      res.status(404).json({ error: "Student not found" });
      return;
    }

    const assignments = await db
      .select()
      .from(assignmentsTable)
      .where(eq(assignmentsTable.studentId, studentId));

    const assessments = await db
      .select()
      .from(assessmentsTable)
      .where(eq(assessmentsTable.studentId, studentId));

    const completed = assignments.filter(
      (a) => a.status === "graded" || a.status === "submitted",
    ).length;
    const gradedAssignments = assignments.filter(
      (a) => a.status === "graded" && a.score != null,
    );
    const avgScore =
      gradedAssignments.length > 0
        ? gradedAssignments.reduce(
            (sum, a) => sum + ((a.score ?? 0) / a.maxScore) * 100,
            0,
          ) / gradedAssignments.length
        : 0;

    const topicsMastered: string[] = [];
    const topicsNeedingWork: string[] = [];
    for (const assessment of assessments) {
      topicsMastered.push(...(assessment.strengths as string[]));
      topicsNeedingWork.push(...(assessment.weaknesses as string[]));
    }

    const progress = {
      studentId,
      totalAssignments: assignments.length,
      completedAssignments: completed,
      averageScore: Math.round(avgScore * 10) / 10,
      completionRate:
        assignments.length > 0
          ? Math.round((completed / assignments.length) * 100) / 100
          : 0,
      topicsMastered: [...new Set(topicsMastered)].slice(0, 5),
      topicsNeedingWork: [...new Set(topicsNeedingWork)].slice(0, 5),
    };

    res.json(GetStudentProgressResponse.parse(progress));
  },
);

// ── DELETE /api/students/:id — soft delete ────────────────────────────────────

// Layer 1: only admin and teacher may delete students.
router.delete(
  "/students/:id",
  requireRole("admin", "teacher"),
  async (req, res): Promise<void> => {
    const scope = buildScopeContext(req.session as ClassmateSession);

    const params = GetStudentParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    // Soft-delete guard: refuse to delete an already-deleted student.
    const [existing] = await db
      .select({ id: studentsTable.id, deletedAt: studentsTable.deletedAt })
      .from(studentsTable)
      .where(eq(studentsTable.id, params.data.id));

    if (!existing || existing.deletedAt !== null) {
      res.status(404).json({ error: "Student not found" });
      return;
    }

    // Soft delete — never physically remove rows.
    await db
      .update(studentsTable)
      .set({ deletedAt: new Date(), deletedBy: scope.userId })
      .where(eq(studentsTable.id, params.data.id));

    res.status(204).send();
  },
);

export default router;
