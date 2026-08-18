'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

export default function CampaignActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function act(path: string) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/owner/promotions/${id}/${path}`, { method: 'POST' }).then((r) => r.json());
      if (!r.ok) alert(r.error || 'Action failed');
      router.refresh();
    } finally { setBusy(false); }
  }
  return (
    <div className="flex gap-2">
      {status === 'active' && <Button variant="outline" onClick={() => act('pause')} disabled={busy}>Pause</Button>}
      {status === 'paused' && <Button variant="outline" onClick={() => act('resume')} disabled={busy}>Resume</Button>}
      {['draft', 'pending_review', 'scheduled', 'paused', 'rejected'].includes(status) && (
        <Button variant="destructive" onClick={() => { if (confirm('Cancel this campaign?')) act('cancel'); }} disabled={busy}>Cancel</Button>
      )}
    </div>
  );
}
