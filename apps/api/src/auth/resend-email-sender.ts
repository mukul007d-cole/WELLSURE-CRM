import type { CampaignEmailSender, EmailMessage, EmailSender } from './password-reset.js';

/**
 * Real delivery through Resend's HTTP API.
 *
 * Uses the global `fetch` built into Node 24 rather than a provider SDK, so this
 * adds no production dependency (`AGENTS.md`). The whole provider surface this
 * needs is one POST.
 */
const ENDPOINT = 'https://api.resend.com/emails';

export interface ResendConfig {
  apiKey: string;
  /** Verified sender, e.g. `Falcon CRM <no-reply@notify.example.com>`. */
  from: string;
  /** Verified campaign sender, ideally on a reputation-isolated subdomain. */
  campaignFrom: string;
  /** Public origin of the deployed web app, with no trailing slash. */
  publicBaseUrl: string;
  /** Injected in tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

/**
 * Escapes text destined for an HTML email body.
 *
 * The password-reset mail is assembled here from a recipient address and a
 * token, so this is defence in depth rather than a known injection path — but
 * the address comes from user-controlled configuration, and an email body is a
 * place markup would be honoured.
 */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function createResendEmailSender(config: ResendConfig): EmailSender & CampaignEmailSender {
  const send = async (message: EmailMessage, from: string): Promise<void> => {
    const fetchImpl = config.fetchImpl ?? fetch;
    let response: Response;
    try {
      response = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
        }),
      });
    } catch (cause) {
      // A transport failure must reject, never resolve. `campaign_sends` records
      // the outcome from this promise, and a silent success would mark a message
      // sent that never left.
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`Resend request failed: ${reason}`, { cause });
    }

    if (!response.ok) {
      // The body carries Resend's reason (unverified domain, bad key, invalid
      // recipient). Losing it would make every failure look the same in the logs.
      const detail = await response.text().catch(() => '');
      throw new Error(
        `Resend rejected the message: ${response.status} ${response.statusText}${
          detail ? ` — ${detail.slice(0, 500)}` : ''
        }`,
      );
    }
  };

  return {
    sendPasswordReset({ to, token, expiresAt }) {
      // Points at the web form, not the JSON POST endpoint a link cannot invoke.
      const url = `${config.publicBaseUrl}/reset-password?token=${encodeURIComponent(token)}`;
      return send(
        {
          to,
          subject: 'Set your Falcon CRM password',
          html: [
            '<p>An administrator has created a Falcon CRM account for you.</p>',
            `<p><a href="${escapeHtml(url)}">Set your password</a></p>`,
            `<p>This link expires at ${escapeHtml(expiresAt.toISOString())}.</p>`,
            '<p>If you were not expecting this, you can ignore this message.</p>',
          ].join('\n'),
        },
        config.from,
      );
    },
    sendEmail(message) {
      // Campaign bodies are already rendered and escaped by the campaign
      // document renderer (ADR-0013); nothing is re-escaped here.
      return send(message, config.campaignFrom);
    },
  };
}
