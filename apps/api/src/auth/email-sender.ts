import type { CampaignEmailSender, EmailSender } from './password-reset.js';
import { createResendEmailSender } from './resend-email-sender.js';

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
 *
 * `console` stays the default (`parseEnv`), so local development is unchanged by
 * the existence of a real provider. Anything selected but unimplemented still
 * fails loudly rather than discarding mail.
 */
export function createEmailSender(input: {
  transport: string;
  httpPort: number;
  /** Required by every real transport; unused by `console`. */
  delivery?: { apiKey: string; from: string; publicBaseUrl: string };
  write?: (message: string) => void;
}): EmailSender & CampaignEmailSender {
  if (input.transport === 'resend') {
    // `parseEnv` refuses to start without these whenever the transport is not
    // `console`, so this branch is unreachable with delivery absent. Failing the
    // same way an unimplemented transport does beats a crash on the first send.
    if (!input.delivery) return deliveryNotConfigured(input.transport);
    return createResendEmailSender(input.delivery);
  }
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
