import { Router, type IRouter } from "express";
import { buildScopeContext, type ClassmateSession } from "../lib/scope-context";
import { requireRole } from "../middleware/require-role";
import { StudentDashboardService } from "../services/student-dashboard.service";
import { GetStudentDashboardResponse } from "@workspace/api-zod";

const router: IRouter = Router();

/**
 * GET /student/dashboard
 *
 * Returns an aggregated dashboard summary for the authenticated student.
 *
 * Layer 1: requireRole("student") — only student-role accounts may call this endpoint.
 * Layer 2/3: scope.studentId and scope.enrolledCourseIds (pre-computed by SessionEnricher)
 *            are passed to the service, which delegates to scoped repository queries.
 *            No in-memory post-filtering — all scoping is done at the DB level.
 */
router.get(
  "/student/dashboard",
  requireRole("student"),
  async (req, res): Promise<void> => {
    const scope = buildScopeContext(req.session as ClassmateSession);

    const dashboard = await StudentDashboardService.getDashboard(scope);
    if (!dashboard) {
      res.status(404).json({ error: "Student record not found or not linked to this account" });
      return;
    }

    res.json(GetStudentDashboardResponse.parse(dashboard));
  },
);

export default router;
