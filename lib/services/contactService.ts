// M14 — Contact submissions service.
//
// Behaviour:
//   • Always persists submission (canonical source of truth).
//   • If a transactional email provider env is configured (hasEmailDelivery),
//     attempts to send a copy to hello@p2plabs.asia via nodemailer/SMTP.
//     WaveLead does not embed provider-specific SDKs — SMTP env variables
//     (SMTP_HOST/USER/PASS/PORT) are the only supported transport here.
//   • Never blocks the request on email failure; delivery_status is recorded
//     on the persisted doc and returned to the caller.

import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { getCollection } from '@/lib/db/mongo';
import { COLLECTIONS } from '@/lib/db/collections';
import { HttpError } from '@/lib/auth/rbac';
import { hasEmailDelivery } from '@/lib/services/marketplaceService';

const CONTACT_TOPICS = ['general', 'support', 'partnership', 'enterprise', 'press', 'other'] as const;
export type ContactTopic = typeof CONTACT_TOPICS[number];

export const contactSubmissionSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(120),
  email: z.string().trim().toLowerCase().email('Valid email required').max(200),
  company: z.string().trim().max(200).optional().or(z.literal('')),
  topic: z.enum(CONTACT_TOPICS),
  message: z.string().trim().min(10, 'Message must be at least 10 characters').max(4000),
  page_context: z.string().trim().max(500).optional().or(z.literal('')),
});

export type ContactSubmissionInput = z.infer<typeof contactSubmissionSchema>;

export type ContactDeliveryStatus =
  | 'persisted_only'          // no mail transport configured
  | 'sent'                    // mail transport configured and send succeeded
  | 'send_failed';            // mail transport configured but send raised

export interface ContactSubmissionRecord {
  id: string;
  name: string;
  email: string;
  company: string | null;
  topic: ContactTopic;
  message: string;
  page_context: string | null;
  ip: string | null;
  user_agent: string | null;
  destination: string;
  delivery_status: ContactDeliveryStatus;
  delivery_error?: string | null;
  created_at: Date;
}

const CONTACT_DESTINATION = 'hello@p2plabs.asia';

async function trySendEmail(rec: ContactSubmissionRecord): Promise<{ status: ContactDeliveryStatus; error?: string }> {
  // Only SMTP is considered a real transport here. Provider SDKs (SendGrid,
  // Resend, Postmark, Mailgun, SES) are intentionally NOT hooked up in this
  // task per the operator's instruction to reuse existing infrastructure only.
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || 'no-reply@wavelead.dev';
  if (!host) return { status: 'persisted_only' };
  try {
    // Dynamic import so environments without nodemailer installed don't crash
    // at module load. We suppress TS's module-not-found because nodemailer is
    // intentionally optional — the app never fails on its absence.
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore optional dependency
    const mod: unknown = await import('nodemailer').catch(() => null);
    const nodemailer = (mod as { createTransport?: (o: unknown) => { sendMail: (m: unknown) => Promise<unknown> } } | null);
    if (!nodemailer?.createTransport) return { status: 'persisted_only' };
    const transporter = nodemailer.createTransport({
      host, port,
      secure: port === 465,
      auth: user && pass ? { user, pass } : undefined,
    });
    const subject = `[WaveLead Contact] ${rec.topic} — ${rec.name}`;
    const text = [
      `Name: ${rec.name}`,
      `Email: ${rec.email}`,
      `Company / Organization: ${rec.company || '-'}`,
      `Topic: ${rec.topic}`,
      '',
      `Message:`,
      rec.message,
      '',
      `Submitted via: WaveLead Contact Form`,
    ].join('\n');
    await transporter.sendMail({ from, to: CONTACT_DESTINATION, replyTo: rec.email, subject, text });
    return { status: 'sent' };
  } catch (e) {
    // Sanitize the stored error: keep only a short symbolic code so we never
    // persist credentials, connection strings, or verbose stack traces.
    const err = e as { code?: string; message?: string };
    const code = typeof err.code === 'string' ? err.code : null;
    const safeMsg = code || (err.message ? err.message.split('\n')[0].slice(0, 120) : 'send_error');
    return { status: 'send_failed', error: safeMsg };
  }
}

export const contactService = {
  CONTACT_TOPICS,
  destination: CONTACT_DESTINATION,

  hasRealEmailDelivery(): boolean {
    // "Real" transport for the Contact form = SMTP config. The generic
    // hasEmailDelivery() probe includes provider env vars that WaveLead does
    // not currently wire up for outbound sending.
    return !!process.env.SMTP_HOST;
  },

  hasAnyEmailDeliveryProbe(): boolean { return hasEmailDelivery(); },

  async submit(input: unknown, ctx: { ip: string | null; userAgent: string | null }): Promise<{
    ok: true;
    submission_id: string;
    delivery_status: ContactDeliveryStatus;
  }> {
    const parsed = contactSubmissionSchema.safeParse(input);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    }
    const data = parsed.data;
    const now = new Date();
    const rec: ContactSubmissionRecord = {
      id: uuidv4(),
      name: data.name,
      email: data.email,
      company: data.company?.trim() ? data.company.trim() : null,
      topic: data.topic,
      message: data.message,
      page_context: data.page_context?.trim() ? data.page_context.trim() : null,
      ip: ctx.ip,
      user_agent: ctx.userAgent,
      destination: CONTACT_DESTINATION,
      delivery_status: 'persisted_only',
      delivery_error: null,
      created_at: now,
    };
    const coll = await getCollection<ContactSubmissionRecord>(COLLECTIONS.CONTACT_SUBMISSIONS);
    await coll.insertOne(rec);
    // Best-effort email — never blocks user response on transport failure.
    const send = await trySendEmail(rec);
    if (send.status !== rec.delivery_status) {
      await coll.updateOne(
        { id: rec.id },
        { $set: { delivery_status: send.status, delivery_error: send.error || null } },
      );
    }
    return { ok: true, submission_id: rec.id, delivery_status: send.status };
  },
};
