import bcrypt from "bcryptjs";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const SALT_ROUNDS = 12;

function getKey(): Buffer {
  const raw = process.env["PASSWORD_ENCRYPTION_KEY"];
  if (!raw) {
    throw new Error("PASSWORD_ENCRYPTION_KEY environment variable is required");
  }
  const buf = Buffer.from(raw, "hex");
  if (buf.length !== 32) {
    throw new Error("PASSWORD_ENCRYPTION_KEY must be a 64-character hex string (32 bytes for AES-256)");
  }
  return buf;
}

function encryptValue(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

function decryptValue(ciphertext: string): string {
  const key = getKey();
  const buf = Buffer.from(ciphertext, "base64");
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export async function hashPassword(password: string): Promise<string> {
  const bcryptHash = await bcrypt.hash(password, SALT_ROUNDS);
  return encryptValue(bcryptHash);
}

export async function verifyPassword(password: string, storedValue: string): Promise<boolean> {
  try {
    const bcryptHash = decryptValue(storedValue);
    return await bcrypt.compare(password, bcryptHash);
  } catch {
    return false;
  }
}
