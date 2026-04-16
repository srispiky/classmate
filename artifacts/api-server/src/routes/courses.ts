import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, coursesTable } from "@workspace/db";
import {
  CreateCourseBody,
  GetCourseParams,
  GetCourseResponse,
  ListCoursesResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

function serializeCourse(c: typeof coursesTable.$inferSelect) {
  return { ...c, createdAt: c.createdAt.toISOString() };
}

router.get("/courses", async (_req, res): Promise<void> => {
  const courses = await db.select().from(coursesTable).orderBy(coursesTable.name);
  res.json(ListCoursesResponse.parse(courses.map(serializeCourse)));
});

router.post("/courses", async (req, res): Promise<void> => {
  const parsed = CreateCourseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [course] = await db.insert(coursesTable).values(parsed.data).returning();
  res.status(201).json(GetCourseResponse.parse(serializeCourse(course)));
});

router.get("/courses/:id", async (req, res): Promise<void> => {
  const params = GetCourseParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [course] = await db.select().from(coursesTable).where(eq(coursesTable.id, params.data.id));
  if (!course) {
    res.status(404).json({ error: "Course not found" });
    return;
  }
  res.json(GetCourseResponse.parse(serializeCourse(course)));
});

export default router;
