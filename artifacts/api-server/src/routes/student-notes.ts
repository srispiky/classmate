import { Router, type IRouter } from "express";
import { buildScopeContext, type ClassmateSession } from "../lib/scope-context";
import { requireRole } from "../middleware/require-role";
import { requireActiveStudent } from "../middleware/require-active-student";
import { StudentNotesService } from "../services/student-notes.service";
import {
  GetStudentNotesResponse,
  GetStudentNoteResponse,
  GetStudentNoteParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

/**
 * GET /student/notes
 *
 * Returns all notes visible to the authenticated student across all enrolled
 * courses, ordered by createdAt descending.
 *
 * Layer 1: requireRole("student") — non-student roles receive 403.
 * Layer 2: Repository filters by inArray(courseId, enrolledCourseIds).
 *          Notes have no studentId FK — course membership is the only ownership
 *          dimension.
 * Layer 3: Service guards empty enrolledCourseIds → [].
 */
router.get(
  "/student/notes",
  requireRole("student"),
  requireActiveStudent,
  async (req, res): Promise<void> => {
    const scope = buildScopeContext(req.session as ClassmateSession);
    const notes = await StudentNotesService.listNotes(scope);
    res.json(GetStudentNotesResponse.parse(notes));
  },
);

/**
 * GET /student/notes/:noteId
 *
 * Returns full note detail for the authenticated student.
 *
 * Layer 1: requireRole("student") — non-student roles receive 403.
 * Layer 2: Repository fetches by ID + soft-delete filter only (no studentId FK).
 * Layer 3: Service checks courseId ∈ enrolledCourseIds (enrollment guard).
 * IDOR-safe: all denial cases return 404.
 */
router.get(
  "/student/notes/:noteId",
  requireRole("student"),
  requireActiveStudent,
  async (req, res): Promise<void> => {
    const scope = buildScopeContext(req.session as ClassmateSession);

    const params = GetStudentNoteParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid note ID" });
      return;
    }

    const note = await StudentNotesService.getNote(scope, params.data.noteId);
    if (!note) {
      res.status(404).json({ error: "Note not found" });
      return;
    }

    res.json(GetStudentNoteResponse.parse(note));
  },
);

export default router;
