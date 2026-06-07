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

  // Layer 2: notesPolicy.getScopeCondition() applied inside listNotes().
  // Admin/teacher see all notes; student filtered to enrolledCourseIds;
  // parent filtered to childCourseIds. No in-memory filtering.
  const notes = await listNotes(scope, { courseId: queryParams.data.courseId });

  res.json(ListNotesResponse.parse(notes.map(serializeNote)));
});

// ── POST /api/notes ──────────────────────────────────────────────────────────

router.post("/notes", async (req, res): Promise<void> => {
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

router.get("/notes/:id", async (req, res): Promise<void> => {
  const scope = buildScopeContext(req.session as ClassmateSession);

  const params = GetNoteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  // Step 1: fetch by ID + soft-delete guard only. No scope filter in the query —
  //         Layer 3 below is the defence-in-depth IDOR safeguard.
  const note = await getNoteById(params.data.id);
  if (!note) {
    res.status(404).json({ error: "Note not found" });
    return;
  }

  // Step 2: Layer 3 — delegate course-access check to NotesScopePolicy.
  // Services do not contain authorization rules — policies own that logic.
  // Throws CourseAuthorizationError (extends PolicyAuthorizationError) on denial.
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

router.patch("/notes/:id", async (req, res): Promise<void> => {
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

  // Pre-fetch with soft-delete guard so we (a) return 404 for deleted notes
  // and (b) have the courseId required for Layer 3 authorization.
  // Previously this went straight to UPDATE, which could mutate soft-deleted
  // records and bypassed authorization entirely.
  const existing = await getNoteById(params.data.id);
  if (!existing) {
    res.status(404).json({ error: "Note not found" });
    return;
  }

  // Layer 3: enforce course-access before mutating.
  // Students may only edit notes in courses they are enrolled in.
  // Parents and guests are denied entirely (course notes are teacher-authored).
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

export default router;
