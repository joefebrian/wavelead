'use client';

import { useState, FormEvent, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { GoogleAuthButton } from '@/components/auth/GoogleAuthButton';

function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
      // Server owns the final redirect. We send `next` for the server to validate.
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password, next: nextParam }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Login failed');
      toast.success(`Welcome back, ${json.data.user.display_name}`);
      // Trust ONLY the server-computed redirect target.
      const dest = typeof json.data?.redirect_to === 'string' && json.data.redirect_to.startsWith('/')
        ? json.data.redirect_to
        : '/dashboard';
      router.push(dest);
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setLoading(false); }
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-4">
      <div><Label htmlFor="email">Email</Label><Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      <div><Label htmlFor="password">Password</Label><Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
      <Button className="w-full" disabled={loading}>{loading ? 'Signing in…' : 'Log in'}</Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <>
      <Header />
      <main className="container py-16 max-w-md">
        <h1 className="text-3xl font-bold">Welcome back</h1>
        <p className="text-muted-foreground mt-2">Log in to your WaveLead account.</p>
        <div className="mt-8">
          <GoogleAuthButton label="Continue with Google" />
        </div>
        <Suspense fallback={<div className="mt-6 h-32 animate-pulse rounded-md bg-muted" />}>
          <LoginForm />
        </Suspense>
        <p className="mt-6 text-sm text-muted-foreground text-center">Don&apos;t have an account? <Link href="/signup" className="text-primary hover:underline">Create one</Link></p>
      </main>
      <Footer />
    </>
  );
}
