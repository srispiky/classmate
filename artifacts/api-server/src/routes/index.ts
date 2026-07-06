import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import studentsRouter from "./students";
import coursesRouter from "./courses";
import assignmentsRouter from "./assignments";
import notesRouter from "./notes";
import assessmentsRouter from "./assessments";
import dashboardRouter from "./dashboard";
import reportsRouter from "./reports";
import downloadsRouter from "./downloads";
import adminRouter from "./admin";
import monitoringRouter from "./monitoring";
import usersRouter from "./users";
import announcementsRouter from "./announcements";
import enrollmentsRouter from "./enrollments";
import studentNotesRouter from "./student-notes";
import studentAnnouncementsRouter from "./student-announcements";
import studentAssessmentsRouter from "./student-assessments";
import studentAssignmentsRouter from "./student-assignments";
import studentCoursesRouter from "./student-courses";
import studentCourseWorkspaceRouter from "./student-course-workspace";
import studentDashboardRouter from "./student-dashboard";
import parentRouter from "./parent";
import { requireAuth } from "../middleware/auth";
import { requireActiveAccount } from "../middleware/require-active-account";

const router: IRouter = Router();

// Public routes — no session required.
router.use(healthRouter);
router.use(authRouter);

// All routes below this point require an authenticated session.
// requireAuth returns 401 for unauthenticated callers before any handler runs.
router.use(requireAuth);

// Account liveness check — re-queries isActive on every authenticated request so
// that a deactivated account is rejected immediately even if its session cookie
// is still valid.  Applies to all roles (admin, teacher, student, parent).
// Individual route files (e.g. parent.ts) also call requireActiveAccount per-route;
// those duplicate calls are harmless — the global check here is the authoritative gate.
router.use(requireActiveAccount);

router.use(studentsRouter);
router.use(coursesRouter);
router.use(assignmentsRouter);
router.use(notesRouter);
router.use(assessmentsRouter);
router.use(announcementsRouter);
router.use(enrollmentsRouter);
router.use(studentNotesRouter);
router.use(studentAnnouncementsRouter);
router.use(studentAssessmentsRouter);
router.use(studentAssignmentsRouter);
router.use(studentCoursesRouter);
router.use(studentCourseWorkspaceRouter);
router.use(studentDashboardRouter);
router.use(parentRouter);
router.use(dashboardRouter);
router.use(reportsRouter);
// downloadsRouter is mounted after requireAuth so unauthenticated callers
// receive 401 here before the handler's own requireRole("admin") check.
router.use(downloadsRouter);
router.use(monitoringRouter);
router.use(usersRouter);
router.use(adminRouter);

export default router;
