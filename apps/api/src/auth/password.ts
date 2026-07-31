import * as argon2 from 'argon2';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(
  password: string,
  passwordHash: string | null,
): Promise<boolean> {
  if (passwordHash === null) {
    return false;
  }
  try {
    return await argon2.verify(passwordHash, password);
  } catch {
    // Malformed or foreign hash format — treat as invalid, not a crash.
    return false;
  }
}
