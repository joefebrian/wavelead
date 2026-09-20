'use client';
// M18 — Creator's own campaign applications (separate from Incoming Requests
// and from Active Sponsorships, by design).
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { PageHeader, EmptyState, StatusBadge, DataTable, type Tone } from '@/components/appkit';
import { ClipboardList } from 'lucide-react';

interface App {
  id: string; campaign_id: string; status: string; pitch: string;
  proposed_rate_usd_minor: number | null; created_at: string; marketplace_order_id: string | null;
}

const TONE: Record<string, Tone> = { applied: 'neutral', shortlisted: 'info', approved: 'success', rejected: 'danger', withdrawn: 'neutral' };

export default function ApplicationsClient() {
  const [rows, setRows] = useState<App[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch('/api/campaign-applications', { credentials: 'include' });
    const j = await r.json();
    setRows(j?.data?.applications || []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function withdraw(id: string) {
    setBusy(id);
    await fetch(`/api/campaign-applications/${id}/withdraw`, { method: 'POST', credentials: 'include' }).catch(() => null);
    await load();
    setBusy(null);
  }

  return (
    <>
      <PageHeader title="Campaign Applications" description="Applications you sent to brand campaigns. Brands review these directly." />
      {rows === null ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyState icon={<ClipboardList className="h-6 w-6" />} title="No applications yet" description="Browse Campaign Opportunities to apply with one of your approved channels." />
      ) : (
        <DataTable head={['Applied', 'Pitch', 'Proposed rate', 'Status', '']} testId="my-applications-table">
          {rows.map((a) => (
            <tr key={a.id} className="align-top hover:bg-muted/40">
              <td className="px-3 py-2.5 text-xs text-muted-foreground">{new Date(a.created_at).toLocaleDateString()}</td>
              <td className="px-3 py-2.5"><p className="max-w-md text-xs text-muted-foreground">{a.pitch}</p></td>
              <td className="px-3 py-2.5 tabular-nums">{a.proposed_rate_usd_minor === null ? '—' : `$${(a.proposed_rate_usd_minor / 100).toFixed(2)}`}</td>
              <td className="px-3 py-2.5"><StatusBadge tone={TONE[a.status] || 'neutral'}>{a.status}</StatusBadge></td>
              <td className="px-3 py-2.5 text-right">
                {['applied', 'shortlisted'].includes(a.status) && !a.marketplace_order_id && (
                  <Button size="sm" variant="ghost" onClick={() => withdraw(a.id)} disabled={busy === a.id}>Withdraw</Button>
                )}
              </td>
            </tr>
          ))}
        </DataTable>
      )}
    </>
  );
}
