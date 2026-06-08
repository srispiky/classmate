import { Router, type IRouter } from "express";
import { buildScopeContext, type ClassmateSession } from "../lib/scope-context";
import { requireRole } from "../middleware/require-role";
import { StudentAssignmentService } from "../services/student-assignments.service";
import {
  GetStudentAssignmentsResponse,
  GetStudentAssignmentResponse,
  GetStudentAssignmentParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

/**
 * GET /student/assignments
 *
 * Returns all assignments visible to the authenticated student across all
 * enrolled courses, ordered by dueDate ascending.
 *
 * Layer 1: requireRole("student") — non-student roles receive 403.
 * Layer 2: Repository filters by studentId + inArray(courseId, enrolledCourseIds).
 * Layer 3: Service guards scope.studentId null and empty enrolledCourseIds → [].
 */
router.get(
  "/student/assignments",
  requireRole("student"),
  async (req, res): Promise<void> => {
    const scope = buildScopeContext(req.session as ClassmateSession);
    const assignments = await StudentAssignmentService.listAssignments(scope);
    res.json(GetStudentAssignmentsResponse.parse(assignments));
  },
);

/**
 * GET /student/assignments/:assignmentId
 *
 * Returns full assignment detail for the authenticated student.
 *
 * Layer 1: requireRole("student") — non-student roles receive 403.
 * Layer 2: Repository filters by studentId (cross-student protection).
 * Layer 3: Service checks courseId ∈ enrolledCourseIds (enrollment guard).
 * IDOR-safe: all denial cases return 404.
 */
router.get(
  "/student/assignments/:assignmentId",
  requireRole("student"),
  async (req, res): Promise<void> => {
    const scope = buildScopeContext(req.session as ClassmateSession);

    const params = GetStudentAssignmentParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid assignment ID" });
      return;
    }

    const assignment = await StudentAssignmentService.getAssignment(
      scope,
      params.data.assignmentId,
    );
    if (!assignment) {
      res.status(404).json({ error: "Assignment not found" });
      return;
    }

    res.json(GetStudentAssignmentResponse.parse(assignment));
  },
);

export default router;
