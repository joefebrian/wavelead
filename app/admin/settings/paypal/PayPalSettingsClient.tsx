'use client';
import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, CheckCircle2, Loader2, ShieldAlert, RefreshCw, Power, RotateCcw } from 'lucide-react';

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
  // M07 activation patch — DB-persisted state.
  persisted_active_environment?: 'sandbox' | 'live';
  persisted_source?: 'db' | 'env' | 'default';
  active_environment: 'sandbox' | 'live' | null;
  active_source: 'admin_vault' | 'env' | null;
  real_money_enabled?: boolean;
  canonical_origin?: string;
  webhook_url: string;
  sandbox: EnvStatus;
  live: EnvStatus;
}

const CONFIRM_ENABLE_LIVE = 'ENABLE LIVE PAYMENTS';
const CONFIRM_SWITCH_SANDBOX = 'SWITCH TO SANDBOX';

export default function PayPalSettingsClient({ initialStatus }: { initialStatus: Status }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>(initialStatus);
  const [tab, setTab] = useState<'sandbox' | 'live'>('sandbox');
  const [form, setForm] = useState({ client_id: '', client_secret: '', webhook_id: '', confirm_live: '' });
  const [activateInput, setActivateInput] = useState('');
  const [sandboxInput, setSandboxInput] = useState('');
  const [busy, setBusy] = useState<null | 'save' | 'test' | 'import' | 'activate' | 'rollback'>(null);
  const [testResult, setTestResult] = useState<null | { ok: boolean; msg: string }>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [activationMsg, setActivationMsg] = useState<null | { ok: boolean; msg: string }>(null);

  const isPreview = status.node_env !== 'production';
  const isLiveActive = status.active_environment === 'live' && status.real_money_enabled === true;
  const activeEnv = tab === 'sandbox' ? status.sandbox : status.live;
  const isLiveTab = tab === 'live';
  const isLiveBlocked = isPreview && isLiveTab;

  const refresh = useCallback(async () => {
    const r = await fetch('/api/admin/settings/paypal', { credentials: 'include' });
    const j = await r.json();
    if (r.ok && j.ok) setStatus(j.data);
    return j?.data as Status | undefined;
  }, []);

  async function save() {
    setBusy('save'); setError(null); setSaved(false);
    try {
      const r = await fetch('/api/admin/settings/paypal', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({
          environment: tab,
          client_id: form.client_id,
          ...(form.client_secret ? { client_secret: form.client_secret } : {}),
          webhook_id: form.webhook_id || null,
          // confirm_live is still required by the credential-save endpoint on the FIRST-TIME
          // save of Live vault (when no ciphertext exists yet). It does NOT flip the
          // active environment — that happens only via /activate-live below.
          ...(isLiveTab ? { confirm_live: form.confirm_live } : {}),
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Failed to save');
      setSaved(true);
      setForm({ ...form, client_secret: '', confirm_live: '' });
      await refresh(); router.refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }

  async function testConnection() {
    setBusy('test'); setTestResult(null); setError(null);
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
    finally { setBusy(null); }
  }

  async function importEnv() {
    if (!confirm('Import current environment PayPal configuration into the encrypted vault?')) return;
    setBusy('import'); setError(null);
    try {
      const r = await fetch('/api/admin/settings/paypal/import-env', { method: 'POST', credentials: 'include' });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Failed');
      await refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }

  // M07 activation patch — DEDICATED activation flow.
  async function activateLive() {
    setBusy('activate'); setError(null); setActivationMsg(null);
    try {
      const r = await fetch('/api/admin/settings/paypal/activate-live', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ confirm: activateInput }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Activation failed');
      // Do NOT trust the response alone — refetch and verify the SERVER now reports live.
      const fresh = await refresh();
      const truly = fresh?.active_environment === 'live' && fresh?.real_money_enabled === true;
      if (!truly) {
        throw new Error('Activation call succeeded but server state is still not LIVE. Please retry or contact engineering.');
      }
      setActivationMsg({ ok: true, msg: `PayPal Live payments enabled. Real money is now ENABLED (${fresh?.live_api_host}).` });
      setActivateInput('');
      router.refresh();
    } catch (e) {
      // On failure, refetch anyway so the UI shows the true server state.
      await refresh().catch(() => {});
      setActivationMsg({ ok: false, msg: (e as Error).message });
    } finally { setBusy(null); }
  }

  async function switchToSandbox() {
    setBusy('rollback'); setError(null); setActivationMsg(null);
    try {
      const r = await fetch('/api/admin/settings/paypal/switch-to-sandbox', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ confirm: sandboxInput }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Rollback failed');
      const fresh = await refresh();
      const truly = fresh?.active_environment === 'sandbox' && fresh?.real_money_enabled === false;
      if (!truly) throw new Error('Rollback call succeeded but server state did not report Sandbox. Please retry.');
      setActivationMsg({ ok: true, msg: 'Switched to Sandbox. Live credentials remain saved.' });
      setSandboxInput('');
      router.refresh();
    } catch (e) {
      await refresh().catch(() => {});
      setActivationMsg({ ok: false, msg: (e as Error).message });
    } finally { setBusy(null); }
  }

  // Pre-flight readiness check for Live activation (mirrors backend guard order).
  const liveVaultReady =
    status.live?.configured &&
    !!status.live?.client_id_masked &&
    status.live?.client_secret_configured &&
    status.live?.webhook_id_configured &&
    status.live?.last_connection_test_status === 'success';
  const canonicalOK = (status.canonical_origin || '').replace(/\/+$/, '') === 'https://wavelead.org';
  const activationEligible = !isPreview && liveVaultReady && canonicalOK && status.vault_key_configured;

  return (
    <div className="mt-6 space-y-6" data-testid="paypal-settings">
      {!status.vault_key_configured && (
        <div className="wh-card p-4 border-rose-300 bg-rose-50/40">
          <div className="flex items-start gap-2"><ShieldAlert className="h-5 w-5 text-rose-600 mt-0.5" /><div>
            <div className="font-semibold">INTEGRATION_SECRETS_KEY not configured</div>
            <div className="text-sm text-muted-foreground">The encryption master key is missing. Vault operations are disabled until the environment key is set on the server.</div>
          </div></div>
        </div>
      )}

      {/* Active environment banner (prominent when LIVE) */}
      <div
        data-testid="active-environment-banner"
        className={`wh-card p-5 ${isLiveActive ? 'border-rose-400 bg-rose-50/60' : 'border-sky-300 bg-sky-50/40'}`}
      >
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Active environment</div>
            <div className={`mt-1 text-2xl font-bold ${isLiveActive ? 'text-rose-700' : 'text-sky-700'}`}>
              {(status.active_environment || 'NONE').toUpperCase()}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Persisted: <span className="font-mono">{status.persisted_active_environment ?? '—'}</span>{' '}
              · Source: <span className="font-mono">{status.persisted_source ?? '—'}</span>{' '}
              · Credential: <span className="font-mono">{status.active_source ?? '—'}</span>
            </div>
          </div>
          {isLiveActive ? (
            <Badge className="bg-rose-600 text-white text-sm px-3 py-1" data-testid="real-money-badge">
              REAL MONEY ENABLED
            </Badge>
          ) : (
            <Badge className="bg-sky-100 text-sky-800 text-sm px-3 py-1">Test mode</Badge>
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <InfoCard label="Canonical origin" value={status.canonical_origin || '—'} accent={canonicalOK ? 'emerald' : 'amber'} hint={canonicalOK ? 'Matches wavelead.org' : 'Live requires https://wavelead.org'} />
        <InfoCard label="Vault key" value={status.vault_key_configured ? 'Configured' : 'Missing'} accent={status.vault_key_configured ? 'emerald' : 'rose'} />
        <InfoCard label="Node environment" value={status.node_env} accent={isPreview ? 'amber' : 'emerald'} hint={isPreview ? 'Live activation DISABLED outside production' : 'Production'} />
      </div>

      <div className="wh-card p-5">
        <div className="flex gap-2 border-b border-border pb-3">
          <TabButton active={tab === 'sandbox'} onClick={() => setTab('sandbox')}>
            Sandbox {status.active_environment === 'sandbox' && <span className="ml-1 text-xs text-sky-700">(Active)</span>}
          </TabButton>
          <TabButton active={tab === 'live'} onClick={() => setTab('live')}>
            Live <span className="ml-1 text-xs text-rose-600">(REAL MONEY)</span>
            {isLiveActive && <span className="ml-1 text-xs text-rose-700">(Active)</span>}
          </TabButton>
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

        <div className="mt-6 border-t border-border pt-4">
          <h3 className="text-sm font-semibold">Save {tab} credentials</h3>
          <p className="text-xs text-muted-foreground">Saving credentials does <span className="font-semibold">not</span> switch the active environment. Activation is a separate step below.</p>
          <div className="mt-3 grid md:grid-cols-2 gap-4">
            <Field label="Client ID"><input type="text" placeholder={activeEnv.client_id_masked || 'AZ…'} value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })} className={inputCls} /></Field>
            <Field label={activeEnv.client_secret_configured ? 'Replace Client Secret (leave blank to keep)' : 'Client Secret'}><input type="password" placeholder={activeEnv.client_secret_configured ? '•••• Configured' : ''} value={form.client_secret} onChange={(e) => setForm({ ...form, client_secret: e.target.value })} className={inputCls} autoComplete="new-password" /></Field>
            <Field label="Webhook ID (optional; required for LIVE)"><input type="text" placeholder={activeEnv.webhook_id_masked || ''} value={form.webhook_id} onChange={(e) => setForm({ ...form, webhook_id: e.target.value })} className={inputCls} /></Field>
            <Field label="Webhook callback URL (auto-derived)"><input type="text" readOnly value={status.webhook_url} className={inputCls + ' bg-muted/40'} /></Field>

            {isLiveTab && !status.live.client_secret_configured && (
              <div className="md:col-span-2 wh-card p-3 border-rose-300 bg-rose-50/40">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-5 w-5 text-rose-600 mt-0.5" />
                  <div className="flex-1">
                    <div className="font-semibold text-rose-800">First-time Live credential save</div>
                    <div className="text-sm text-muted-foreground">Type <span className="font-mono">ENABLE LIVE PAYMENTS</span> to save the Live secret. This still does NOT activate Live — use the activation card below.</div>
                    <input value={form.confirm_live} onChange={(e) => setForm({ ...form, confirm_live: e.target.value })} placeholder="ENABLE LIVE PAYMENTS" className={inputCls + ' mt-2'} disabled={isLiveBlocked} />
                    {isLiveBlocked && <div className="mt-1 text-xs text-rose-700">Live mode is disabled outside production.</div>}
                  </div>
                </div>
              </div>
            )}
          </div>

          {error && <div className="mt-4 text-sm text-rose-600" data-testid="paypal-error">{error}</div>}
          {saved && <div className="mt-4 text-sm text-emerald-600 inline-flex items-center gap-1"><CheckCircle2 className="h-4 w-4" /> Saved</div>}
          {testResult && (
            <div className={`mt-4 text-sm inline-flex items-center gap-1 ${testResult.ok ? 'text-emerald-600' : 'text-rose-600'}`}>
              {testResult.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />} {testResult.msg}
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={save} disabled={busy !== null || isLiveBlocked || !form.client_id.trim() || !status.vault_key_configured}>
              {busy === 'save' ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Saving…</> : `Save ${tab} credentials`}
            </Button>
            <Button variant="outline" onClick={testConnection} disabled={busy !== null}>Test connection</Button>
            <Button variant="outline" onClick={importEnv} disabled={busy !== null}><RefreshCw className="h-3.5 w-3.5 mr-1" /> Import current .env</Button>
          </div>
        </div>
      </div>

      {/* =====================================================================
          M07 activation patch — dedicated Activate Live / Switch to Sandbox
          controls. These are the ONLY UI paths that flip the DB-persisted
          active_environment.
          ===================================================================== */}
      <div className="wh-card p-5 border-rose-300" data-testid="live-activation-card">
        <div className="flex items-start gap-2">
          <Power className="h-5 w-5 text-rose-600 mt-0.5" />
          <div className="flex-1">
            <div className="font-semibold text-rose-800">Enable PayPal Live Payments</div>
            <p className="mt-1 text-sm text-muted-foreground">
              This flips the persisted active environment to <span className="font-mono">live</span> and enables
              real-money transactions. All safety guards run server-side:
              production node env, canonical origin <span className="font-mono">https://wavelead.org</span>,
              complete Live vault, successful Live connection test, and exact confirmation phrase.
            </p>

            <ul className="mt-3 text-xs space-y-1">
              <li className={`flex items-center gap-2 ${!isPreview ? 'text-emerald-700' : 'text-rose-700'}`}>{!isPreview ? '✔' : '✘'} Production node env</li>
              <li className={`flex items-center gap-2 ${canonicalOK ? 'text-emerald-700' : 'text-rose-700'}`}>{canonicalOK ? '✔' : '✘'} Canonical origin = https://wavelead.org</li>
              <li className={`flex items-center gap-2 ${status.live?.client_id_masked ? 'text-emerald-700' : 'text-rose-700'}`}>{status.live?.client_id_masked ? '✔' : '✘'} Live Client ID configured</li>
              <li className={`flex items-center gap-2 ${status.live?.client_secret_configured ? 'text-emerald-700' : 'text-rose-700'}`}>{status.live?.client_secret_configured ? '✔' : '✘'} Live Client Secret configured</li>
              <li className={`flex items-center gap-2 ${status.live?.webhook_id_configured ? 'text-emerald-700' : 'text-rose-700'}`}>{status.live?.webhook_id_configured ? '✔' : '✘'} Live Webhook ID configured</li>
              <li className={`flex items-center gap-2 ${status.live?.last_connection_test_status === 'success' ? 'text-emerald-700' : 'text-rose-700'}`}>{status.live?.last_connection_test_status === 'success' ? '✔' : '✘'} Latest Live connection test = success</li>
            </ul>

            <div className="mt-3">
              <Field label={`Type "${CONFIRM_ENABLE_LIVE}" to confirm`}>
                <input
                  type="text"
                  value={activateInput}
                  onChange={(e) => setActivateInput(e.target.value)}
                  placeholder={CONFIRM_ENABLE_LIVE}
                  className={inputCls}
                  disabled={busy !== null || isLiveActive}
                  data-testid="activate-live-confirm"
                />
              </Field>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                onClick={activateLive}
                disabled={busy !== null || isLiveActive || !activationEligible || activateInput !== CONFIRM_ENABLE_LIVE}
                className="bg-rose-600 hover:bg-rose-700 text-white"
                data-testid="activate-live-btn"
              >
                {busy === 'activate'
                  ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Activating…</>
                  : (isLiveActive ? 'Live already active' : 'Enable PayPal Live Payments')}
              </Button>
              {isLiveActive && (
                <span className="text-xs text-rose-700 self-center">Use “Switch to Sandbox” below to disable.</span>
              )}
            </div>

            {activationMsg && (
              <div className={`mt-3 text-sm inline-flex items-center gap-1 ${activationMsg.ok ? 'text-emerald-600' : 'text-rose-600'}`}
                data-testid="activation-msg">
                {activationMsg.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />} {activationMsg.msg}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="wh-card p-5" data-testid="sandbox-rollback-card">
        <div className="flex items-start gap-2">
          <RotateCcw className="h-5 w-5 text-sky-700 mt-0.5" />
          <div className="flex-1">
            <div className="font-semibold">Switch back to Sandbox</div>
            <p className="mt-1 text-sm text-muted-foreground">
              Flips the persisted active environment back to <span className="font-mono">sandbox</span>.
              Does NOT delete Live credentials, refund transactions, alter the ledger, or modify webhook config.
              Requires the exact phrase <span className="font-mono">{CONFIRM_SWITCH_SANDBOX}</span>.
            </p>
            <div className="mt-3">
              <Field label={`Type "${CONFIRM_SWITCH_SANDBOX}" to confirm`}>
                <input
                  type="text"
                  value={sandboxInput}
                  onChange={(e) => setSandboxInput(e.target.value)}
                  placeholder={CONFIRM_SWITCH_SANDBOX}
                  className={inputCls}
                  disabled={busy !== null || status.active_environment === 'sandbox'}
                  data-testid="switch-sandbox-confirm"
                />
              </Field>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={switchToSandbox}
                disabled={busy !== null || status.active_environment === 'sandbox' || sandboxInput !== CONFIRM_SWITCH_SANDBOX}
                data-testid="switch-sandbox-btn"
              >
                {busy === 'rollback' ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Switching…</> : 'Switch to Sandbox'}
              </Button>
              {status.active_environment === 'sandbox' && <span className="text-xs text-muted-foreground self-center">Already on Sandbox.</span>}
            </div>
          </div>
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
