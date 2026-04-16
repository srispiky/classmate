import { Router, type IRouter } from "express";
import healthRouter from "./health";
import studentsRouter from "./students";
import coursesRouter from "./courses";
import assignmentsRouter from "./assignments";
import notesRouter from "./notes";
import assessmentsRouter from "./assessments";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(studentsRouter);
router.use(coursesRouter);
router.use(assignmentsRouter);
router.use(notesRouter);
router.use(assessmentsRouter);
router.use(dashboardRouter);

export default router;
