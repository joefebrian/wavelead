'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { GoogleAuthButton } from '@/components/auth/GoogleAuthButton';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Login failed');
      toast.success(`Welcome back, ${json.data.user.display_name}`);
      router.push('/dashboard');
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setLoading(false); }
  }

  return (
    <>
      <Header />
      <main className="container py-16 max-w-md">
        <h1 className="text-3xl font-bold">Welcome back</h1>
        <p className="text-muted-foreground mt-2">Log in to your WaveLead account.</p>
        <div className="mt-8">
          <GoogleAuthButton label="Continue with Google" />
        </div>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div><Label htmlFor="email">Email</Label><Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div><Label htmlFor="password">Password</Label><Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          <Button className="w-full" disabled={loading}>{loading ? 'Signing in…' : 'Log in'}</Button>
        </form>
        <p className="mt-6 text-sm text-muted-foreground text-center">Don&apos;t have an account? <Link href="/signup" className="text-primary hover:underline">Create one</Link></p>
      </main>
      <Footer />
    </>
  );
}
