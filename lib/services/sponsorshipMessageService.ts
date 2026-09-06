// M16 — Brand ↔ channel-owner conversation thread on a sponsorship request.
//
// Design constraints (deliberate):
//   • Append-only, plain text only, no attachments (Materials / Google Drive
//     URL on the request remains the file mechanism).
//   • No websockets / realtime — a page refresh is sufficient.
//   • Participants = the requesting brand (requester_user_id) and the owner
//     of the target channel. Admin/moderator has READ-ONLY oversight for
//     support, disputes and abuse handling; admin participation is never
//     required and admins do not post into the thread.
//   • Unrelated users → 403 (delegated to sponsorshipLeadService.getForViewer).
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { HttpError } from '@/lib/auth/rbac';
import { sponsorshipLeadService } from './sponsorshipLeadService';
import { sponsorshipMessageRepo } from '../repositories/sponsorshipMessageRepo';
import { sponsorshipNotificationService } from './sponsorshipNotificationService';
import type { Actor, SponsorshipLead, SponsorshipRequestMessage } from '@/lib/types';

const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 40;

const messageSchema = z.object({
  message: z.string().trim().min(1, 'Message is required').max(2000, 'Message is too long (max 2000 characters)'),
});

/** Plain text only — strip control characters, keep newlines. */
function sanitizePlainText(v: string): string {
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
}

export const sponsorshipMessageService = {
  /** Thread read — brand, target owner, or admin (oversight). */
  async list(actor: Actor, leadId: string): Promise<{
    lead: SponsorshipLead;
    viewer: 'owner' | 'requester' | 'admin';
    messages: SponsorshipRequestMessage[];
  }> {
    const { lead, viewer } = await sponsorshipLeadService.getForViewer(actor, leadId);
    const messages = await sponsorshipMessageRepo.listByLead(lead.id);
    return { lead, viewer, messages };
  },

  /**
   * Append a message. Only the two commercial participants may post — admins
   * read for oversight but do not participate.
   */
  async create(actor: Actor, leadId: string, input: unknown): Promise<{
    message: SponsorshipRequestMessage;
    email_status: string;
  }> {
    const parsed = messageSchema.safeParse(input);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Invalid message');
    const body = sanitizePlainText(parsed.data.message);
    if (!body) throw new HttpError(400, 'Message is required');

    const { lead, viewer } = await sponsorshipLeadService.getForViewer(actor, leadId);
    if (viewer === 'admin') {
      // An admin who is ALSO a participant is resolved as admin first; keep
      // the thread strictly bilateral for commercial clarity.
      const isRequester = !!lead.requester_user_id && lead.requester_user_id === actor.user.id;
      if (!isRequester) {
        throw new HttpError(403, 'Admins have read-only oversight of this conversation');
      }
    }
    const senderSide: 'owner' | 'brand' = viewer === 'owner' ? 'owner' : 'brand';

    const recent = await sponsorshipMessageRepo.recentBySenderCount(actor.user.id, RATE_WINDOW_MS);
    if (recent >= RATE_MAX) throw new HttpError(429, 'Too many messages sent. Please try again shortly.');

    const doc: SponsorshipRequestMessage = {
      id: uuidv4(),
      lead_id: lead.id,
      sender_user_id: actor.user.id,
      sender_side: senderSide,
      sender_display_name: senderSide === 'owner'
        ? (actor.user.display_name || 'Channel owner')
        : (lead.company_name || actor.user.display_name || 'Brand'),
      message: body,
      created_at: new Date(),
    };
    await sponsorshipMessageRepo.insert(doc);

    // Best-effort notification — a mail failure never fails the message.
    let email_status = 'skipped';
    try {
      const r = await sponsorshipNotificationService.notifyNewMessage(lead, doc);
      email_status = r.status;
    } catch { email_status = 'send_failed'; }

    return { message: doc, email_status };
  },
};
