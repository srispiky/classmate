/**
 * UserRepository — database access only.
 *
 * Never exposes passwordHash in any returned type.
 * All mutation methods accept pre-hashed passwords.
 */
import { eq, asc } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

export interface UserPublic {
  id: number;
  username: string;
  displayName: string;
  role: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: number | null;
  updatedBy: number | null;
}

export interface CreateUserData {
  username: string;
  displayName: string;
  passwordHash: string;
  role: string;
  actorId: number;
}

export interface UpdateUserData {
  displayName?: string;
  role?: string;
  isActive?: boolean;
  actorId: number;
}

const PUBLIC_COLUMNS = {
  id: usersTable.id,
  username: usersTable.username,
  displayName: usersTable.displayName,
  role: usersTable.role,
  isActive: usersTable.isActive,
  createdAt: usersTable.createdAt,
  updatedAt: usersTable.updatedAt,
  createdBy: usersTable.createdBy,
  updatedBy: usersTable.updatedBy,
} as const;

export async function listUsersFromDb(): Promise<UserPublic[]> {
  return db
    .select(PUBLIC_COLUMNS)
    .from(usersTable)
    .orderBy(asc(usersTable.createdAt));
}

export async function getUserByIdFromDb(id: number): Promise<UserPublic | null> {
  const [row] = await db
    .select(PUBLIC_COLUMNS)
    .from(usersTable)
    .where(eq(usersTable.id, id))
    .limit(1);
  return row ?? null;
}

export async function getUserByUsernameFromDb(username: string): Promise<UserPublic | null> {
  const [row] = await db
    .select(PUBLIC_COLUMNS)
    .from(usersTable)
    .where(eq(usersTable.username, username))
    .limit(1);
  return row ?? null;
}

export async function createUserInDb(data: CreateUserData): Promise<UserPublic> {
  const [row] = await db
    .insert(usersTable)
    .values({
      username: data.username,
      displayName: data.displayName,
      passwordHash: data.passwordHash,
      role: data.role,
      isActive: true,
      createdBy: data.actorId,
      updatedBy: data.actorId,
    })
    .returning(PUBLIC_COLUMNS);

  if (!row) throw new Error("User insert failed — no row returned");
  return row;
}

export async function updateUserInDb(
  id: number,
  data: UpdateUserData,
): Promise<UserPublic | null> {
  const patch: Record<string, unknown> = {
    updatedAt: new Date(),
    updatedBy: data.actorId,
  };
  if (data.displayName !== undefined) patch.displayName = data.displayName;
  if (data.role !== undefined) patch.role = data.role;
  if (data.isActive !== undefined) patch.isActive = data.isActive;

  const [row] = await db
    .update(usersTable)
    .set(patch)
    .where(eq(usersTable.id, id))
    .returning(PUBLIC_COLUMNS);
  return row ?? null;
}

export async function updatePasswordHashInDb(
  id: number,
  passwordHash: string,
  actorId: number,
): Promise<UserPublic | null> {
  const [row] = await db
    .update(usersTable)
    .set({ passwordHash, updatedAt: new Date(), updatedBy: actorId })
    .where(eq(usersTable.id, id))
    .returning(PUBLIC_COLUMNS);
  return row ?? null;
}
