'use client';

import { useState, FormEvent, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import Header from '@/components/layout/Header';
import BrandLogo from '@/components/brand/BrandLogo';
import Footer from '@/components/layout/Footer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { GoogleAuthButton } from '@/components/auth/GoogleAuthButton';

function SignupForm() {
  const [form, setForm] = useState({ display_name: '', email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [nextParam, setNextParam] = useState<string | null>(null);

  useEffect(() => {
    setNextParam(searchParams?.get('next') || null);
  }, [searchParams]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        // M15 — pass ?next=... through so the server can safely restore the
        // originating page after signup (same-origin only; server-validated).
        body: JSON.stringify({ ...form, next: nextParam }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Signup failed');
      toast.success('Account created!');
      // M19.3 — canonical GA4 sign_up (server-confirmed). No email / user id.
      try {
        const { trackGa4Event } = await import('@/lib/analytics/events');
        trackGa4Event('sign_up', { account_type: 'unknown' });
      } catch { /* ignore */ }
      // Trust ONLY the server-computed redirect target.
      const dest = typeof json.data?.redirect_to === 'string' && json.data.redirect_to.startsWith('/')
        ? json.data.redirect_to
        : '/dashboard';
      router.push(dest);
    } catch (e) { toast.error((e as Error).message); }
    finally { setLoading(false); }
  }

  return (
    <>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <div><Label htmlFor="display_name">Display name</Label><Input id="display_name" required value={form.display_name} onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))} /></div>
        <div><Label htmlFor="email">Email</Label><Input id="email" type="email" required value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></div>
        <div><Label htmlFor="password">Password</Label><Input id="password" type="password" required minLength={8} value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} /><p className="text-xs text-muted-foreground mt-1">At least 8 characters.</p></div>
        <Button className="w-full" disabled={loading}>{loading ? 'Creating…' : 'Create account'}</Button>
      </form>
      <p className="mt-6 text-sm text-muted-foreground text-center">Already registered? <Link href={nextParam ? `/login?next=${encodeURIComponent(nextParam)}` : '/login'} className="text-primary hover:underline">Log in</Link></p>
    </>
  );
}

export default function SignupPage() {
  return (
    <>
      <Header />
      <main className="container py-16 max-w-md">
        <BrandLogo size="lg" priority className="mb-4" />
        <h1 className="text-3xl font-bold">Create your WaveLead account</h1>
        <p className="text-muted-foreground mt-2">Free forever for discovery. Growth tools available for channel owners.</p>
        <div className="mt-8">
          <GoogleAuthButton label="Sign up with Google" />
        </div>
        <Suspense fallback={<div className="mt-6 h-40 animate-pulse rounded-md bg-muted" />}>
          <SignupForm />
        </Suspense>
      </main>
      <Footer />
    </>
  );
}
