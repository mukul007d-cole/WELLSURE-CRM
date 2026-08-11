import type { CampaignEmailSender, EmailSender } from './password-reset.js';

const deliveryNotConfigured = (transport: string): EmailSender & CampaignEmailSender => ({
  sendPasswordReset() {
    return Promise.reject(
      new Error(`Password reset email transport "${transport}" is not implemented`),
    );
  },
  // A campaign send against an unconfigured transport fails loudly and is
  // recorded as failed. Silently reporting success would be worse than not
  // sending.
  sendEmail() {
    return Promise.reject(new Error(`Email transport "${transport}" is not implemented`));
  },
});

/**
 * Select password-reset delivery. The console transport exposes credentials and
 * is intended only for local development and first-run bootstrap.
 */
export function createEmailSender(input: {
  transport: string;
  httpPort: number;
  write?: (message: string) => void;
}): EmailSender & CampaignEmailSender {
  if (input.transport !== 'console') return deliveryNotConfigured(input.transport);

  const write = input.write ?? console.info;
  return {
    sendPasswordReset({ to, token, expiresAt }) {
      const endpoint = `http://localhost:${input.httpPort}/api/v1/auth/password-reset/complete`;
      const body = JSON.stringify({ token, newPassword: 'REPLACE_WITH_A_STRONG_PASSWORD' });
      write(
        [
          '[Falcon development email] Password setup requested.',
          `Recipient: ${to}`,
          `Expires: ${expiresAt.toISOString()}`,
          `Reset token: ${token}`,
          'Complete password setup (replace the password placeholder):',
          `curl --request POST '${endpoint}' --header 'content-type: application/json' --data '${body}'`,
        ].join('\n'),
      );
      return Promise.resolve();
    },
    sendEmail({ to, subject, html }) {
      write(
        [
          '[Falcon development email] Campaign message.',
          `Recipient: ${to}`,
          `Subject: ${subject}`,
          html,
        ].join('\n'),
      );
      return Promise.resolve();
    },
  };
}
