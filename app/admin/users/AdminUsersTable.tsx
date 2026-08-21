'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Copy, KeyRound, ShieldBan, ShieldCheck, Loader2, AlertTriangle } from 'lucide-react';
import type { PublicUser } from '@/lib/types';

interface Props { initialQuery: string; initialItems: PublicUser[]; }

export default function AdminUsersTable({ initialQuery, initialItems }: Props) {
  const router = useRouter();
  const [q, setQ] = useState(initialQuery);
  const [items, setItems] = useState<PublicUser[]>(initialItems);
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tempResult, setTempResult] = useState<{ userId: string; email: string; temp: string } | null>(null);

  async function search() {
    startTransition(async () => {
      const url = new URL('/api/admin/users', window.location.origin);
      if (q) url.searchParams.set('q', q);
      const r = await fetch(url.toString(), { credentials: 'include' });
      const j = await r.json();
      if (r.ok && j.ok) setItems(j.data.items);
    });
  }

  async function resetPassword(u: PublicUser) {
    if (!confirm(`Generate a temporary password for ${u.email}?\nThe user's active sessions will be invalidated and they will be forced to change their password on next login.`)) return;
    setBusyId(u.id);
    try {
      const r = await fetch(`/api/admin/users/${u.id}/reset-password`, { method: 'POST', credentials: 'include' });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Failed');
      setTempResult({ userId: u.id, email: u.email, temp: j.data.temporary_password });
      router.refresh();
    } catch (e) { alert((e as Error).message); }
    finally { setBusyId(null); }
  }

  async function toggleDisabled(u: PublicUser & { is_disabled?: boolean }) {
    const disabled = !u.is_disabled;
    if (!confirm(`${disabled ? 'Disable' : 'Enable'} account ${u.email}?`)) return;
    setBusyId(u.id);
    try {
      const r = await fetch(`/api/admin/users/${u.id}/disable`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ disabled }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Failed');
      await search();
    } catch (e) { alert((e as Error).message); }
    finally { setBusyId(null); }
  }

  async function forceChange(u: PublicUser) {
    if (!confirm(`Force ${u.email} to change password on next login?`)) return;
    setBusyId(u.id);
    try {
      const r = await fetch(`/api/admin/users/${u.id}/force-change`, { method: 'POST', credentials: 'include' });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Failed');
      await search();
    } catch (e) { alert((e as Error).message); }
    finally { setBusyId(null); }
  }

  return (
    <div className="mt-6 space-y-4">
      <div className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by email or display name" className="block w-full max-w-md rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } }} />
        <Button onClick={search} disabled={pending}>Search</Button>
      </div>

      {tempResult && (
        <div className="wh-card p-4 border-amber-300 bg-amber-50/40">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
            <div className="flex-1">
              <div className="font-semibold">Temporary password generated for {tempResult.email}</div>
              <div className="mt-1 text-sm text-muted-foreground">Share this with the user via a trusted channel. It will not be shown again. The user must change it on next login.</div>
              <div className="mt-2 flex items-center gap-2">
                <code className="rounded bg-background border border-border px-2 py-1 text-sm font-mono">{tempResult.temp}</code>
                <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(tempResult.temp); }}><Copy className="h-3.5 w-3.5 mr-1" /> Copy</Button>
                <Button size="sm" variant="ghost" onClick={() => setTempResult(null)}>Dismiss</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="wh-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr><th className="px-3 py-2">Email</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">Role</th><th className="px-3 py-2">Status</th><th className="px-3 py-2"></th></tr>
          </thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={5} className="px-3 py-10 text-center text-muted-foreground">No matching users.</td></tr>}
            {items.map((u) => {
              const anyU = u as PublicUser & { is_disabled?: boolean; must_change_password?: boolean };
              return (
                <tr key={u.id} className="border-t border-border/60 align-top">
                  <td className="px-3 py-2 whitespace-nowrap">{u.email}</td>
                  <td className="px-3 py-2">{u.display_name || <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-3 py-2"><span className="font-mono text-xs">{u.role}</span></td>
                  <td className="px-3 py-2 space-x-1">
                    {anyU.is_disabled ? <Badge className="bg-rose-100 text-rose-800">disabled</Badge> : <Badge className="bg-emerald-100 text-emerald-800">active</Badge>}
                    {anyU.must_change_password && <Badge className="bg-amber-100 text-amber-800">must change pwd</Badge>}
                  </td>
                  <td className="px-3 py-2 text-right space-x-1">
                    <Button size="sm" variant="outline" disabled={busyId === u.id} onClick={() => resetPassword(u)}>
                      {busyId === u.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><KeyRound className="h-3.5 w-3.5 mr-1" /> Reset</>}
                    </Button>
                    <Button size="sm" variant="outline" disabled={busyId === u.id} onClick={() => forceChange(u)}>Force change</Button>
                    <Button size="sm" variant={anyU.is_disabled ? 'default' : 'outline'} disabled={busyId === u.id} onClick={() => toggleDisabled(anyU)}>
                      {anyU.is_disabled ? <><ShieldCheck className="h-3.5 w-3.5 mr-1" /> Enable</> : <><ShieldBan className="h-3.5 w-3.5 mr-1" /> Disable</>}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
