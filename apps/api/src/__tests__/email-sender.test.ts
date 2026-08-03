import { describe, expect, it, vi } from 'vitest';

import { createEmailSender } from '../auth/email-sender.js';

describe('createEmailSender', () => {
  it('prints a copy-pasteable password completion request for the console transport', async () => {
    const write = vi.fn<(message: string) => void>();
    const sender = createEmailSender({ transport: 'console', httpPort: 3000, write });

    await expect(
      sender.sendPasswordReset({
        to: 'developer@example.test',
        token: 'copy-this-reset-token',
        expiresAt: new Date('2030-01-02T03:04:05.000Z'),
      }),
    ).resolves.toBeUndefined();

    expect(write).toHaveBeenCalledOnce();
    expect(write.mock.calls[0]?.[0]).toContain('Reset token: copy-this-reset-token');
    expect(write.mock.calls[0]?.[0]).toContain(
      "curl --request POST 'http://localhost:3000/api/v1/auth/password-reset/complete'",
    );
    expect(write.mock.calls[0]?.[0]).toContain(
      '"token":"copy-this-reset-token","newPassword":"REPLACE_WITH_A_STRONG_PASSWORD"',
    );
  });

  it('fails loudly when the selected transport is not implemented', async () => {
    const sender = createEmailSender({ transport: 'smtp', httpPort: 3000 });

    await expect(
      sender.sendPasswordReset({ to: 'user@example.test', token: 'token', expiresAt: new Date() }),
    ).rejects.toThrow('Password reset email transport "smtp" is not implemented');
  });
});
