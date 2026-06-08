import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import studentsRouter from "./students";
import coursesRouter from "./courses";
import assignmentsRouter from "./assignments";
import notesRouter from "./notes";
import assessmentsRouter from "./assessments";
import dashboardRouter from "./dashboard";
import downloadsRouter from "./downloads";
import adminRouter from "./admin";
import announcementsRouter from "./announcements";
import enrollmentsRouter from "./enrollments";
import studentCoursesRouter from "./student-courses";
import studentCourseWorkspaceRouter from "./student-course-workspace";
import studentDashboardRouter from "./student-dashboard";
import { requireAuth } from "../middleware/auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(downloadsRouter);

router.use(requireAuth);

router.use(studentsRouter);
router.use(coursesRouter);
router.use(assignmentsRouter);
router.use(notesRouter);
router.use(assessmentsRouter);
router.use(announcementsRouter);
router.use(enrollmentsRouter);
router.use(studentCoursesRouter);
router.use(studentCourseWorkspaceRouter);
router.use(studentDashboardRouter);
router.use(dashboardRouter);
router.use(adminRouter);

export default router;
