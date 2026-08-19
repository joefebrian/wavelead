import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { TrendingUp, BarChart3, Sparkles, ArrowRight } from 'lucide-react';

export default function OwnerGrowthCta() {
  return (
    <section className="container py-14">
      <div className="relative overflow-hidden rounded-2xl bg-foreground text-background p-8 md:p-12">
        <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-primary/25 blur-3xl" aria-hidden />
        <div className="relative grid gap-8 md:grid-cols-5 items-center">
          <div className="md:col-span-3">
            <div className="text-xs font-semibold uppercase tracking-widest text-primary/90">For Channel Owners</div>
            <h2 className="mt-2 text-2xl md:text-3xl font-bold">Grow your WhatsApp Channel.</h2>
            <p className="mt-3 text-background/80 max-w-lg">
              List your channel on WaveLead, understand how people discover it, and reach more potential followers.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link href="/submit"><Button size="lg">Add Your Channel <ArrowRight className="ml-1.5 h-4 w-4" /></Button></Link>
              <Link href="/about"><Button size="lg" variant="outline" className="bg-transparent border-background/40 text-background hover:bg-background hover:text-foreground">Learn how WaveLead works</Button></Link>
            </div>
          </div>
          <div className="md:col-span-2 grid gap-3">
            <Perk icon={<TrendingUp className="h-4 w-4" />} label="Discoverability across search and categories" />
          <Perk icon={<BarChart3 className="h-4 w-4" />} label="Follow-intent analytics" />
            <Perk icon={<Sparkles className="h-4 w-4" />} label="Featured slots & promotion" />
          </div>
        </div>
      </div>
    </section>
  );
}

function Perk({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-background/5 border border-background/10 px-3 py-2 text-sm">
      <span className="h-7 w-7 grid place-items-center rounded-md bg-primary text-primary-foreground">{icon}</span>
      <span className="text-background/90">{label}</span>
    </div>
  );
}
