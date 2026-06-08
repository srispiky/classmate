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
import { notesPolicy, PolicyAuthorizationError } from "../lib/policies";
import { listNotes, getNoteById, type NoteRow } from "../lib/notes.queries";
import { requireRole } from "../middleware/require-role";

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
    updatedAt: n.updatedAt.toISOString(),
    createdBy: n.createdBy ?? null,
    updatedBy: n.updatedBy ?? null,
  };
}

// ── GET /api/notes ───────────────────────────────────────────────────────────

// Layer 1: only admin and teacher may access the teacher-facing notes list.
// Student/parent access is served by /student/notes instead.
router.get("/notes", requireRole("admin", "teacher"), async (req, res): Promise<void> => {
  const scope = buildScopeContext(req.session as ClassmateSession);

  const queryParams = ListNotesQueryParams.safeParse(req.query);
  if (!queryParams.success) {
    res.status(400).json({ error: queryParams.error.message });
    return;
  }

  // Layer 2: notesPolicy.getScopeCondition() applied inside listNotes().
  const notes = await listNotes(scope, { courseId: queryParams.data.courseId });

  res.json(ListNotesResponse.parse(notes.map(serializeNote)));
});

// ── POST /api/notes ──────────────────────────────────────────────────────────

// Layer 1: only admin and teacher may create lesson notes.
router.post("/notes", requireRole("admin", "teacher"), async (req, res): Promise<void> => {
  const scope = buildScopeContext(req.session as ClassmateSession);
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
    .values({ ...parsed.data, videoUrl: parsed.data.videoUrl ?? null, createdBy: scope.userId })
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

// Layer 1: only admin and teacher may access note detail.
router.get("/notes/:id", requireRole("admin", "teacher"), async (req, res): Promise<void> => {
  const scope = buildScopeContext(req.session as ClassmateSession);

  const params = GetNoteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const note = await getNoteById(params.data.id);
  if (!note) {
    res.status(404).json({ error: "Note not found" });
    return;
  }

  // Layer 3: delegate course-access check to NotesScopePolicy.
  try {
    notesPolicy.validateAccess(scope, note);
  } catch (err) {
    if (err instanceof PolicyAuthorizationError) {
      res.status(403).json({ error: "Access denied", code: "COURSE_ACCESS_DENIED" });
      return;
    }
    throw err;
  }

  res.json(GetNoteResponse.parse(serializeNote(note)));
});

// ── PATCH /api/notes/:id ─────────────────────────────────────────────────────

// Layer 1: only admin and teacher may update notes.
router.patch("/notes/:id", requireRole("admin", "teacher"), async (req, res): Promise<void> => {
  const scope = buildScopeContext(req.session as ClassmateSession);

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

  const existing = await getNoteById(params.data.id);
  if (!existing) {
    res.status(404).json({ error: "Note not found" });
    return;
  }

  // Layer 3: enforce course-access before mutating.
  try {
    notesPolicy.validateAccess(scope, existing);
  } catch (err) {
    if (err instanceof PolicyAuthorizationError) {
      res.status(403).json({ error: "Access denied", code: "COURSE_ACCESS_DENIED" });
      return;
    }
    throw err;
  }

  const [note] = await db
    .update(notesTable)
    .set({ ...parsed.data, updatedAt: new Date(), updatedBy: scope.userId })
    .where(eq(notesTable.id, params.data.id))
    .returning();

  if (!note) {
    res.status(404).json({ error: "Note not found" });
    return;
  }

  res.json(
    UpdateNoteResponse.parse(
      serializeNote({
        ...note,
        courseName: existing.courseName,
        deletedAt: note.deletedAt ?? null,
      }),
    ),
  );
});

// ── DELETE /api/notes/:id — soft delete ──────────────────────────────────────

// Layer 1: only admin and teacher may delete notes.
router.delete("/notes/:id", requireRole("admin", "teacher"), async (req, res): Promise<void> => {
  const scope = buildScopeContext(req.session as ClassmateSession);

  const params = GetNoteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  // Pre-fetch with soft-delete guard (getNoteById filters isNull(deletedAt)).
  const existing = await getNoteById(params.data.id);
  if (!existing) {
    res.status(404).json({ error: "Note not found" });
    return;
  }

  // Layer 3: enforce course-access before deleting.
  try {
    notesPolicy.validateAccess(scope, existing);
  } catch (err) {
    if (err instanceof PolicyAuthorizationError) {
      res.status(403).json({ error: "Access denied", code: "COURSE_ACCESS_DENIED" });
      return;
    }
    throw err;
  }

  // Soft delete — never physically remove rows.
  await db
    .update(notesTable)
    .set({
      deletedAt: new Date(),
      updatedAt: new Date(),
      updatedBy: scope.userId,
      deletedBy: scope.userId,
    })
    .where(eq(notesTable.id, params.data.id));

  res.status(204).send();
});

export default router;
