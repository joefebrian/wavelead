'use client';
// M19.2 correction — Public support widget (bottom-right).
//
// UX contract:
//   • Launcher button at bottom-right (fixed). Clicking opens a compact panel.
//   • If the visitor has no active thread (no HttpOnly guest cookie present),
//     they see the start form (email + first message). Once created, the
//     panel switches to the chat thread view.
//   • Server replies land on the next poll (3 s while panel is open). Messages
//     are plain text.
//   • PRIVACY (M19.2 correction §5):
//       - The guest access token is stored ONLY in a server-managed HttpOnly
//         cookie. It is never read by page JS, page URLs, logs or analytics.
//       - No support content (email, name, body, ticket id, thread URL) is
//         ever sent to GA4. The only optional signal is a coarse "widget
//         opened" event, gated by explicit analytics consent.
//   • Never rendered on /admin routes.
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { MessageCircle, X, Send, Loader2 } from 'lucide-react';

interface Message {
  id: string; sender: 'user' | 'admin'; sender_display_name: string | null;
  body: string; created_at: string;
}
interface TicketSummary { id: string; status: string; subject: string | null; requester_email: string; }

export default function SupportWidget() {
  const pathname = usePathname() || '';
  // Never render inside admin.
  const shouldRender = !pathname.startsWith('/admin');
  const [open, setOpen] = useState(false);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [firstMsg, setFirstMsg] = useState('');
  const [reply, setReply] = useState('');
  const [ticket, setTicket] = useState<TicketSummary | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [meEmail, setMeEmail] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Load: check whether the browser holds an active guest cookie.
  useEffect(() => {
    if (!shouldRender) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/support/session', { credentials: 'include' });
        const j = await r.json();
        if (!cancelled && r.ok && j?.ok) setTicketId(j.data.ticket_id || null);
      } catch { /* ignore */ }
      try {
        const rm = await fetch('/api/auth/me', { credentials: 'include' });
        if (!cancelled && rm.ok) {
          const jm = await rm.json();
          setMeEmail(jm?.data?.user?.email ?? null);
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [shouldRender]);

  const fetchThread = useCallback(async () => {
    if (!ticketId) return;
    try {
      const r = await fetch(`/api/support/tickets/${ticketId}`, { credentials: 'include' });
      const j = await r.json();
      if (!r.ok || !j?.ok) {
        // Server auto-clears a stale cookie; drop the state so the start-form re-appears.
        if (r.status === 403 || r.status === 404) setTicketId(null);
        return;
      }
      setTicket(j.data.ticket);
      setMessages(j.data.messages);
      setUnread(0);
    } catch { /* swallow */ }
  }, [ticketId]);

  // Unread poll (open ⇒ 2.5 s, closed ⇒ 20 s).
  useEffect(() => {
    if (!shouldRender || !ticketId) return;
    let alive = true;
    async function tick() {
      try {
        const r = await fetch(`/api/support/tickets/${ticketId}/unread`, { credentials: 'include' });
        const j = await r.json();
        if (alive && r.ok && j?.ok) setUnread(Number(j.data?.unread_by_user) || 0);
      } catch { /* ignore */ }
    }
    void tick();
    const iv = window.setInterval(tick, open ? 2500 : 20_000);
    return () => { alive = false; window.clearInterval(iv); };
  }, [shouldRender, ticketId, open]);

  useEffect(() => { if (open && ticketId) void fetchThread(); }, [open, ticketId, fetchThread]);
  useEffect(() => {
    if (!open || !ticketId) return;
    const iv = window.setInterval(() => { void fetchThread(); }, 3000);
    return () => window.clearInterval(iv);
  }, [open, ticketId, fetchThread]);
  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages.length, open]);

  // M19.3 — Canonical GA4 events emitted ONLY through the shared helper.
  // Aggregate signals only: no email, no ticket id, no body, no token.
  const openedAnalyticsOnce = useRef(false);
  useEffect(() => {
    if (!open || openedAnalyticsOnce.current) return;
    openedAnalyticsOnce.current = true;
    (async () => {
      try {
        const { trackGa4Event } = await import('@/lib/analytics/events');
        trackGa4Event('support_widget_opened');
      } catch { /* ignore */ }
    })();
  }, [open]);

  async function createTicket(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      const body = firstMsg.trim();
      const useEmail = (meEmail || email).trim();
      if (!useEmail || !body) throw new Error('Please enter your email and a message.');
      const r = await fetch('/api/support/tickets', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: useEmail, body, subject: null }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(typeof j?.error === 'string' ? j.error : 'Could not open support ticket');
      // The server has just set the HttpOnly guest cookie. The client only
      // needs to know the (non-sensitive) ticket id so it can hit the read/
      // write endpoints for THIS thread.
      setTicketId(j.data.ticket.id);
      setFirstMsg(''); setEmail('');
      setTicket(j.data.ticket); setMessages([j.data.message]);
      // M19.3 — canonical GA4 aggregate signal. No email/name/id/body sent.
      try {
        const { trackGa4Event } = await import('@/lib/analytics/events');
        trackGa4Event('support_conversation_started');
      } catch { /* ignore */ }
    } catch (e2) { setErr((e2 as Error).message); } finally { setBusy(false); }
  }

  async function sendReply(e: React.FormEvent) {
    e.preventDefault(); setErr(null); if (!ticketId) return; const body = reply.trim(); if (!body) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/support/tickets/${ticketId}/messages`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(typeof j?.error === 'string' ? j.error : 'Could not send message');
      setMessages((prev) => [...prev, j.data.message]);
      setReply('');
    } catch (e2) { setErr((e2 as Error).message); } finally { setBusy(false); }
  }

  async function startNew() {
    // Clear the guest cookie server-side and reset local UI.
    try { await fetch('/api/support/session', { method: 'DELETE', credentials: 'include' }); } catch { /* ignore */ }
    setTicketId(null); setTicket(null); setMessages([]); setErr(null);
  }

  if (!shouldRender) return null;

  return (
    <>
      <button
        type="button"
        aria-label={open ? 'Close support' : 'Open support'}
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-4 py-3 shadow-lg hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary/40"
        data-testid="support-launcher"
      >
        {open ? <X className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
        <span className="text-sm font-semibold">{open ? 'Close' : 'Help'}</span>
        {unread > 0 && !open && (
          <span className="ml-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-white/95 px-1.5 text-[11px] font-bold text-primary" data-testid="support-unread-badge">{unread}</span>
        )}
      </button>

      {open && (
        <div
          className="fixed bottom-20 right-4 z-40 w-[92vw] max-w-sm rounded-xl border border-border bg-background shadow-xl"
          role="dialog" aria-label="WaveLead Support" data-testid="support-panel"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <div className="text-sm font-semibold">WaveLead Support</div>
              <div className="text-[11px] text-muted-foreground">Usually replies within one business day.</div>
            </div>
            <button className="text-muted-foreground hover:text-foreground" onClick={() => setOpen(false)} aria-label="Close"><X className="h-4 w-4" /></button>
          </div>

          {!ticketId ? (
            <form onSubmit={createTicket} className="p-4 space-y-3" data-testid="support-start-form">
              {!meEmail && (
                <label className="block text-xs font-semibold">Your email
                  <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    placeholder="you@example.com" data-testid="support-email" />
                </label>
              )}
              {meEmail && <div className="text-[11px] text-muted-foreground">Signed in as <strong className="text-foreground">{meEmail}</strong></div>}
              <label className="block text-xs font-semibold">How can we help?
                <textarea required rows={4} value={firstMsg} onChange={(e) => setFirstMsg(e.target.value)}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  placeholder="Tell us what you need — as much or as little detail as you like." data-testid="support-first-message" />
              </label>
              {err && <div className="text-xs text-rose-600" data-testid="support-error">{err}</div>}
              <button type="submit" disabled={busy}
                className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-semibold disabled:opacity-60"
                data-testid="support-start-submit">
                {busy ? <><Loader2 className="h-4 w-4 animate-spin" />Sending…</> : <>Start chat</>}
              </button>
              <p className="text-[11px] text-muted-foreground">By opening a ticket you agree to our <a href="/privacy" className="underline">Privacy Policy</a>. Do not send passwords, full card numbers or one-time codes.</p>
            </form>
          ) : (
            <>
              <div ref={listRef} className="max-h-[50vh] min-h-[240px] overflow-y-auto px-4 py-3 space-y-3 bg-muted/30" data-testid="support-thread">
                {messages.length === 0 && <div className="text-xs text-muted-foreground">Loading conversation…</div>}
                {messages.map((m) => (
                  <div key={m.id} className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`} data-testid={`support-msg-${m.id}`}>
                    <div className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${m.sender === 'user' ? 'bg-primary text-primary-foreground' : 'bg-background border border-border'}`}>
                      <div className="mb-0.5 text-[10px] opacity-70">{m.sender === 'user' ? 'You' : (m.sender_display_name || 'WaveLead Support')} · {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                      <div>{m.body}</div>
                    </div>
                  </div>
                ))}
              </div>
              {ticket?.status === 'closed' ? (
                <div className="border-t border-border p-3 text-xs text-muted-foreground">This ticket is closed. <button className="underline" onClick={startNew}>Start a new one</button>.</div>
              ) : (
                <form onSubmit={sendReply} className="border-t border-border p-3" data-testid="support-reply-form">
                  {err && <div className="mb-2 text-xs text-rose-600" data-testid="support-error">{err}</div>}
                  <div className="flex gap-2">
                    <input value={reply} onChange={(e) => setReply(e.target.value)}
                      className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                      placeholder="Type a message…" data-testid="support-reply-input" />
                    <button type="submit" disabled={busy || !reply.trim()}
                      className="inline-flex items-center gap-1 rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-semibold disabled:opacity-60"
                      data-testid="support-reply-submit">
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </button>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">Ticket #{ticket?.id.slice(0, 8) || (ticketId || '').slice(0, 8)} · {ticket?.status || 'awaiting_admin'}</span>
                    <button type="button" onClick={startNew} className="text-[11px] text-muted-foreground underline">Start new</button>
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
