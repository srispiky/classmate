import { Router, type IRouter } from "express";
import { buildScopeContext, type ClassmateSession } from "../lib/scope-context";
import { requireRole } from "../middleware/require-role";
import { requireActiveStudent } from "../middleware/require-active-student";
import { StudentCourseService } from "../services/student-courses.service";
import {
  GetStudentCoursesResponse,
  GetStudentCourseResponse,
  GetStudentCourseParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

/**
 * GET /student/courses
 *
 * Returns all courses the authenticated student is actively enrolled in.
 *
 * Layer 1: requireRole("student") — non-student roles receive 403 immediately.
 * Layer 2: scope.enrolledCourseIds applied via CourseScopePolicy inside
 *          listStudentCourses(). No in-memory post-filtering.
 */
router.get(
  "/student/courses",
  requireRole("student"),
  requireActiveStudent,
  async (req, res): Promise<void> => {
    const scope = buildScopeContext(req.session as ClassmateSession);
    const courses = await StudentCourseService.listCourses(scope);
    res.json(GetStudentCoursesResponse.parse(courses));
  },
);

/**
 * GET /student/courses/:courseId
 *
 * Returns details for a single enrolled course.
 *
 * Layer 1: requireRole("student").
 * Layer 1b: requireActiveStudent — re-validates student record liveness.
 * Layer 3: StudentCourseService.getCourse() checks scope.enrolledCourseIds
 *          membership before issuing a DB query. Returns null for non-enrolled
 *          or deleted courses → 404 (IDOR-safe: does not reveal course existence).
 */
router.get(
  "/student/courses/:courseId",
  requireRole("student"),
  requireActiveStudent,
  async (req, res): Promise<void> => {
    const scope = buildScopeContext(req.session as ClassmateSession);

    const params = GetStudentCourseParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid course ID" });
      return;
    }

    const course = await StudentCourseService.getCourse(scope, params.data.courseId);
    if (!course) {
      res.status(404).json({ error: "Course not found" });
      return;
    }

    res.json(GetStudentCourseResponse.parse(course));
  },
);

export default router;
