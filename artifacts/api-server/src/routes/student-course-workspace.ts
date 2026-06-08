import { Router, type IRouter } from "express";
import { buildScopeContext, type ClassmateSession } from "../lib/scope-context";
import { requireRole } from "../middleware/require-role";
import { StudentCourseWorkspaceService } from "../services/student-course-workspace.service";
import {
  GetStudentCourseWorkspaceResponse,
  GetStudentCourseWorkspaceParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

/**
 * GET /student/courses/:courseId/workspace
 *
 * Returns aggregated course workspace data for the authenticated student.
 *
 * Layer 1: requireRole("student") — non-student roles receive 403.
 * Layer 3: StudentCourseWorkspaceService checks scope.enrolledCourseIds before
 *          any DB access. Returns null (→ 404) for non-enrolled courses.
 *          IDOR-safe: 404 is returned regardless of whether the course exists.
 * Layer 2: Repository queries are additionally scoped by both courseId and
 *          studentId for student-owned resources (assignments, assessments).
 */
router.get(
  "/student/courses/:courseId/workspace",
  requireRole("student"),
  async (req, res): Promise<void> => {
    const scope = buildScopeContext(req.session as ClassmateSession);

    const params = GetStudentCourseWorkspaceParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid course ID" });
      return;
    }

    const workspace = await StudentCourseWorkspaceService.getWorkspace(
      scope,
      params.data.courseId,
    );
    if (!workspace) {
      res.status(404).json({ error: "Course not found" });
      return;
    }

    res.json(GetStudentCourseWorkspaceResponse.parse(workspace));
  },
);

export default router;
