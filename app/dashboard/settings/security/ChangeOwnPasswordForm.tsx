'use client';
import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2 } from 'lucide-react';

export default function ChangeOwnPasswordForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [form, setForm] = useState({ current_password: '', new_password: '', confirm_password: '' });

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError(null); setOk(false);
    try {
      if (form.new_password.length < 10) throw new Error('New password must be at least 10 characters (12+ recommended).');
      if (form.new_password !== form.confirm_password) throw new Error('New password and confirmation do not match.');
      const res = await fetch('/api/me/password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ current_password: form.current_password, new_password: form.new_password }),
      });
      const j = await res.json();
      if (!res.ok || !j?.ok) throw new Error(j?.error || 'Failed to change password');
      setOk(true);
      // Session invalidated — log user out and redirect to login.
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
      setTimeout(() => router.push('/login?next=/dashboard'), 1200);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="wh-card p-6 space-y-4">
      <Field label="Current password" required>
        <input type="password" required value={form.current_password} onChange={(e) => setForm({ ...form, current_password: e.target.value })} className={inputCls} autoComplete="current-password" />
      </Field>
      <Field label="New password (min 10 chars, 12+ recommended)" required>
        <input type="password" required minLength={10} value={form.new_password} onChange={(e) => setForm({ ...form, new_password: e.target.value })} className={inputCls} autoComplete="new-password" />
      </Field>
      <Field label="Confirm new password" required>
        <input type="password" required value={form.confirm_password} onChange={(e) => setForm({ ...form, confirm_password: e.target.value })} className={inputCls} autoComplete="new-password" />
      </Field>
      {error && <div className="text-sm text-rose-600">{error}</div>}
      {ok && <div className="text-sm text-emerald-600 inline-flex items-center gap-1"><CheckCircle2 className="h-4 w-4" /> Password changed. Signing you out…</div>}
      <Button type="submit" disabled={busy}>{busy ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Changing…</> : 'Change password'}</Button>
      <p className="text-xs text-muted-foreground">Changing your password invalidates every existing session and requires you to log in again.</p>
    </form>
  );
}

const inputCls = 'block w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40';
function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium mb-1">{label}{required && <span className="text-rose-500">*</span>}</span>
      {children}
    </label>
  );
}
