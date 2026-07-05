import { Router, type IRouter } from "express";
import { buildScopeContext, type ClassmateSession } from "../lib/scope-context";
import { requireRole } from "../middleware/require-role";
import { requireActiveStudent } from "../middleware/require-active-student";
import { StudentAssessmentService } from "../services/student-assessments.service";
import {
  GetStudentAssessmentsResponse,
  GetStudentAssessmentResponse,
  GetStudentAssessmentParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

/**
 * GET /student/assessments
 *
 * Returns all assessments visible to the authenticated student across all
 * enrolled courses, ordered by createdAt descending.
 *
 * Layer 1: requireRole("student") — non-student roles receive 403.
 * Layer 2: Repository filters by studentId + inArray(courseId, enrolledCourseIds).
 * Layer 3: Service guards scope.studentId null and empty enrolledCourseIds → [].
 */
router.get(
  "/student/assessments",
  requireRole("student"),
  requireActiveStudent,
  async (req, res): Promise<void> => {
    const scope = buildScopeContext(req.session as ClassmateSession);
    const assessments = await StudentAssessmentService.listAssessments(scope);
    res.json(GetStudentAssessmentsResponse.parse(assessments));
  },
);

/**
 * GET /student/assessments/:assessmentId
 *
 * Returns full assessment detail for the authenticated student.
 *
 * Layer 1: requireRole("student") — non-student roles receive 403.
 * Layer 2: Repository filters by studentId (cross-student protection).
 * Layer 3: Service checks courseId ∈ enrolledCourseIds (enrollment guard).
 * IDOR-safe: all denial cases return 404.
 */
router.get(
  "/student/assessments/:assessmentId",
  requireRole("student"),
  requireActiveStudent,
  async (req, res): Promise<void> => {
    const scope = buildScopeContext(req.session as ClassmateSession);

    const params = GetStudentAssessmentParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid assessment ID" });
      return;
    }

    const assessment = await StudentAssessmentService.getAssessment(
      scope,
      params.data.assessmentId,
    );
    if (!assessment) {
      res.status(404).json({ error: "Assessment not found" });
      return;
    }

    res.json(GetStudentAssessmentResponse.parse(assessment));
  },
);

export default router;
