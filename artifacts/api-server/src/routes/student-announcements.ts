import { Router, type IRouter } from "express";
import { buildScopeContext, type ClassmateSession } from "../lib/scope-context";
import { requireRole } from "../middleware/require-role";
import { StudentAnnouncementService } from "../services/student-announcements.service";
import {
  GetStudentAnnouncementsResponse,
  GetStudentAnnouncementResponse,
  GetStudentAnnouncementParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

/**
 * GET /student/announcements
 *
 * Returns all announcements visible to the authenticated student across all
 * enrolled courses, ordered by createdAt descending.
 *
 * Layer 1: requireRole("student") — non-student roles receive 403.
 * Layer 2: Repository filters by inArray(courseId, enrolledCourseIds).
 *          Announcements have no studentId FK — course membership is the only
 *          ownership dimension.
 * Layer 3: Service guards empty enrolledCourseIds → [].
 */
router.get(
  "/student/announcements",
  requireRole("student"),
  async (req, res): Promise<void> => {
    const scope = buildScopeContext(req.session as ClassmateSession);
    const announcements = await StudentAnnouncementService.listAnnouncements(scope);
    res.json(GetStudentAnnouncementsResponse.parse(announcements));
  },
);

/**
 * GET /student/announcements/:announcementId
 *
 * Returns full announcement detail for the authenticated student.
 *
 * Layer 1: requireRole("student") — non-student roles receive 403.
 * Layer 2: Repository fetches by ID + soft-delete filter only (no studentId FK).
 * Layer 3: Service checks courseId ∈ enrolledCourseIds (enrollment guard).
 * IDOR-safe: all denial cases return 404.
 */
router.get(
  "/student/announcements/:announcementId",
  requireRole("student"),
  async (req, res): Promise<void> => {
    const scope = buildScopeContext(req.session as ClassmateSession);

    const params = GetStudentAnnouncementParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid announcement ID" });
      return;
    }

    const announcement = await StudentAnnouncementService.getAnnouncement(
      scope,
      params.data.announcementId,
    );
    if (!announcement) {
      res.status(404).json({ error: "Announcement not found" });
      return;
    }

    res.json(GetStudentAnnouncementResponse.parse(announcement));
  },
);

export default router;
