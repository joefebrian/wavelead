'use client';
// M19.2 — Admin thread client component. Polls for new user messages and
// allows the admin to send replies + change status. Server is authoritative.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Send } from 'lucide-react';

interface Message { id: string; sender: 'user' | 'admin'; sender_display_name: string | null; body: string; created_at: string; }
interface Ticket { id: string; requester_email: string; requester_name: string | null; subject: string | null; status: string; created_at: string; last_message_at: string; }

export default function AdminSupportThread({ ticket, initialMessages }: { ticket: Ticket; initialMessages: Message[] }) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [status, setStatus] = useState(ticket.status);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/support/tickets/${ticket.id}`, { credentials: 'include' });
      const j = await r.json();
      if (r.ok && j?.ok) { setMessages(j.data.messages); setStatus(j.data.ticket.status); }
    } catch { /* ignore */ }
  }, [ticket.id]);

  useEffect(() => { const iv = window.setInterval(() => { void refresh(); }, 5000); return () => window.clearInterval(iv); }, [refresh]);
  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages.length]);

  async function sendReply(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setMsg(null);
    const body = reply.trim(); if (!body) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/support/tickets/${ticket.id}/messages`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(typeof j?.error === 'string' ? j.error : 'Could not send reply');
      setMessages((prev) => [...prev, j.data.message]);
      setStatus(j.data.ticket.status);
      setReply('');
    } catch (e2) { setErr((e2 as Error).message); } finally { setBusy(false); }
  }

  async function setTicketStatus(next: 'closed' | 'open') {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await fetch(`/api/admin/support/tickets/${ticket.id}/status`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: next }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(typeof j?.error === 'string' ? j.error : 'Could not update status');
      setStatus(j.data.ticket.status);
      setMsg(next === 'closed' ? 'Ticket closed.' : 'Ticket reopened.');
    } catch (e2) { setErr((e2 as Error).message); } finally { setBusy(false); }
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold" data-testid="support-ticket-title">{ticket.subject || `Support from ${ticket.requester_name || ticket.requester_email}`}</h1>
          <div className="text-xs text-muted-foreground">{ticket.requester_email}{ticket.requester_name ? ` · ${ticket.requester_name}` : ''}</div>
          <div className="text-xs text-muted-foreground">Ticket #{ticket.id.slice(0, 8)} · created {new Date(ticket.created_at).toLocaleString()}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide" data-testid="support-ticket-status">{status.replace(/_/g, ' ')}</span>
          {status === 'closed' ? (
            <button className="rounded-md border border-border px-2 py-1 text-xs" onClick={() => setTicketStatus('open')} disabled={busy} data-testid="support-reopen">Reopen</button>
          ) : (
            <button className="rounded-md border border-border px-2 py-1 text-xs" onClick={() => setTicketStatus('closed')} disabled={busy} data-testid="support-close">Close</button>
          )}
        </div>
      </div>
      {err && <div className="mb-2 text-xs text-rose-600" data-testid="support-thread-error">{err}</div>}
      {msg && <div className="mb-2 text-xs text-emerald-700">{msg}</div>}
      <div ref={listRef} className="max-h-[60vh] overflow-y-auto space-y-3 rounded-md border border-border p-3 bg-muted/30">
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.sender === 'admin' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${m.sender === 'admin' ? 'bg-primary text-primary-foreground' : 'bg-background border border-border'}`}>
              <div className="mb-0.5 text-[10px] opacity-70">{m.sender === 'admin' ? (m.sender_display_name || 'You') : (m.sender_display_name || ticket.requester_name || ticket.requester_email)} · {new Date(m.created_at).toLocaleString()}</div>
              <div>{m.body}</div>
            </div>
          </div>
        ))}
      </div>
      {status !== 'closed' && (
        <form onSubmit={sendReply} className="mt-3" data-testid="support-admin-reply">
          <textarea rows={3} value={reply} onChange={(e) => setReply(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            placeholder="Write your reply…" data-testid="support-admin-reply-input" />
          <div className="mt-2 flex justify-end">
            <button type="submit" disabled={busy || !reply.trim()}
              className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-semibold disabled:opacity-60"
              data-testid="support-admin-reply-submit">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Send reply
            </button>
          </div>
        </form>
      )}
    </>
  );
}
