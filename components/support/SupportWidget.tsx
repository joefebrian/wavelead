'use client';
// M19.2 — Public support widget (bottom-right).
//
// UX contract:
//   • Launcher button at bottom-right (fixed). Clicking opens a compact panel.
//   • If the visitor has no active ticket in localStorage, they see a start
//     form (email + first message). Once created, the panel switches to the
//     chat thread view.
//   • Server replies land on the next poll (2s while panel is open). Messages
//     are plain text.
//   • No PII beyond what the visitor provides. No analytics ping from here.
//   • Never rendered on /admin routes (root layout branches).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { MessageCircle, X, Send, Loader2 } from 'lucide-react';

interface Message {
  id: string; sender: 'user' | 'admin'; sender_display_name: string | null;
  body: string; created_at: string;
}
interface TicketSummary { id: string; status: string; subject: string | null; requester_email: string; }

const STORAGE_KEY = 'wl_support_ticket_v1';
type Stored = { id: string; token: string; email: string; created_at: string };

function loadStored(): Stored | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Stored;
    return (p && p.id && p.token) ? p : null;
  } catch { return null; }
}
function saveStored(s: Stored | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (s) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch { /* private-mode ignore */ }
}

export default function SupportWidget() {
  const pathname = usePathname() || '';
  // Never render inside admin.
  const shouldRender = !pathname.startsWith('/admin');
  const [open, setOpen] = useState(false);
  const [stored, setStored] = useState<Stored | null>(null);
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

  useEffect(() => {
    if (!shouldRender) return;
    setStored(loadStored());
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => r.ok ? r.json() : null)
      .then((j) => setMeEmail(j?.data?.user?.email ?? null))
      .catch(() => setMeEmail(null));
  }, [shouldRender]);

  const authQS = useMemo(() => (stored?.token ? `?token=${encodeURIComponent(stored.token)}` : ''), [stored?.token]);

  const fetchThread = useCallback(async () => {
    if (!stored?.id) return;
    try {
      const r = await fetch(`/api/support/tickets/${stored.id}${authQS}`, { credentials: 'include' });
      const j = await r.json();
      if (!r.ok || !j?.ok) { if (r.status === 404 || r.status === 403) { saveStored(null); setStored(null); } return; }
      setTicket(j.data.ticket);
      setMessages(j.data.messages);
      // Update unread indicator from server response.
      setUnread(0);
    } catch { /* swallow */ }
  }, [stored?.id, authQS]);

  // Lightweight unread poll when panel closed but ticket exists.
  useEffect(() => {
    if (!shouldRender || !stored?.id) return;
    let alive = true;
    async function tick() {
      try {
        const r = await fetch(`/api/support/tickets/${stored!.id}/unread${authQS}`, { credentials: 'include' });
        const j = await r.json();
        if (alive && r.ok && j?.ok) setUnread(Number(j.data?.unread_by_user) || 0);
      } catch { /* ignore */ }
    }
    void tick();
    const iv = window.setInterval(tick, open ? 2500 : 20_000);
    return () => { alive = false; window.clearInterval(iv); };
  }, [shouldRender, stored?.id, authQS, open]);

  // Load thread when panel opens.
  useEffect(() => { if (open && stored?.id) void fetchThread(); }, [open, stored?.id, fetchThread]);
  // Poll for new admin replies while panel open.
  useEffect(() => {
    if (!open || !stored?.id) return;
    const iv = window.setInterval(() => { void fetchThread(); }, 3000);
    return () => window.clearInterval(iv);
  }, [open, stored?.id, fetchThread]);
  // Scroll thread to bottom on new messages.
  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages.length, open]);

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
      const s: Stored = { id: j.data.ticket.id, token: j.data.access_token, email: useEmail, created_at: j.data.ticket.created_at };
      saveStored(s); setStored(s); setFirstMsg(''); setEmail('');
      setTicket(j.data.ticket); setMessages([j.data.message]);
    } catch (e2) { setErr((e2 as Error).message); } finally { setBusy(false); }
  }

  async function sendReply(e: React.FormEvent) {
    e.preventDefault(); setErr(null); if (!stored?.id) return; const body = reply.trim(); if (!body) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/support/tickets/${stored.id}/messages${authQS}`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(typeof j?.error === 'string' ? j.error : 'Could not send message');
      setMessages((prev) => [...prev, j.data.message]);
      setReply('');
    } catch (e2) { setErr((e2 as Error).message); } finally { setBusy(false); }
  }

  function startNew() { saveStored(null); setStored(null); setTicket(null); setMessages([]); setErr(null); }

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

          {!stored?.id ? (
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
                    <span className="text-[11px] text-muted-foreground">Ticket #{ticket?.id.slice(0, 8) || stored.id.slice(0, 8)} · {ticket?.status || 'awaiting_admin'}</span>
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
