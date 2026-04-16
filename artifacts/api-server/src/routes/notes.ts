import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, notesTable, coursesTable, activityTable } from "@workspace/db";
import {
  CreateNoteBody,
  GetNoteParams,
  GetNoteResponse,
  UpdateNoteParams,
  UpdateNoteBody,
  UpdateNoteResponse,
  ListNotesQueryParams,
  ListNotesResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

function serializeNote(n: typeof notesTable.$inferSelect, courseName: string) {
  return { ...n, courseName, videoUrl: n.videoUrl ?? null, createdAt: n.createdAt.toISOString() };
}

router.get("/notes", async (req, res): Promise<void> => {
  const queryParams = ListNotesQueryParams.safeParse(req.query);
  if (!queryParams.success) {
    res.status(400).json({ error: queryParams.error.message });
    return;
  }

  const conditions = [];
  if (queryParams.data.courseId) conditions.push(eq(notesTable.courseId, queryParams.data.courseId));

  const notes = await db.select().from(notesTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(notesTable.createdAt);

  const enriched = await Promise.all(notes.map(async (n) => {
    const [course] = await db.select({ name: coursesTable.name }).from(coursesTable).where(eq(coursesTable.id, n.courseId));
    return serializeNote(n, course?.name ?? "Unknown");
  }));

  res.json(ListNotesResponse.parse(enriched));
});

router.post("/notes", async (req, res): Promise<void> => {
  const parsed = CreateNoteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [course] = await db.select({ name: coursesTable.name }).from(coursesTable).where(eq(coursesTable.id, parsed.data.courseId));
  const [note] = await db.insert(notesTable).values({
    ...parsed.data,
    videoUrl: parsed.data.videoUrl ?? null,
  }).returning();

  await db.insert(activityTable).values({
    type: "note_created",
    description: `Lesson note "${parsed.data.title}" added for topic "${parsed.data.topic}"`,
    studentName: "Teacher",
    courseName: course?.name ?? "Unknown",
  });

  res.status(201).json(GetNoteResponse.parse(serializeNote(note, course?.name ?? "Unknown")));
});

router.get("/notes/:id", async (req, res): Promise<void> => {
  const params = GetNoteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [note] = await db.select().from(notesTable).where(eq(notesTable.id, params.data.id));
  if (!note) {
    res.status(404).json({ error: "Note not found" });
    return;
  }
  const [course] = await db.select({ name: coursesTable.name }).from(coursesTable).where(eq(coursesTable.id, note.courseId));
  res.json(GetNoteResponse.parse(serializeNote(note, course?.name ?? "Unknown")));
});

router.patch("/notes/:id", async (req, res): Promise<void> => {
  const params = UpdateNoteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateNoteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [note] = await db.update(notesTable).set(parsed.data).where(eq(notesTable.id, params.data.id)).returning();
  if (!note) {
    res.status(404).json({ error: "Note not found" });
    return;
  }
  const [course] = await db.select({ name: coursesTable.name }).from(coursesTable).where(eq(coursesTable.id, note.courseId));
  res.json(UpdateNoteResponse.parse(serializeNote(note, course?.name ?? "Unknown")));
});

export default router;
