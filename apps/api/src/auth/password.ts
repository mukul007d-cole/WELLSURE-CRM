import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const keyLength = 32;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('base64url');
  const key = (await scrypt(password, salt, keyLength)) as Buffer;
  return `argon2id$scrypt-shim$v=1$${salt}$${key.toString('base64url')}`;
}

export async function verifyPassword(
  password: string,
  passwordHash: string | null,
): Promise<boolean> {
  if (passwordHash === null) {
    return false;
  }
  const parts = passwordHash.split('$');
  if (parts.length !== 5 || parts[0] !== 'argon2id' || parts[1] !== 'scrypt-shim') {
    return false;
  }
  const [, , , salt, expected] = parts;
  if (salt === undefined || expected === undefined) {
    return false;
  }
  const actual = (await scrypt(password, salt, keyLength)) as Buffer;
  const expectedBuffer = Buffer.from(expected, 'base64url');
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
}
