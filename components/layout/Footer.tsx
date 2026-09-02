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
          <p className="mt-2 text-xs text-muted-foreground">A product by P2P Labs</p>
          <p className="mt-3 text-sm text-muted-foreground max-w-xs">
            Helping WhatsApp Channels grow, monetize and connect with brands.
          </p>
          <p className="mt-2 text-xs text-muted-foreground max-w-xs">
            Independently developed by P2P Labs. Not affiliated with, endorsed by, or an official product of WhatsApp or Meta.
          </p>
        </div>
        <FCol title="Discover" links={[['/channels','All Channels'],['/trending','Trending'],['/top','Top Channels'],['/categories','Categories'],['/country/indonesia','Countries']]} />
        <FCol title="For Owners" links={[['/submit','Submit Channel'],['/dashboard','Owner Dashboard'],['/pricing','Pricing']]} />
        <FCol title="For Brands" links={[['/for-brands','Overview'],['/channels','Discover Channels'],['/top','Top Channels']]} />
        <FCol title="Company" links={[['/about','About'],['/privacy','Privacy'],['/terms','Terms'],['/cookies','Cookie Policy'],['mailto:hello@p2plabs.asia','Contact']]} />
      </div>
      <div className="border-t border-border/60">
        <div className="container py-4 flex flex-col md:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
          <span data-testid="footer-attribution">© {new Date().getFullYear()} WaveLead — a product by P2P Labs. All rights reserved.</span>
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
