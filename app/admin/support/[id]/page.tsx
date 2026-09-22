// M19.2 — Admin Support ticket thread (server shell + client thread).
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { resolveActorFromCookies, rankOf, ROLES } from '@/lib/auth/rbac';
import { supportService } from '@/lib/services/supportService';
import { stripInternal } from '@/lib/services/supportService';
import AdminSupportThread from './AdminSupportThread';

export const dynamic = 'force-dynamic';

export default async function AdminSupportThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await resolveActorFromCookies();
  if (!actor) redirect('/login?next=/admin/support');
  if (rankOf(actor.user.role) < rankOf(ROLES.ADMIN)) redirect('/dashboard');
  const { id } = await params;
  try {
    const { ticket, messages } = await supportService.adminGetTicket(id);
    // Serialise dates for the client component (Date instances aren't
    // serialisable across the RSC boundary).
    const stripped = stripInternal(ticket);
    const clientTicket = {
      ...stripped,
      created_at: stripped.created_at.toISOString(),
      last_message_at: stripped.last_message_at.toISOString(),
    };
    const clientMessages = messages.map((m) => ({
      id: m.id, sender: m.sender, sender_display_name: m.sender_display_name,
      body: m.body, created_at: m.created_at.toISOString(),
    }));
    return (
      <div className="p-6">
        <div className="mb-3"><Link href="/admin/support" className="text-xs text-muted-foreground hover:underline">← Support inbox</Link></div>
        <AdminSupportThread ticket={clientTicket} initialMessages={clientMessages} />
      </div>
    );
  } catch { notFound(); }
}
