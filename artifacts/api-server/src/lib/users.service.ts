/**
 * UserService — business logic for user management.
 *
 * Responsibilities:
 *   - password hashing before persistence
 *   - username uniqueness enforcement
 *   - role validation
 *   - password reset
 */
import { hashPassword } from "./password";
import {
  listUsersFromDb,
  getUserByIdFromDb,
  getUserByUsernameFromDb,
  createUserInDb,
  updateUserInDb,
  updatePasswordHashInDb,
  type UserPublic,
} from "./users.repository";

export type { UserPublic };

export const VALID_ROLES = ["admin", "teacher", "student", "parent", "guest"] as const;
export type ValidRole = (typeof VALID_ROLES)[number];

export class DuplicateUsernameError extends Error {
  constructor(username: string) {
    super(`Username "${username}" is already taken`);
    this.name = "DuplicateUsernameError";
  }
}

export class UserNotFoundError extends Error {
  constructor(id: number) {
    super(`User ${id} not found`);
    this.name = "UserNotFoundError";
  }
}

export interface CreateUserInput {
  username: string;
  displayName: string;
  password: string;
  role: ValidRole;
  actorId: number;
}

export interface UpdateUserInput {
  displayName?: string;
  role?: ValidRole;
  isActive?: boolean;
  actorId: number;
}

export interface ResetPasswordInput {
  newPassword: string;
  actorId: number;
}

export const UserService = {
  async listUsers(): Promise<UserPublic[]> {
    return listUsersFromDb();
  },

  async getUser(id: number): Promise<UserPublic> {
    const user = await getUserByIdFromDb(id);
    if (!user) throw new UserNotFoundError(id);
    return user;
  },

  async createUser(input: CreateUserInput): Promise<UserPublic> {
    const existing = await getUserByUsernameFromDb(input.username);
    if (existing) throw new DuplicateUsernameError(input.username);

    const passwordHash = await hashPassword(input.password);
    return createUserInDb({
      username: input.username,
      displayName: input.displayName,
      passwordHash,
      role: input.role,
      actorId: input.actorId,
    });
  },

  async updateUser(id: number, input: UpdateUserInput): Promise<UserPublic> {
    const updated = await updateUserInDb(id, {
      displayName: input.displayName,
      role: input.role,
      isActive: input.isActive,
      actorId: input.actorId,
    });
    if (!updated) throw new UserNotFoundError(id);
    return updated;
  },

  async resetPassword(id: number, input: ResetPasswordInput): Promise<UserPublic> {
    const existing = await getUserByIdFromDb(id);
    if (!existing) throw new UserNotFoundError(id);

    const passwordHash = await hashPassword(input.newPassword);
    const updated = await updatePasswordHashInDb(id, passwordHash, input.actorId);
    if (!updated) throw new UserNotFoundError(id);
    return updated;
  },
};
