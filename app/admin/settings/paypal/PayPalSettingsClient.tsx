'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, CheckCircle2, Loader2, ShieldAlert, RefreshCw } from 'lucide-react';

interface EnvStatus {
  environment: 'sandbox' | 'live';
  configured: boolean;
  client_id_masked: string | null;
  client_secret_configured: boolean;
  webhook_id_masked: string | null;
  webhook_id_configured: boolean;
  source: 'admin_vault' | 'env' | 'none';
  last_connection_test_at: string | Date | null;
  last_connection_test_status: 'success' | 'failure' | null;
  last_connection_test_message: string | null;
}
interface Status {
  vault_key_configured: boolean;
  node_env: string;
  sandbox_api_host: string;
  live_api_host: string;
  active_environment: 'sandbox' | 'live' | null;
  active_source: 'admin_vault' | 'env' | null;
  webhook_url: string;
  sandbox: EnvStatus;
  live: EnvStatus;
}

export default function PayPalSettingsClient({ initialStatus }: { initialStatus: Status }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>(initialStatus);
  const [tab, setTab] = useState<'sandbox' | 'live'>('sandbox');
  const [form, setForm] = useState({ client_id: '', client_secret: '', webhook_id: '', confirm_live: '' });
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState<null | { ok: boolean; msg: string }>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const isPreview = status.node_env !== 'production';
  const activeEnv = status.sandbox && tab === 'sandbox' ? status.sandbox : status.live;
  const isLiveTab = tab === 'live';
  const isLiveBlocked = isPreview && isLiveTab;

  async function refresh() {
    const r = await fetch('/api/admin/settings/paypal', { credentials: 'include' });
    const j = await r.json();
    if (r.ok && j.ok) setStatus(j.data);
  }

  async function save() {
    setBusy(true); setError(null); setSaved(false);
    try {
      const r = await fetch('/api/admin/settings/paypal', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({
          environment: tab,
          client_id: form.client_id,
          ...(form.client_secret ? { client_secret: form.client_secret } : {}),
          webhook_id: form.webhook_id || null,
          ...(isLiveTab ? { confirm_live: form.confirm_live } : {}),
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Failed to save');
      setSaved(true);
      setForm({ ...form, client_secret: '', confirm_live: '' });
      await refresh(); router.refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function testConnection() {
    setBusy(true); setTestResult(null); setError(null);
    try {
      const r = await fetch('/api/admin/settings/paypal/test-connection', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ environment: tab, ...(form.client_id ? { client_id: form.client_id } : {}), ...(form.client_secret ? { client_secret: form.client_secret } : {}) }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Failed');
      setTestResult({ ok: !!j.data.ok, msg: j.data.ok ? 'Connection successful' : (j.data.error || 'Failed') });
      await refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function importEnv() {
    if (!confirm('Import current environment PayPal configuration into the encrypted vault?')) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch('/api/admin/settings/paypal/import-env', { method: 'POST', credentials: 'include' });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Failed');
      await refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="mt-6 space-y-6">
      {!status.vault_key_configured && (
        <div className="wh-card p-4 border-rose-300 bg-rose-50/40">
          <div className="flex items-start gap-2"><ShieldAlert className="h-5 w-5 text-rose-600 mt-0.5" /><div>
            <div className="font-semibold">INTEGRATION_SECRETS_KEY not configured</div>
            <div className="text-sm text-muted-foreground">The encryption master key is missing. Vault operations are disabled until the environment key is set on the server.</div>
          </div></div>
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-4">
        <InfoCard label="Active environment" value={status.active_environment ? status.active_environment.toUpperCase() : 'NONE'} accent={status.active_environment === 'live' ? 'rose' : status.active_environment === 'sandbox' ? 'sky' : 'muted'} />
        <InfoCard label="Credential source" value={status.active_source ? status.active_source.replace('_', ' ') : 'none'} accent="muted" />
        <InfoCard label="Node environment" value={status.node_env} accent={isPreview ? 'amber' : 'emerald'} hint={isPreview ? 'Live mode DISABLED in preview' : 'Production'} />
      </div>

      <div className="wh-card p-5">
        <div className="flex gap-2 border-b border-border pb-3">
          <TabButton active={tab === 'sandbox'} onClick={() => setTab('sandbox')}>Sandbox</TabButton>
          <TabButton active={tab === 'live'} onClick={() => setTab('live')}>Live <span className="ml-1 text-xs text-rose-600">(REAL MONEY)</span></TabButton>
        </div>

        <div className="mt-4 grid md:grid-cols-2 gap-4 text-sm">
          <ReadOnly label="Status" value={activeEnv.configured ? <Badge className="bg-emerald-100 text-emerald-800">Configured</Badge> : <Badge className="bg-slate-100 text-slate-700">Not configured</Badge>} />
          <ReadOnly label="Source" value={activeEnv.source} />
          <ReadOnly label="Client ID" value={activeEnv.client_id_masked || <span className="text-muted-foreground">—</span>} />
          <ReadOnly label="Client Secret" value={activeEnv.client_secret_configured ? '•••• •••• Configured' : <span className="text-muted-foreground">not set</span>} />
          <ReadOnly label="Webhook ID" value={activeEnv.webhook_id_masked || <span className="text-muted-foreground">—</span>} />
          <ReadOnly label="API host" value={tab === 'live' ? status.live_api_host : status.sandbox_api_host} />
          <ReadOnly label="Last connection test" value={activeEnv.last_connection_test_at ? new Date(activeEnv.last_connection_test_at).toLocaleString() : <span className="text-muted-foreground">never</span>} />
          <ReadOnly label="Test status" value={activeEnv.last_connection_test_status || <span className="text-muted-foreground">—</span>} />
        </div>

        <div className="mt-6 border-t border-border pt-4 grid md:grid-cols-2 gap-4">
          <Field label="Client ID"><input type="text" placeholder={activeEnv.client_id_masked || 'AZ…'} value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })} className={inputCls} /></Field>
          <Field label={activeEnv.client_secret_configured ? 'Replace Client Secret (leave blank to keep)' : 'Client Secret'}><input type="password" placeholder={activeEnv.client_secret_configured ? '•••• Configured' : ''} value={form.client_secret} onChange={(e) => setForm({ ...form, client_secret: e.target.value })} className={inputCls} autoComplete="new-password" /></Field>
          <Field label="Webhook ID (optional; required for LIVE)"><input type="text" placeholder={activeEnv.webhook_id_masked || ''} value={form.webhook_id} onChange={(e) => setForm({ ...form, webhook_id: e.target.value })} className={inputCls} /></Field>
          <Field label="Webhook callback URL (auto-derived)"><input type="text" readOnly value={status.webhook_url} className={inputCls + ' bg-muted/40'} /></Field>

          {isLiveTab && (
            <div className="md:col-span-2 wh-card p-3 border-rose-300 bg-rose-50/40">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-5 w-5 text-rose-600 mt-0.5" />
                <div className="flex-1">
                  <div className="font-semibold text-rose-800">Enable PayPal Live Payments</div>
                  <div className="text-sm text-muted-foreground">This will enable REAL MONEY transactions. Type <span className="font-mono">ENABLE LIVE PAYMENTS</span> to confirm.</div>
                  <input value={form.confirm_live} onChange={(e) => setForm({ ...form, confirm_live: e.target.value })} placeholder="ENABLE LIVE PAYMENTS" className={inputCls + ' mt-2'} disabled={isLiveBlocked} />
                  {isLiveBlocked && <div className="mt-1 text-xs text-rose-700">Live mode is disabled outside production.</div>}
                </div>
              </div>
            </div>
          )}
        </div>

        {error && <div className="mt-4 text-sm text-rose-600">{error}</div>}
        {saved && <div className="mt-4 text-sm text-emerald-600 inline-flex items-center gap-1"><CheckCircle2 className="h-4 w-4" /> Saved</div>}
        {testResult && (
          <div className={`mt-4 text-sm inline-flex items-center gap-1 ${testResult.ok ? 'text-emerald-600' : 'text-rose-600'}`}>
            {testResult.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />} {testResult.msg}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={save} disabled={busy || isLiveBlocked || !form.client_id.trim() || !status.vault_key_configured}>{busy ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Saving…</> : `Save ${tab}`}</Button>
          <Button variant="outline" onClick={testConnection} disabled={busy}>Test connection</Button>
          <Button variant="outline" onClick={importEnv} disabled={busy}><RefreshCw className="h-3.5 w-3.5 mr-1" /> Import current .env</Button>
        </div>
      </div>
    </div>
  );
}

const inputCls = 'block w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40';
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="block text-sm font-medium mb-1">{label}</span>{children}</label>;
}
function ReadOnly({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><div className="text-xs uppercase text-muted-foreground tracking-wide">{label}</div><div className="mt-1 text-sm">{value}</div></div>;
}
function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className={`rounded-md px-3 py-1.5 text-sm font-medium ${active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-secondary'}`}>{children}</button>;
}
function InfoCard({ label, value, accent, hint }: { label: string; value: string; accent: 'sky' | 'primary' | 'rose' | 'amber' | 'emerald' | 'muted'; hint?: string }) {
  const map: Record<string, string> = { sky: 'text-sky-700', primary: 'text-primary', rose: 'text-rose-700', amber: 'text-amber-700', emerald: 'text-emerald-700', muted: 'text-muted-foreground' };
  return <div className="wh-card p-4"><div className="text-xs uppercase text-muted-foreground tracking-wide">{label}</div><div className={`mt-1 text-lg font-semibold ${map[accent]}`}>{value}</div>{hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}</div>;
}
