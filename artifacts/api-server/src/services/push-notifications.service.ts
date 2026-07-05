import { eq, and, inArray, isNull } from "drizzle-orm";
import { db, studentGuardiansTable, usersTable } from "@workspace/db";
import { logger } from "../lib/logger";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  badge?: number;
}

interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

async function sendExpoPushNotifications(messages: ExpoPushMessage[]): Promise<void> {
  if (messages.length === 0) return;

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages),
    });

    if (!res.ok) {
      logger.warn({ status: res.status }, "Expo push API returned non-OK status");
      return;
    }

    const json = (await res.json()) as { data: ExpoPushTicket[] };
    for (const ticket of json.data ?? []) {
      if (ticket.status === "error") {
        logger.warn({ ticket }, "Expo push ticket error");
      }
    }
  } catch (err) {
    logger.warn({ err }, "Failed to send Expo push notifications");
  }
}

/**
 * Looks up all parent guardians for a student that have a registered push
 * token and sends them a push notification.
 *
 * Never throws — failures are logged and swallowed so they never block the
 * primary request.
 */
export async function notifyParentsForStudent(
  studentId: number,
  studentName: string,
  title: string,
  body: string,
  deepLinkPath: string,
): Promise<void> {
  try {
    const guardianRows = await db
      .select({ userId: studentGuardiansTable.userId })
      .from(studentGuardiansTable)
      .where(eq(studentGuardiansTable.studentId, studentId));

    if (guardianRows.length === 0) return;

    const userIds = guardianRows.map((r) => r.userId);

    const parentRows = await db
      .select({ pushToken: usersTable.pushToken })
      .from(usersTable)
      .where(
        and(
          inArray(usersTable.id, userIds),
          eq(usersTable.role, "parent"),
          eq(usersTable.isActive, true),
        ),
      );

    const tokens = parentRows
      .map((r) => r.pushToken)
      .filter((t): t is string => t !== null && t.startsWith("ExponentPushToken["));

    if (tokens.length === 0) return;

    const messages: ExpoPushMessage[] = tokens.map((token) => ({
      to: token,
      title,
      body,
      sound: "default",
      data: {
        studentId,
        studentName,
        path: deepLinkPath,
      },
    }));

    await sendExpoPushNotifications(messages);
  } catch (err) {
    logger.warn({ err, studentId }, "notifyParentsForStudent failed");
  }
}
