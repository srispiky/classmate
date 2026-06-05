import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
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
import { buildScopeContext, type ClassmateSession } from "../lib/scope-context";
import { listNotes, getNoteById, type NoteRow } from "../lib/notes.queries";

const router: IRouter = Router();

function serializeNote(n: NoteRow) {
  return {
    id: n.id,
    title: n.title,
    content: n.content,
    courseId: n.courseId,
    courseName: n.courseName,
    topic: n.topic,
    videoUrl: n.videoUrl ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}

// ── GET /api/notes ───────────────────────────────────────────────────────────

router.get("/notes", async (req, res): Promise<void> => {
  const scope = buildScopeContext(req.session as ClassmateSession);

  const queryParams = ListNotesQueryParams.safeParse(req.query);
  if (!queryParams.success) {
    res.status(400).json({ error: queryParams.error.message });
    return;
  }

  const notes = await listNotes(scope, { courseId: queryParams.data.courseId });

  res.json(ListNotesResponse.parse(notes.map(serializeNote)));
});

// ── POST /api/notes ──────────────────────────────────────────────────────────

router.post("/notes", async (req, res): Promise<void> => {
  const parsed = CreateNoteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [course] = await db
    .select({ name: coursesTable.name })
    .from(coursesTable)
    .where(eq(coursesTable.id, parsed.data.courseId));

  const [note] = await db
    .insert(notesTable)
    .values({ ...parsed.data, videoUrl: parsed.data.videoUrl ?? null })
    .returning();

  await db.insert(activityTable).values({
    type: "note_created",
    description: `Lesson note "${parsed.data.title}" added for topic "${parsed.data.topic}"`,
    studentName: "Teacher",
    courseName: course?.name ?? "Unknown",
  });

  res.status(201).json(
    GetNoteResponse.parse(
      serializeNote({
        ...note,
        courseName: course?.name ?? "Unknown",
        deletedAt: null,
      }),
    ),
  );
});

// ── GET /api/notes/:id ───────────────────────────────────────────────────────

router.get("/notes/:id", async (req, res): Promise<void> => {
  const scope = buildScopeContext(req.session as ClassmateSession);

  const params = GetNoteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  // Scope filter is applied inside getNoteById (Layer 2) for both student and parent.
  // Out-of-scope notes return null → 404 (no IDOR concern for course-scoped resources).
  const note = await getNoteById(params.data.id, scope);
  if (!note) {
    res.status(404).json({ error: "Note not found" });
    return;
  }

  res.json(GetNoteResponse.parse(serializeNote(note)));
});

// ── PATCH /api/notes/:id ─────────────────────────────────────────────────────

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

  const [note] = await db
    .update(notesTable)
    .set(parsed.data)
    .where(eq(notesTable.id, params.data.id))
    .returning();

  if (!note) {
    res.status(404).json({ error: "Note not found" });
    return;
  }

  const [course] = await db
    .select({ name: coursesTable.name })
    .from(coursesTable)
    .where(eq(coursesTable.id, note.courseId));

  res.json(
    UpdateNoteResponse.parse(
      serializeNote({
        ...note,
        courseName: course?.name ?? "Unknown",
        deletedAt: note.deletedAt ?? null,
      }),
    ),
  );
});

export default router;
