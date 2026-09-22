// M19.2 — In-product Support Inbox service.
//
// Thread-based chat. One ticket per conversation, append-only messages.
//
// Trust model:
//   • A visitor (anonymous OR authenticated) opens a ticket. The server
//     returns an opaque access_token bound to that ticket (uuid). The client
//     stores it in localStorage. Subsequent reads/writes for that ticket by
//     the requester require the token OR a matching created_by_user_id.
//   • Admin operations require an admin actor. The route layer enforces this.
//   • Bodies are plain text. No HTML is stored or rendered as HTML by the UI.
//   • Rate limiting is enforced at the route layer.
//
// This service NEVER touches marketplace / campaign / payment data.
import { v4 as uuidv4 } from 'uuid';
import { getCollection } from '@/lib/db/mongo';
import { COLLECTIONS } from '@/lib/db/collections';
import { HttpError } from '@/lib/auth/rbac';
import type { Actor } from '@/lib/types';

export type SupportTicketStatus = 'open' | 'awaiting_admin' | 'awaiting_user' | 'closed';
export type SupportSender = 'user' | 'admin';

export interface SupportTicketRow {
  id: string;
  access_token: string;                 // opaque, returned to the ticket creator only
  created_by_user_id: string | null;
  requester_email: string;              // lowercased
  requester_name: string | null;
  subject: string | null;
  status: SupportTicketStatus;
  unread_by_admin: number;
  unread_by_user: number;
  last_message_at: Date;
  last_message_preview: string;
  created_at: Date;
  updated_at: Date;
  closed_at: Date | null;
  closed_by_user_id: string | null;
}

export interface SupportMessageRow {
  id: string;
  ticket_id: string;
  sender: SupportSender;
  sender_user_id: string | null;
  sender_display_name: string | null;
  body: string;
  created_at: Date;
}

const SUBJECT_MAX = 120;
const BODY_MAX = 4_000;
const PREVIEW_MAX = 160;
const EMAIL_MAX = 254;
const NAME_MAX = 80;

function cleanString(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  // Normalise CRLF, strip control chars except newline/tab, collapse long runs.
  const s = v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  return s.slice(0, max);
}

function cleanEmail(v: unknown): string {
  const s = cleanString(v, EMAIL_MAX).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new HttpError(400, 'A valid email is required');
  return s;
}

function previewOf(body: string): string {
  const oneLine = body.replace(/\s+/g, ' ').trim();
  return oneLine.length <= PREVIEW_MAX ? oneLine : `${oneLine.slice(0, PREVIEW_MAX - 1)}…`;
}

async function tickets() { return getCollection<SupportTicketRow>(COLLECTIONS.SUPPORT_TICKETS); }
async function messages() { return getCollection<SupportMessageRow>(COLLECTIONS.SUPPORT_MESSAGES); }

export function stripInternal<T extends { access_token?: string }>(row: T): Omit<T, 'access_token'> {
  const { access_token: _drop, ...rest } = row as T & { access_token?: string };
  void _drop; return rest;
}

export interface CreateTicketInput {
  email?: string; name?: string; subject?: string; body: string;
}

export const supportService = {
  /** Create a ticket + the first user message. Returns the ticket + access_token. */
  async createTicket(actor: Actor | null, input: CreateTicketInput): Promise<{ ticket: SupportTicketRow; message: SupportMessageRow; access_token: string }> {
    const body = cleanString(input.body, BODY_MAX);
    if (body.length < 2) throw new HttpError(400, 'Please write a short message so we can help.');
    const email = actor?.user.email
      ? cleanString(actor.user.email, EMAIL_MAX).toLowerCase()
      : cleanEmail(input.email);
    const name = actor?.user.display_name
      ? cleanString(actor.user.display_name, NAME_MAX)
      : cleanString(input.name, NAME_MAX) || null;
    const subject = cleanString(input.subject, SUBJECT_MAX) || null;
    const now = new Date();
    const access_token = uuidv4() + '-' + uuidv4();
    const ticket: SupportTicketRow = {
      id: uuidv4(),
      access_token,
      created_by_user_id: actor?.user.id ?? null,
      requester_email: email,
      requester_name: (name as string | null) || null,
      subject,
      status: 'awaiting_admin',
      unread_by_admin: 1,
      unread_by_user: 0,
      last_message_at: now,
      last_message_preview: previewOf(body),
      created_at: now,
      updated_at: now,
      closed_at: null,
      closed_by_user_id: null,
    };
    const message: SupportMessageRow = {
      id: uuidv4(),
      ticket_id: ticket.id,
      sender: 'user',
      sender_user_id: actor?.user.id ?? null,
      sender_display_name: (name as string | null) || null,
      body,
      created_at: now,
    };
    await (await tickets()).insertOne(ticket);
    await (await messages()).insertOne(message);
    return { ticket, message, access_token };
  },

  /** Requester-side read. Requires either the token OR an authed match. */
  async getForRequester(ticketId: string, actor: Actor | null, accessToken: string | null): Promise<{ ticket: SupportTicketRow; messages: SupportMessageRow[] }> {
    const t = await (await tickets()).findOne({ id: ticketId });
    if (!t) throw new HttpError(404, 'Ticket not found');
    const tokenOk = !!accessToken && accessToken === t.access_token;
    const ownerOk = !!actor?.user.id && t.created_by_user_id === actor.user.id;
    if (!tokenOk && !ownerOk) throw new HttpError(403, 'You are not allowed to view this ticket');
    const list = await (await messages()).find({ ticket_id: ticketId }).sort({ created_at: 1 }).toArray();
    // Reset requester-unread counter on read.
    if (t.unread_by_user > 0) {
      await (await tickets()).updateOne({ id: ticketId }, { $set: { unread_by_user: 0, updated_at: new Date() } });
      t.unread_by_user = 0;
    }
    return { ticket: t, messages: list };
  },

  /** Requester-side append. Same auth rules as read. */
  async addRequesterMessage(ticketId: string, actor: Actor | null, accessToken: string | null, body: string): Promise<SupportMessageRow> {
    const clean = cleanString(body, BODY_MAX);
    if (clean.length < 1) throw new HttpError(400, 'Message is empty');
    const t = await (await tickets()).findOne({ id: ticketId });
    if (!t) throw new HttpError(404, 'Ticket not found');
    const tokenOk = !!accessToken && accessToken === t.access_token;
    const ownerOk = !!actor?.user.id && t.created_by_user_id === actor.user.id;
    if (!tokenOk && !ownerOk) throw new HttpError(403, 'You are not allowed to post to this ticket');
    if (t.status === 'closed') throw new HttpError(409, 'This ticket is closed. Please open a new one.');
    const now = new Date();
    const message: SupportMessageRow = {
      id: uuidv4(), ticket_id: ticketId, sender: 'user',
      sender_user_id: actor?.user.id ?? null,
      sender_display_name: actor?.user.display_name ?? t.requester_name ?? null,
      body: clean, created_at: now,
    };
    await (await messages()).insertOne(message);
    await (await tickets()).updateOne({ id: ticketId }, { $set: {
      status: 'awaiting_admin',
      last_message_at: now, last_message_preview: previewOf(clean),
      updated_at: now,
    }, $inc: { unread_by_admin: 1 } });
    return message;
  },

  // ---------- ADMIN ----------

  async adminListTickets({ status }: { status?: SupportTicketStatus | 'all' } = {}): Promise<SupportTicketRow[]> {
    const q = status && status !== 'all' ? { status } : {};
    return (await tickets()).find(q).sort({ last_message_at: -1 }).limit(200).toArray();
  },

  async adminGetTicket(ticketId: string): Promise<{ ticket: SupportTicketRow; messages: SupportMessageRow[] }> {
    const t = await (await tickets()).findOne({ id: ticketId });
    if (!t) throw new HttpError(404, 'Ticket not found');
    const list = await (await messages()).find({ ticket_id: ticketId }).sort({ created_at: 1 }).toArray();
    // Reset admin-unread on view.
    if (t.unread_by_admin > 0) {
      await (await tickets()).updateOne({ id: ticketId }, { $set: { unread_by_admin: 0, updated_at: new Date() } });
      t.unread_by_admin = 0;
    }
    return { ticket: t, messages: list };
  },

  async adminReply(admin: Actor, ticketId: string, body: string): Promise<SupportMessageRow> {
    const clean = cleanString(body, BODY_MAX);
    if (clean.length < 1) throw new HttpError(400, 'Reply is empty');
    const t = await (await tickets()).findOne({ id: ticketId });
    if (!t) throw new HttpError(404, 'Ticket not found');
    if (t.status === 'closed') throw new HttpError(409, 'This ticket is closed. Reopen it before replying.');
    const now = new Date();
    const message: SupportMessageRow = {
      id: uuidv4(), ticket_id: ticketId, sender: 'admin',
      sender_user_id: admin.user.id,
      sender_display_name: admin.user.display_name || 'WaveLead Support',
      body: clean, created_at: now,
    };
    await (await messages()).insertOne(message);
    await (await tickets()).updateOne({ id: ticketId }, { $set: {
      status: 'awaiting_user',
      last_message_at: now, last_message_preview: previewOf(clean),
      updated_at: now,
    }, $inc: { unread_by_user: 1 } });
    return message;
  },

  async adminSetStatus(admin: Actor, ticketId: string, status: SupportTicketStatus): Promise<SupportTicketRow> {
    const t = await (await tickets()).findOne({ id: ticketId });
    if (!t) throw new HttpError(404, 'Ticket not found');
    const now = new Date();
    const patch: Partial<SupportTicketRow> = { status, updated_at: now };
    if (status === 'closed') { patch.closed_at = now; patch.closed_by_user_id = admin.user.id; }
    if (status !== 'closed') { patch.closed_at = null; patch.closed_by_user_id = null; }
    await (await tickets()).updateOne({ id: ticketId }, { $set: patch });
    return { ...t, ...patch } as SupportTicketRow;
  },

  async adminStats(): Promise<{ open: number; awaiting_admin: number; awaiting_user: number; closed: number; total_unread_admin: number }> {
    const col = await tickets();
    const [open, aa, au, cl, unread] = await Promise.all([
      col.countDocuments({ status: 'open' }),
      col.countDocuments({ status: 'awaiting_admin' }),
      col.countDocuments({ status: 'awaiting_user' }),
      col.countDocuments({ status: 'closed' }),
      col.aggregate<{ n: number }>([{ $match: { status: { $ne: 'closed' } } }, { $group: { _id: null, n: { $sum: '$unread_by_admin' } } }]).toArray().then((r) => r[0]?.n || 0),
    ]);
    return { open, awaiting_admin: aa, awaiting_user: au, closed: cl, total_unread_admin: unread };
  },
};
