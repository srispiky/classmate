import { Router, type IRouter } from "express";
import {
  ListUsersResponse,
  CreateUserBody,
  GetUserParams,
  GetUserResponse,
  UpdateUserParams,
  UpdateUserBody,
  UpdateUserResponse,
  ResetUserPasswordParams,
  ResetUserPasswordBody,
  ResetUserPasswordResponse,
} from "@workspace/api-zod";
import { buildScopeContext, type ClassmateSession } from "../lib/scope-context";
import { requireRole } from "../middleware/require-role";
import {
  UserService,
  DuplicateUsernameError,
  UserNotFoundError,
  type UserPublic,
} from "../lib/users.service";

const router: IRouter = Router();

function serializeUser(u: UserPublic) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    role: u.role,
    isActive: u.isActive,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
    createdBy: u.createdBy ?? null,
    updatedBy: u.updatedBy ?? null,
  };
}

// ── GET /api/users ────────────────────────────────────────────────────────────

// Layer 1: admin-only — only admins manage user accounts.
router.get("/users", requireRole("admin"), async (_req, res): Promise<void> => {
  const users = await UserService.listUsers();
  res.json(ListUsersResponse.parse(users.map(serializeUser)));
});

// ── POST /api/users ───────────────────────────────────────────────────────────

// Layer 1: admin-only.
router.post("/users", requireRole("admin"), async (req, res): Promise<void> => {
  const scope = buildScopeContext(req.session as ClassmateSession);

  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const user = await UserService.createUser({
      username: parsed.data.username,
      displayName: parsed.data.displayName,
      password: parsed.data.password,
      role: parsed.data.role as Parameters<typeof UserService.createUser>[0]["role"],
      actorId: scope.userId,
    });
    res.status(201).json(GetUserResponse.parse(serializeUser(user)));
  } catch (err) {
    if (err instanceof DuplicateUsernameError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

// ── GET /api/users/:userId ────────────────────────────────────────────────────

// Layer 1: admin-only.
router.get("/users/:userId", requireRole("admin"), async (req, res): Promise<void> => {
  const params = GetUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const user = await UserService.getUser(params.data.userId);
    res.json(GetUserResponse.parse(serializeUser(user)));
  } catch (err) {
    if (err instanceof UserNotFoundError) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    throw err;
  }
});

// ── PATCH /api/users/:userId ──────────────────────────────────────────────────

// Layer 1: admin-only. Password updates are not allowed via this endpoint.
router.patch("/users/:userId", requireRole("admin"), async (req, res): Promise<void> => {
  const scope = buildScopeContext(req.session as ClassmateSession);

  const params = UpdateUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const user = await UserService.updateUser(params.data.userId, {
      displayName: parsed.data.displayName,
      role: parsed.data.role as Parameters<typeof UserService.updateUser>[1]["role"],
      isActive: parsed.data.isActive,
      actorId: scope.userId,
    });
    res.json(UpdateUserResponse.parse(serializeUser(user)));
  } catch (err) {
    if (err instanceof UserNotFoundError) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    throw err;
  }
});

// ── POST /api/users/:userId/reset-password ────────────────────────────────────

// Layer 1: admin-only. Generates a new hash from the supplied password.
router.post(
  "/users/:userId/reset-password",
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const scope = buildScopeContext(req.session as ClassmateSession);

    const params = ResetUserPasswordParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const parsed = ResetUserPasswordBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      await UserService.resetPassword(params.data.userId, {
        newPassword: parsed.data.newPassword,
        actorId: scope.userId,
      });
      res.json(
        ResetUserPasswordResponse.parse({ ok: true, userId: params.data.userId }),
      );
    } catch (err) {
      if (err instanceof UserNotFoundError) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      throw err;
    }
  },
);

export default router;
