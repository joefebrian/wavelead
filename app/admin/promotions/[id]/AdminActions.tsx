'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

const REASONS = [
  { id: 'invalid_targeting', label: 'Invalid Targeting' },
  { id: 'invalid_budget', label: 'Invalid Budget' },
  { id: 'channel_not_eligible', label: 'Channel Not Eligible' },
  { id: 'placement_unavailable', label: 'Placement Unavailable' },
  { id: 'policy_concern', label: 'Policy Concern' },
  { id: 'duplicate_or_test', label: 'Duplicate / Test Campaign' },
  { id: 'other', label: 'Other' },
];

export default function AdminActions({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState(REASONS[0].id);
  const [notes, setNotes] = useState('');

  async function approve() {
    setBusy(true);
    const r = await fetch(`/api/admin/promotions/${id}/approve`, { method: 'POST' }).then((r) => r.json());
    setBusy(false);
    if (!r.ok) alert(r.error || 'Approve failed');
    else router.refresh();
  }
  async function reject() {
    setBusy(true);
    const r = await fetch(`/api/admin/promotions/${id}/reject`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason, notes: notes || undefined }),
    }).then((r) => r.json());
    setBusy(false);
    if (!r.ok) alert(r.error || 'Reject failed');
    else { setRejectOpen(false); router.refresh(); }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        <Button onClick={approve} disabled={busy}>Approve</Button>
        <Button variant="destructive" onClick={() => setRejectOpen((v) => !v)} disabled={busy}>Reject</Button>
      </div>
      {rejectOpen && (
        <div className="wh-card p-3 w-72 space-y-2">
          <div className="text-xs font-medium">Rejection reason</div>
          <select value={reason} onChange={(e) => setReason(e.target.value)} className="w-full text-sm rounded border px-2 py-1 bg-background">
            {REASONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes..." className="w-full text-sm rounded border px-2 py-1 bg-background" maxLength={500} rows={3} />
          <Button onClick={reject} disabled={busy} variant="destructive" className="w-full">Confirm reject</Button>
        </div>
      )}
    </div>
  );
}
