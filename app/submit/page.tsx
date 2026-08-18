import type { Metadata } from 'next';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import SubmitForm from './SubmitForm';
import { categoryRepo } from '@/lib/repositories/categoryRepo';
import { COUNTRIES } from '@/lib/constants/countries';
import { resolveActorFromCookies } from '@/lib/auth/rbac';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Submit a WhatsApp Channel — WaveLead',
  description: 'Add your WhatsApp Channel to WaveLead. Submissions go through moderation before appearing publicly.',
};

export const dynamic = 'force-dynamic';

export default async function SubmitPage() {
  const [actor, categories] = await Promise.all([
    resolveActorFromCookies(),
    categoryRepo.listActive(),
  ]);

  return (
    <>
      <Header />
      <main className="container py-10 md:py-14 max-w-3xl">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Submit your WhatsApp Channel</h1>
        <p className="mt-2 text-muted-foreground">Add your public WhatsApp Channel to WaveLead. Every submission goes through moderator review — no fake listings, no bought placements.</p>

        {!actor ? (
          <div className="mt-8 wh-card p-6">
            <div className="font-semibold">Sign in to continue</div>
            <p className="text-sm text-muted-foreground mt-1">Only signed-in accounts can submit a channel so we can contact you if a claim/verification step is needed. Your data isn&apos;t shared publicly.</p>
            <div className="mt-4 flex gap-2">
              <Link href="/login?next=/submit"><Button>Log in</Button></Link>
              <Link href="/signup?next=/submit"><Button variant="outline">Create an account</Button></Link>
            </div>
          </div>
        ) : (
          <SubmitForm
            categories={categories.map((c) => ({ id: c.id, slug: c.slug, name: c.name }))}
            countries={COUNTRIES.map((c) => ({ code: c.code, name: c.name, flag: c.flag }))}
          />
        )}

        <div className="mt-10 text-xs text-muted-foreground">
          By submitting you confirm you have the right to list this channel and that its content complies with WaveLead&apos;s <Link href="/terms" className="underline">Terms</Link> and <Link href="/privacy" className="underline">Privacy</Link>.
        </div>
      </main>
      <Footer />
    </>
  );
}
