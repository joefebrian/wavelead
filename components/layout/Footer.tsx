import Link from 'next/link';
import { Radio } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="border-t border-border/60 bg-background">
      <div className="container py-10 grid gap-8 md:grid-cols-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Radio className="h-4 w-4" />
            </span>
            <span className="font-bold">WaveLead</span>
          </div>
          <p className="mt-3 text-sm text-muted-foreground max-w-xs">
            The independent growth infrastructure for WhatsApp Channels. Not affiliated with WhatsApp or Meta.
          </p>
        </div>
        <FCol title="Discover" links={[['/channels','All Channels'],['/trending','Trending'],['/top','Top Channels'],['/categories','Categories'],['/country/indonesia','Countries']]} />
        <FCol title="For Owners" links={[['/submit','Submit Channel'],['/dashboard','Owner Dashboard'],['/pricing','Pricing']]} />
        <FCol title="Company" links={[['/about','About'],['/terms','Terms'],['/privacy','Privacy']]} />
      </div>
      <div className="border-t border-border/60">
        <div className="container py-4 flex flex-col md:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} WaveLead. All rights reserved.</span>
          <span>WhatsApp is a trademark of Meta Platforms, Inc. WaveLead is an independent service.</span>
        </div>
      </div>
    </footer>
  );
}

function FCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <div className="text-sm font-semibold mb-3">{title}</div>
      <ul className="space-y-2 text-sm text-muted-foreground">
        {links.map(([href, label]) => (<li key={href}><Link href={href} className="hover:text-foreground">{label}</Link></li>))}
      </ul>
    </div>
  );
}
