'use client';
// M11-Batch2A — Owner submission form for follower-count evidence.
// One active pending per channel. Replacing a pending submission
// supersedes it server-side.
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Upload, Loader2, X, CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { useUploadThing } from '@/lib/uploadthing';

export interface EvidenceAttachmentClient {
  provider: 'uploadthing';
  storage_key: string;
  url: string;
  mime_type: 'image/jpeg' | 'image/png' | 'image/webp';
  file_name_safe: string;
  size_bytes: number;
  uploaded_at: string;
}

interface HistoryRow {
  id: string;
  followers: number;
  status: 'pending' | 'verified' | 'rejected' | 'superseded';
  reported_at: string;
  evidence_date: string | null;
  verified_at: string | null;
  rejection_reason: string | null;
  evidence_attachment: EvidenceAttachmentClient;
}

const STATUS_TONE: Record<HistoryRow['status'], string> = {
  pending: 'bg-amber-100 text-amber-800',
  verified: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-rose-100 text-rose-800',
  superseded: 'bg-muted text-muted-foreground',
};

const REJECTION_LABELS: Record<string, string> = {
  illegible: 'Screenshot was too blurry / cropped',
  watermark_missing: 'Missing WhatsApp UI watermark',
  suspected_edit: 'Image looks edited',
  wrong_channel: 'Screenshot is from a different channel',
  stale_evidence: 'Screenshot is too old',
  inconsistent_count: 'Follower count did not match the screenshot',
  insufficient_evidence: 'Not enough evidence to verify',
  other: 'Other',
};

export default function FollowerEvidenceCard({
  channelId,
  initialHistory,
}: {
  channelId: string;
  initialHistory: HistoryRow[];
}) {
  const [history, setHistory] = useState<HistoryRow[]>(initialHistory);
  const [followers, setFollowers] = useState<string>('');
  const [evidenceDate, setEvidenceDate] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [attachment, setAttachment] = useState<EvidenceAttachmentClient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const latestVerified = history.find((h) => h.status === 'verified');
  const activePending = history.find((h) => h.status === 'pending');

  const { startUpload, isUploading } = useUploadThing('channelFollowerEvidence', {
    onClientUploadComplete: (results) => {
      const r = (results || [])[0];
      const sd = (r as unknown as { serverData?: EvidenceAttachmentClient })?.serverData;
      if (sd && sd.storage_key && sd.url) setAttachment({ ...sd });
      setError(null);
    },
    onUploadError: (e) => setError(e?.message || 'Upload failed'),
  });

  function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const f = (e.target.files || [])[0];
    e.target.value = '';
    if (!f) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) { setError('Only JPEG, PNG, or WebP allowed'); return; }
    if (f.size > 5 * 1024 * 1024) { setError('Image must be ≤ 5 MB'); return; }
    startUpload([f], { channelId }).catch((err) => setError((err as Error).message));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setOkMsg(null);
    const parsed = parseInt(followers.replace(/[^0-9]/g, ''), 10);
    if (!Number.isFinite(parsed) || parsed < 0) { setError('Enter a valid follower count'); return; }
    if (!attachment) { setError('Upload a screenshot first'); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/owner/channels/${channelId}/audience-snapshots`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          followers: parsed,
          evidence_attachment: attachment,
          evidence_date: evidenceDate ? new Date(evidenceDate).toISOString() : null,
          submission_note: note.trim() || null,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { snapshot?: HistoryRow; error?: { message?: string } };
      if (!res.ok) throw new Error(body?.error?.message || 'Submission failed');
      // Reload history
      const listRes = await fetch(`/api/owner/channels/${channelId}/audience-snapshots`, { credentials: 'include' });
      const listBody = (await listRes.json().catch(() => ({}))) as { items?: HistoryRow[] };
      setHistory(listBody.items || (body.snapshot ? [body.snapshot] : []));
      setFollowers(''); setEvidenceDate(''); setNote(''); setAttachment(null);
      setOkMsg(activePending ? 'Your prior submission has been replaced. Admin will review the new one.' : 'Submitted — admin will review shortly.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="wh-card p-5" data-testid="follower-evidence-card">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">Follower Evidence</h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Submit a fresh WhatsApp screenshot showing your current follower count. Once admin verifies it, your public
        profile will display the verified count with the freshness date.
      </p>

      {latestVerified && (
        <div className="mt-3 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900" data-testid="latest-verified-banner">
          <div className="flex items-center gap-1.5 font-semibold"><CheckCircle2 className="h-4 w-4" /> Last verified: {Number(latestVerified.followers).toLocaleString()} followers</div>
          <div className="mt-0.5 text-xs">Verified {latestVerified.verified_at ? new Date(latestVerified.verified_at).toLocaleDateString() : ''}</div>
        </div>
      )}

      {activePending && (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" data-testid="active-pending-banner">
          <div className="flex items-center gap-1.5 font-semibold"><Info className="h-4 w-4" /> A submission is waiting for admin review</div>
          <div className="mt-0.5 text-xs">Submitted {new Date(activePending.reported_at).toLocaleString()}. You can replace it below — the current pending one will be superseded.</div>
        </div>
      )}

      <form onSubmit={onSubmit} className="mt-4 grid gap-3" data-testid="follower-evidence-form">
        <label className="block">
          <div className="text-sm font-medium">Current Followers</div>
          <input
            data-testid="followers-input"
            type="text" inputMode="numeric" value={followers}
            onChange={(e) => setFollowers(e.target.value)}
            placeholder="e.g. 24500"
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            required
          />
        </label>

        <label className="block">
          <div className="text-sm font-medium">Screenshot Evidence</div>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <label className={`inline-flex items-center gap-2 rounded-md border border-border bg-secondary/50 px-3 py-1.5 text-sm font-medium cursor-pointer hover:bg-secondary ${(isUploading || !!attachment) ? 'opacity-50 pointer-events-none' : ''}`}>
              {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {isUploading ? 'Uploading…' : attachment ? 'Uploaded' : 'Upload Screenshot'}
              <input data-testid="screenshot-input" type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={pickFile} disabled={isUploading || !!attachment} />
            </label>
            {attachment && (
              <span className="inline-flex items-center gap-2 text-xs">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={attachment.url} alt={attachment.file_name_safe} className="h-14 w-14 object-cover rounded border border-border" />
                <button type="button" onClick={() => setAttachment(null)} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /> Replace</button>
              </span>
            )}
            <span className="text-xs text-muted-foreground">JPEG/PNG/WebP — ≤ 5 MB</span>
          </div>
        </label>

        <label className="block">
          <div className="text-sm font-medium">Evidence Date <span className="text-muted-foreground font-normal">(optional)</span></div>
          <input
            data-testid="evidence-date-input"
            type="date" value={evidenceDate}
            onChange={(e) => setEvidenceDate(e.target.value)}
            className="mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <div className="mt-1 text-xs text-muted-foreground">If your screenshot was taken on a specific day, note it here. Otherwise submission date is used.</div>
        </label>

        <label className="block">
          <div className="text-sm font-medium">Note to reviewer <span className="text-muted-foreground font-normal">(optional)</span></div>
          <textarea
            data-testid="submission-note-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2} maxLength={500}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </label>

        {error && <div className="inline-flex items-center gap-1 text-sm text-rose-600" data-testid="form-error"><AlertTriangle className="h-4 w-4" /> {error}</div>}
        {okMsg && <div className="inline-flex items-center gap-1 text-sm text-emerald-700" data-testid="form-ok"><CheckCircle2 className="h-4 w-4" /> {okMsg}</div>}

        <div>
          <Button type="submit" disabled={submitting || isUploading || !attachment} data-testid="submit-evidence-btn">
            {submitting ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" />Submitting…</> : (activePending ? 'Replace Submission' : 'Submit for Verification')}
          </Button>
        </div>
      </form>

      {history.length > 0 && (
        <div className="mt-6">
          <div className="text-sm font-semibold">Submission history</div>
          <ul className="mt-2 space-y-2" data-testid="history-list">
            {history.map((h) => (
              <li key={h.id} className="flex items-start gap-3 rounded-md border border-border p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={h.evidence_attachment?.url} alt="evidence" className="h-12 w-12 object-cover rounded border border-border shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{Number(h.followers).toLocaleString()} followers</span>
                    <span className={`inline-block text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${STATUS_TONE[h.status]}`}>{h.status}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">Submitted {new Date(h.reported_at).toLocaleString()}{h.evidence_date ? ` · evidence dated ${new Date(h.evidence_date).toLocaleDateString()}` : ''}</div>
                  {h.status === 'rejected' && h.rejection_reason && (
                    <div className="mt-1 text-xs text-rose-700">Rejected: {REJECTION_LABELS[h.rejection_reason] || h.rejection_reason}</div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
