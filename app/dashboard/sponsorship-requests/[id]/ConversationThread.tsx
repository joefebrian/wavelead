'use client';

// M16 — Brand ↔ channel-owner conversation thread on a sponsorship request.
// Deliberately simple: append-only, plain text, no realtime. A refresh (or
// the local optimistic append below) is enough.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Loader2, Send, AlertTriangle, MessagesSquare } from 'lucide-react';
import type { SponsorshipRequestMessage } from '@/lib/types';

interface Props {
  leadId: string;
  viewer: 'owner' | 'requester' | 'admin';
  canPost: boolean;
  initialMessages: SponsorshipRequestMessage[];
}

export default function ConversationThread({ leadId, viewer, canPost, initialMessages }: Props) {
  const router = useRouter();
  const [messages, setMessages] = useState<SponsorshipRequestMessage[]>(initialMessages || []);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function send() {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/me/sponsorship-requests/${leadId}/messages`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: body }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) { setError(j?.error || 'Could not send message'); return; }
      const msg = j.data?.message as SponsorshipRequestMessage | undefined;
      if (msg) setMessages((prev) => [...prev, msg]);
      setDraft('');
      startTransition(() => router.refresh());
    } catch { setError('Network error. Please try again.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="mt-6 wh-card p-5" data-testid="sponsorship-conversation">
      <div className="flex items-center gap-2">
        <MessagesSquare className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">Conversation</h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Use this conversation to clarify the brief, deliverables, timeline or commercial details. Payments and confirmed sponsorships remain protected through WaveLead.
      </p>

      <ul className="mt-4 space-y-3" data-testid="conversation-messages">
        {messages.length === 0 && (
          <li className="text-sm text-muted-foreground py-4 text-center" data-testid="conversation-empty">
            No messages yet.{canPost ? ' Start the conversation below.' : ''}
          </li>
        )}
        {messages.map((m) => {
          const mine = (viewer === 'owner' && m.sender_side === 'owner') || (viewer === 'requester' && m.sender_side === 'brand');
          return (
            <li key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`} data-testid={`conversation-message-${m.id}`}>
              <div className={`max-w-[85%] rounded-lg border px-3 py-2 ${mine ? 'border-primary/30 bg-primary/5' : 'border-border bg-secondary/40'}`}>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {m.sender_display_name} · {m.sender_side === 'owner' ? 'Channel owner' : 'Brand'}
                </div>
                <div className="mt-1 text-sm whitespace-pre-wrap break-words">{m.message}</div>
                <div className="mt-1 text-[11px] text-muted-foreground">{new Date(m.created_at).toLocaleString()}</div>
              </div>
            </li>
          );
        })}
      </ul>

      {canPost ? (
        <div className="mt-4 border-t border-border/60 pt-4">
          {error && (
            <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
            </div>
          )}
          <textarea
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={2000}
            placeholder="Write a message..."
            data-testid="conversation-input"
            className="block w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-[11px] text-muted-foreground">Plain text only. Share files via the Materials Google Drive link on the request.</span>
            <Button size="sm" onClick={send} disabled={busy || !draft.trim()} data-testid="conversation-send-btn" className="gap-1.5">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send Message
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 border-t border-border/60 pt-3 text-xs text-muted-foreground" data-testid="conversation-readonly">
          Read-only oversight view. WaveLead moderators can review this conversation for support, disputes and abuse handling but do not participate.
        </div>
      )}
    </div>
  );
}
