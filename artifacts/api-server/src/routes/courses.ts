import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, coursesTable, createCourseInputSchema, updateCourseInputSchema } from "@workspace/db";
import { GetCourseParams } from "@workspace/api-zod";
import { buildScopeContext, type ClassmateSession } from "../lib/scope-context";
import { ownershipDenied } from "../lib/query-contracts";
import { PolicyAuthorizationError } from "../lib/policies";
import { coursePolicy } from "../shared/auth/policies/course-scope-policy";
import { listCourses, getCourseById, type CourseRow } from "../lib/courses.queries";
import { requireRole } from "../middleware/require-role";

const router: IRouter = Router();

function serializeCourse(c: CourseRow) {
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    subject: c.subject,
    grade: c.grade ?? null,
    academicYear: c.academicYear ?? null,
    teacherName: c.teacherName,
    teacherId: c.teacherId ?? null,
    studentCount: c.studentCount,
    status: c.status,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    createdBy: c.createdBy ?? null,
    updatedBy: c.updatedBy ?? null,
  };
}

// ── GET /api/courses ──────────────────────────────────────────────────────────

// Layer 1: only admin and teacher may access the teacher-facing course list.
// Student/parent course access is served by /student/courses instead.
router.get("/courses", requireRole("admin", "teacher"), async (req, res): Promise<void> => {
  const scope = buildScopeContext(req.session as ClassmateSession);

  // Layer 2 applied inside listCourses() via CourseScopePolicy.getScopeCondition().
  // Admin sees all; teacher filtered to ownedCourseIds. No in-memory filtering.
  const courses = await listCourses(scope);
  res.json(courses.map(serializeCourse));
});

// ── GET /api/courses/:id ──────────────────────────────────────────────────────

// Layer 1: only admin and teacher may access teacher-facing course detail.
// Student/parent course detail is served by /student/courses/:id instead.
router.get("/courses/:id", requireRole("admin", "teacher"), async (req, res): Promise<void> => {
  const scope = buildScopeContext(req.session as ClassmateSession);

  const params = GetCourseParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  // Step 1: fetch by ID with soft-delete guard. Returns null for deleted courses → 404.
  const course = await getCourseById(params.data.id);
  if (!course) {
    res.status(404).json({ error: "Course not found" });
    return;
  }

  // Step 2: Layer 3 — delegate course-access check to CourseScopePolicy.
  // Services do not contain authorization rules — policies own that logic.
  // Throws CourseAuthorizationError (extends PolicyAuthorizationError) on denial.
  try {
    coursePolicy.validateAccess(scope, course);
  } catch (err) {
    if (err instanceof PolicyAuthorizationError) {
      res.status(403).json(ownershipDenied("course", params.data.id));
      return;
    }
    throw err;
  }

  res.json(serializeCourse(course));
});

// ── POST /api/courses ─────────────────────────────────────────────────────────

// Layer 1: only admin and teacher may create courses (enforced by requireRole middleware).
router.post("/courses", requireRole("admin", "teacher"), async (req, res): Promise<void> => {
  const scope = buildScopeContext(req.session as ClassmateSession);

  const parsed = createCourseInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [course] = await db
    .insert(coursesTable)
    .values({ ...parsed.data, createdBy: scope.userId })
    .returning();

  res.status(201).json(serializeCourse(course));
});

// ── PUT /api/courses/:id ──────────────────────────────────────────────────────

// Layer 1: only admin and teacher may update courses (enforced by requireRole middleware).
router.put("/courses/:id", requireRole("admin", "teacher"), async (req, res): Promise<void> => {
  const scope = buildScopeContext(req.session as ClassmateSession);

  const params = GetCourseParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = updateCourseInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Pre-fetch with soft-delete guard to (a) return 404 for deleted courses and
  // (b) supply the course.id required for Layer 3 authorization.
  const existing = await getCourseById(params.data.id);
  if (!existing) {
    res.status(404).json({ error: "Course not found" });
    return;
  }

  // Layer 3: teacher can only update their own courses. Admin unrestricted.
  try {
    coursePolicy.validateAccess(scope, existing);
  } catch (err) {
    if (err instanceof PolicyAuthorizationError) {
      res.status(403).json(ownershipDenied("course", params.data.id));
      return;
    }
    throw err;
  }

  const [updated] = await db
    .update(coursesTable)
    .set({ ...parsed.data, updatedAt: new Date(), updatedBy: scope.userId })
    .where(eq(coursesTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Course not found" });
    return;
  }

  res.json(serializeCourse(updated));
});

// ── DELETE /api/courses/:id — soft delete ─────────────────────────────────────

// Layer 1: only admin and teacher may delete courses (enforced by requireRole middleware).
router.delete("/courses/:id", requireRole("admin", "teacher"), async (req, res): Promise<void> => {
  const scope = buildScopeContext(req.session as ClassmateSession);

  const params = GetCourseParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  // Pre-fetch to (a) return 404 for already-deleted courses and
  // (b) supply the course.id required for Layer 3 authorization.
  const existing = await getCourseById(params.data.id);
  if (!existing) {
    res.status(404).json({ error: "Course not found" });
    return;
  }

  // Layer 3: teacher can only delete their own courses. Admin unrestricted.
  try {
    coursePolicy.validateAccess(scope, existing);
  } catch (err) {
    if (err instanceof PolicyAuthorizationError) {
      res.status(403).json(ownershipDenied("course", params.data.id));
      return;
    }
    throw err;
  }

  // Soft delete — never physically remove rows.
  await db
    .update(coursesTable)
    .set({ deletedAt: new Date(), updatedAt: new Date(), updatedBy: scope.userId, deletedBy: scope.userId })
    .where(eq(coursesTable.id, params.data.id));

  res.status(204).send();
});

export default router;
