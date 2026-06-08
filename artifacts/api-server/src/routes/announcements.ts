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
import { requireRole } from "../middleware/require-role";

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
    updatedAt: a.updatedAt.toISOString(),
    createdBy: a.createdBy ?? null,
    updatedBy: a.updatedBy ?? null,
  };
}

// ── GET /api/announcements ────────────────────────────────────────────────────

// Layer 1: only admin and teacher may access the teacher-facing announcement list.
// Student/parent access is served by /student/announcements instead.
router.get(
  "/announcements",
  requireRole("admin", "teacher"),
  async (req, res): Promise<void> => {
    const scope = buildScopeContext(req.session as ClassmateSession);

    const queryParams = ListAnnouncementsQueryParams.safeParse(req.query);
    if (!queryParams.success) {
      res.status(400).json({ error: queryParams.error.message });
      return;
    }

    // Layer 2: announcementPolicy.getScopeCondition() applied inside listAnnouncements().
    const announcements = await listAnnouncements(scope, {
      courseId: queryParams.data.courseId,
    });

    res.json(ListAnnouncementsResponse.parse(announcements.map(serializeAnnouncement)));
  },
);

// ── POST /api/announcements ───────────────────────────────────────────────────

// Layer 1: only admin and teacher may create announcements.
router.post(
  "/announcements",
  requireRole("admin", "teacher"),
  async (req, res): Promise<void> => {
    const scope = buildScopeContext(req.session as ClassmateSession);
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
        createdBy: scope.userId,
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
  },
);

// ── GET /api/announcements/:id ────────────────────────────────────────────────

// Layer 1: only admin and teacher may access announcement detail.
router.get(
  "/announcements/:id",
  requireRole("admin", "teacher"),
  async (req, res): Promise<void> => {
    const scope = buildScopeContext(req.session as ClassmateSession);

    const params = GetAnnouncementParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const announcement = await getAnnouncementById(params.data.id);
    if (!announcement) {
      res.status(404).json({ error: "Announcement not found" });
      return;
    }

    // Layer 3: delegate course-access check to AnnouncementScopePolicy.
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
  },
);

// ── PATCH /api/announcements/:id ──────────────────────────────────────────────

// Layer 1: only admin and teacher may update announcements.
router.patch(
  "/announcements/:id",
  requireRole("admin", "teacher"),
  async (req, res): Promise<void> => {
    const scope = buildScopeContext(req.session as ClassmateSession);

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

    const existing = await getAnnouncementById(params.data.id);
    if (!existing) {
      res.status(404).json({ error: "Announcement not found" });
      return;
    }

    // Layer 3: enforce course-access before mutating.
    try {
      announcementPolicy.validateAccess(scope, existing);
    } catch (err) {
      if (err instanceof PolicyAuthorizationError) {
        res.status(403).json({ error: "Access denied", code: "COURSE_ACCESS_DENIED" });
        return;
      }
      throw err;
    }

    const [announcement] = await db
      .update(announcementsTable)
      .set({ ...parsed.data, updatedAt: new Date(), updatedBy: scope.userId })
      .where(eq(announcementsTable.id, params.data.id))
      .returning();

    if (!announcement) {
      res.status(404).json({ error: "Announcement not found" });
      return;
    }

    res.json(
      UpdateAnnouncementResponse.parse(
        serializeAnnouncement({
          ...announcement,
          courseName: existing.courseName,
          deletedAt: announcement.deletedAt ?? null,
        }),
      ),
    );
  },
);

// ── DELETE /api/announcements/:id — soft delete ───────────────────────────────

// Layer 1: only admin and teacher may delete announcements.
router.delete(
  "/announcements/:id",
  requireRole("admin", "teacher"),
  async (req, res): Promise<void> => {
    const scope = buildScopeContext(req.session as ClassmateSession);

    const params = GetAnnouncementParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    // Pre-fetch with soft-delete guard (getAnnouncementById filters isNull(deletedAt)).
    const existing = await getAnnouncementById(params.data.id);
    if (!existing) {
      res.status(404).json({ error: "Announcement not found" });
      return;
    }

    // Layer 3: enforce course-access before deleting.
    try {
      announcementPolicy.validateAccess(scope, existing);
    } catch (err) {
      if (err instanceof PolicyAuthorizationError) {
        res.status(403).json({ error: "Access denied", code: "COURSE_ACCESS_DENIED" });
        return;
      }
      throw err;
    }

    // Soft delete — never physically remove rows.
    await db
      .update(announcementsTable)
      .set({
        deletedAt: new Date(),
        updatedAt: new Date(),
        updatedBy: scope.userId,
        deletedBy: scope.userId,
      })
      .where(eq(announcementsTable.id, params.data.id));

    res.status(204).send();
  },
);

export default router;
