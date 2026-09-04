import { describe, expect, it, vi } from 'vitest';

import { createResendEmailSender } from '../auth/resend-email-sender.js';

const config = {
  apiKey: 're_test_key',
  from: 'Falcon CRM <no-reply@notify.example.test>',
  campaignFrom: 'Falcon Campaigns <news@mail.example.test>',
  publicBaseUrl: 'https://crm.example.test',
};

/** A `fetch` that records its call and returns whatever the test wants back. */
function stubFetch(response: Partial<Response> & { ok: boolean }) {
  return vi.fn<typeof fetch>(() => Promise.resolve(response as Response));
}

function bodyOf(fetchImpl: ReturnType<typeof stubFetch>): Record<string, unknown> {
  const init = fetchImpl.mock.calls[0]?.[1];
  return JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>;
}

describe('createResendEmailSender', () => {
  it('posts a password reset to the provider with the caller-supplied sender', async () => {
    const fetchImpl = stubFetch({ ok: true });
    const sender = createResendEmailSender({ ...config, fetchImpl });

    await expect(
      sender.sendPasswordReset({
        to: 'invited@example.test',
        token: 'the-reset-token',
        expiresAt: new Date('2030-01-02T03:04:05.000Z'),
      }),
    ).resolves.toBeUndefined();

    const call = fetchImpl.mock.calls[0];
    expect(call?.[0]).toBe('https://api.resend.com/emails');
    expect(call?.[1]?.method).toBe('POST');
    expect((call?.[1]?.headers as Record<string, string>).authorization).toBe('Bearer re_test_key');

    const body = bodyOf(fetchImpl);
    expect(body.from).toBe(config.from);
    expect(body.to).toEqual(['invited@example.test']);
  });

  it('links to the web application, not to the API endpoint', async () => {
    // The completion route is a POST with a JSON body. A link in an email
    // cannot invoke it, so pointing there would send people somewhere that
    // cannot work.
    const fetchImpl = stubFetch({ ok: true });
    const sender = createResendEmailSender({ ...config, fetchImpl });

    await sender.sendPasswordReset({
      to: 'invited@example.test',
      token: 'token with spaces/&',
      expiresAt: new Date('2030-01-02T03:04:05.000Z'),
    });

    const html = String(bodyOf(fetchImpl).html);
    expect(html).toContain('https://crm.example.test/reset-password?token=');
    expect(html).not.toContain('/api/v1/auth/password-reset/complete');
    // Encoded once for the URL, then escaped for the HTML attribute.
    expect(html).toContain('token%20with%20spaces%2F%26'.replace('&', '&amp;'));
  });

  it('sends a campaign message through without re-escaping its rendered body', async () => {
    // Campaign bodies are already rendered and escaped by the campaign document
    // renderer (ADR-0013); escaping again would show markup as text.
    const fetchImpl = stubFetch({ ok: true });
    const sender = createResendEmailSender({ ...config, fetchImpl });

    await sender.sendEmail({
      to: 'seller@example.test',
      subject: 'Your renewal',
      html: '<p>Hello <strong>there</strong></p>',
    });

    expect(bodyOf(fetchImpl)).toMatchObject({
      from: config.campaignFrom,
      subject: 'Your renewal',
      html: '<p>Hello <strong>there</strong></p>',
    });
  });

  it('rejects, with the provider reason, when the provider refuses the message', async () => {
    // `campaign_sends` records the outcome from this promise. Resolving on a
    // rejection would mark a message sent that never left.
    const fetchImpl = stubFetch({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      text: () => Promise.resolve('{"message":"The notify.example.test domain is not verified"}'),
    });
    const sender = createResendEmailSender({ ...config, fetchImpl });

    await expect(
      sender.sendEmail({ to: 'seller@example.test', subject: 's', html: 'h' }),
    ).rejects.toThrow(/403 Forbidden — .*domain is not verified/);
  });

  it('rejects when the request itself fails', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.reject(new Error('ECONNREFUSED')));
    const sender = createResendEmailSender({ ...config, fetchImpl });

    await expect(
      sender.sendPasswordReset({ to: 'a@example.test', token: 't', expiresAt: new Date() }),
    ).rejects.toThrow(/Resend request failed: ECONNREFUSED/);
  });
});
