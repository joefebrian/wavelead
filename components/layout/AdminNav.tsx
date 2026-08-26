import Link from 'next/link';
import { Inbox, KeyRound, ShieldAlert, LayoutList, Megaphone, DollarSign, Wallet, TrendingUp, Activity, Handshake, Users, Cog } from 'lucide-react';

interface Item { href: string; label: string; icon: React.ReactNode; }

const ITEMS: Item[] = [
  { href: '/admin', label: 'Overview', icon: <LayoutList className="h-3.5 w-3.5" /> },
  { href: '/admin/channels?status=pending_review', label: 'Moderation', icon: <Inbox className="h-3.5 w-3.5" /> },
  { href: '/admin/claims?status=pending', label: 'Claims', icon: <KeyRound className="h-3.5 w-3.5" /> },
  { href: '/admin/channel-changes?status=pending', label: 'Changes', icon: <ShieldAlert className="h-3.5 w-3.5" /> },
  { href: '/admin/promotions', label: 'Promotions', icon: <Megaphone className="h-3.5 w-3.5" /> },
  { href: '/admin/promotion-rates', label: 'Rates', icon: <TrendingUp className="h-3.5 w-3.5" /> },
  { href: '/admin/sponsorship-leads', label: 'Sponsorship Leads', icon: <Handshake className="h-3.5 w-3.5" /> },
  { href: '/admin/commercial-leads', label: 'Commercial Leads', icon: <Handshake className="h-3.5 w-3.5" /> },
  { href: '/admin/payments', label: 'Payments', icon: <Wallet className="h-3.5 w-3.5" /> },
  { href: '/admin/ledger', label: 'Ledger', icon: <DollarSign className="h-3.5 w-3.5" /> },
  { href: '/admin/payment-health', label: 'Health', icon: <Activity className="h-3.5 w-3.5" /> },
  { href: '/admin/fx-rates', label: 'FX', icon: <DollarSign className="h-3.5 w-3.5" /> },
  { href: '/admin/users', label: 'Users', icon: <Users className="h-3.5 w-3.5" /> },
  { href: '/admin/settings/paypal', label: 'PayPal Settings', icon: <Cog className="h-3.5 w-3.5" /> },
];

export default function AdminNav({ active }: { active?: string }) {
  return (
    <nav className="mt-2 mb-6 flex flex-wrap gap-1.5 rounded-lg border border-border bg-secondary/30 p-1.5">
      {ITEMS.map((i) => {
        const isActive = active && (i.href === active || i.href.split('?')[0] === active);
        return (
          <Link key={i.href} href={i.href} className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${isActive ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground hover:bg-background/60'}`}>
            {i.icon}{i.label}
          </Link>
        );
      })}
    </nav>
  );
}
