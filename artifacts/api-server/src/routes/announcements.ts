import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, announcementsTable, coursesTable } from "@workspace/db";
import { buildScopeContext, type ClassmateSession } from "../lib/scope-context";
import { announcementPolicy, PolicyAuthorizationError } from "../lib/policies";
import {
  listAnnouncements,
  getAnnouncementById,
  type AnnouncementRow,
} from "../lib/announcements.queries";
import {
  ListAnnouncementsResponse,
  ListAnnouncementsQueryParams,
  GetAnnouncementParams,
  GetAnnouncementResponse,
  CreateAnnouncementBody,
  UpdateAnnouncementParams,
  UpdateAnnouncementBody,
  UpdateAnnouncementResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

function serializeAnnouncement(a: AnnouncementRow) {
  return {
    id: a.id,
    title: a.title,
    content: a.content,
    courseId: a.courseId,
    courseName: a.courseName,
    authorName: a.authorName,
    priority: a.priority,
    createdAt: a.createdAt.toISOString(),
  };
}

// ── GET /api/announcements ────────────────────────────────────────────────────

router.get("/announcements", async (req, res): Promise<void> => {
  const scope = buildScopeContext(req.session as ClassmateSession);

  const queryParams = ListAnnouncementsQueryParams.safeParse(req.query);
  if (!queryParams.success) {
    res.status(400).json({ error: queryParams.error.message });
    return;
  }

  // Layer 2: announcementPolicy.getScopeCondition() applied inside listAnnouncements().
  // Admin/teacher see all; student filtered to enrolledCourseIds;
  // parent filtered to childCourseIds. DB-level filtering, no in-memory post-processing.
  const announcements = await listAnnouncements(scope, {
    courseId: queryParams.data.courseId,
  });

  res.json(ListAnnouncementsResponse.parse(announcements.map(serializeAnnouncement)));
});

// ── POST /api/announcements ───────────────────────────────────────────────────

router.post("/announcements", async (req, res): Promise<void> => {
  const parsed = CreateAnnouncementBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [course] = await db
    .select({ name: coursesTable.name })
    .from(coursesTable)
    .where(eq(coursesTable.id, parsed.data.courseId));

  const [announcement] = await db
    .insert(announcementsTable)
    .values({
      ...parsed.data,
      priority: parsed.data.priority ?? "normal",
    })
    .returning();

  res.status(201).json(
    GetAnnouncementResponse.parse(
      serializeAnnouncement({
        ...announcement,
        courseName: course?.name ?? "Unknown",
        deletedAt: null,
      }),
    ),
  );
});

// ── GET /api/announcements/:id ────────────────────────────────────────────────

router.get("/announcements/:id", async (req, res): Promise<void> => {
  const scope = buildScopeContext(req.session as ClassmateSession);

  const params = GetAnnouncementParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  // Step 1: fetch by ID + soft-delete guard only. No scope filter in query —
  //         Layer 3 below is the defense-in-depth IDOR safeguard.
  const announcement = await getAnnouncementById(params.data.id);
  if (!announcement) {
    res.status(404).json({ error: "Announcement not found" });
    return;
  }

  // Step 2: Layer 3 — delegate course-access check to AnnouncementScopePolicy.
  // Services do not contain authorization rules — policies own that logic.
  // Throws CourseAuthorizationError (extends PolicyAuthorizationError) on denial.
  try {
    announcementPolicy.validateAccess(scope, announcement);
  } catch (err) {
    if (err instanceof PolicyAuthorizationError) {
      res.status(403).json({ error: "Access denied", code: "COURSE_ACCESS_DENIED" });
      return;
    }
    throw err;
  }

  res.json(GetAnnouncementResponse.parse(serializeAnnouncement(announcement)));
});

// ── PATCH /api/announcements/:id ──────────────────────────────────────────────

router.patch("/announcements/:id", async (req, res): Promise<void> => {
  const params = UpdateAnnouncementParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateAnnouncementBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [announcement] = await db
    .update(announcementsTable)
    .set(parsed.data)
    .where(eq(announcementsTable.id, params.data.id))
    .returning();

  if (!announcement) {
    res.status(404).json({ error: "Announcement not found" });
    return;
  }

  const [course] = await db
    .select({ name: coursesTable.name })
    .from(coursesTable)
    .where(eq(coursesTable.id, announcement.courseId));

  res.json(
    UpdateAnnouncementResponse.parse(
      serializeAnnouncement({
        ...announcement,
        courseName: course?.name ?? "Unknown",
        deletedAt: announcement.deletedAt ?? null,
      }),
    ),
  );
});

export default router;
