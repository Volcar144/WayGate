import { env } from '@/env';
import nodemailer from 'nodemailer';

export type SendResult = { ok: boolean; error?: string };

/**
 * Sends a sign-in (magic) email containing a one-time link to the specified recipient.
 *
 * @param to - Recipient email address
 * @param magicUrl - The sign-in URL to include in the email body
 * @returns An object with `ok` set to `true` when the message was sent successfully; if `ok` is `false`, `error` contains an error code or message describing the failure
 */
export async function sendMagicEmail(to: string, magicUrl: string): Promise<SendResult> {
  try {
    if (!env.SMTP_HOST || !env.SMTP_PORT || !env.EMAIL_FROM) {
      return { ok: false, error: 'smtp_not_configured' };
    }

    const transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: false,
      auth: env.SMTP_USER && env.SMTP_PASS ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    } as any);

    const subject = 'Your Waygate sign-in link';
    const text = `Click the link to sign in: ${magicUrl}`;
    const html = `<p>Click the link to sign in:</p><p><a href="${magicUrl}">${magicUrl}</a></p>`;

    await transporter.sendMail({
      from: env.EMAIL_FROM,
      to,
      subject,
      text,
      html,
    });
    return { ok: true };
  } catch (e: any) {
    try { const Sentry = require('@sentry/nextjs'); Sentry.captureException(e); } catch {}
    console.error('Failed to send magic email', e);
    return { ok: false, error: e?.message || 'send_failed' };
  }
}