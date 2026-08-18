'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function SignupPage() {
  const [form, setForm] = useState({ display_name: '', email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'Signup failed');
      toast.success('Account created!');
      router.push('/dashboard');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Header />
      <main className="container py-16 max-w-md">
        <h1 className="text-3xl font-bold">Create your WaveHub account</h1>
        <p className="text-muted-foreground mt-2">Free forever for discovery. Growth tools available for channel owners.</p>
        <form onSubmit={submit} className="mt-8 space-y-4">
          <div>
            <Label htmlFor="display_name">Display name</Label>
            <Input id="display_name" required value={form.display_name}
              onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" required minLength={8} value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
            <p className="text-xs text-muted-foreground mt-1">At least 8 characters.</p>
          </div>
          <Button className="w-full" disabled={loading}>{loading ? 'Creating…' : 'Create account'}</Button>
        </form>
        <p className="mt-6 text-sm text-muted-foreground text-center">
          Already registered? <Link href="/login" className="text-primary hover:underline">Log in</Link>
        </p>
      </main>
      <Footer />
    </>
  );
}
