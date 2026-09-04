import * as argon2 from 'argon2';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export type PasswordPolicyReason =
  | 'minimum_12_characters'
  | 'uppercase_required'
  | 'lowercase_required'
  | 'number_required'
  | 'symbol_required';

/** The single server-owned password policy used by every password mutation. */
export function passwordPolicyReasons(password: string): PasswordPolicyReason[] {
  const reasons: PasswordPolicyReason[] = [];
  if ([...password].length < 12) reasons.push('minimum_12_characters');
  if (!/[A-Z]/u.test(password)) reasons.push('uppercase_required');
  if (!/[a-z]/u.test(password)) reasons.push('lowercase_required');
  if (!/[0-9]/u.test(password)) reasons.push('number_required');
  if (!/[^A-Za-z0-9]/u.test(password)) reasons.push('symbol_required');
  return reasons;
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
