// M16 — Shared best-effort transactional mailer.
//
// Reuses the EXISTING production SMTP/nodemailer infrastructure only
// (SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM). No new email
// provider is introduced.
//
// Contract:
//   • NEVER throws. A mail failure must never roll back a commercial action.
//   • Returns a safe, symbolic delivery status only (no credentials, no
//     stack traces, no internal IDs).
//   • If SMTP is not configured → 'smtp_not_configured' (callers must treat
//     this as a non-error and continue).

import { resolveSmtpConfig, isSmtpConfigured, smtpTransportOptions } from '@/lib/services/smtpConfig';

export type MailDeliveryStatus = 'sent' | 'smtp_not_configured' | 'send_failed';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}

export interface MailResult {
  status: MailDeliveryStatus;
  error?: string | null;
}

/** SMTP is the only supported transport for WaveLead transactional email. */
export function hasSmtpTransport(): boolean {
  // Normalized read: quoted / whitespace-padded / blank values are handled.
  return isSmtpConfigured();
}

/** Canonical app origin used to build safe deep-links inside emails. */
export function appOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_BASE_URL || '';
  return raw.replace(/\/+$/, '');
}

function looksLikeEmail(v: unknown): v is string {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

export async function sendMailBestEffort(msg: MailMessage): Promise<MailResult> {
  if (!looksLikeEmail(msg.to)) return { status: 'send_failed', error: 'invalid_recipient' };
  const cfg = resolveSmtpConfig();
  if (!cfg.configured) return { status: 'smtp_not_configured' };
  try {
    // Dynamic import so environments without nodemailer never crash at load.
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore optional dependency
    const mod: unknown = await import('nodemailer').catch(() => null);
    const nodemailer = mod as { createTransport?: (o: unknown) => { sendMail: (m: unknown) => Promise<unknown> } } | null;
    if (!nodemailer?.createTransport) return { status: 'smtp_not_configured' };
    const transporter = nodemailer.createTransport(smtpTransportOptions(cfg));
    await transporter.sendMail({
      from: cfg.from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      ...(msg.replyTo ? { replyTo: msg.replyTo } : {}),
    });
    return { status: 'sent' };
  } catch (e) {
    const err = e as { code?: string; message?: string };
    const code = typeof err.code === 'string' ? err.code : null;
    const safe = code || (err.message ? err.message.split('\n')[0].slice(0, 120) : 'send_error');
    return { status: 'send_failed', error: safe };
  }
}
