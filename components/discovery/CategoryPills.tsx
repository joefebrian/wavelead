import Link from 'next/link';
import type { Category } from '@/lib/types';

interface Props { categories: Category[]; active?: string; }

export default function CategoryPills({ categories, active }: Props) {
  return (
    <div className="border-b border-border/60 bg-background/70">
      <div className="container">
        <nav aria-label="Category quick filters" className="flex items-center gap-2 overflow-x-auto py-3 no-scrollbar">
          <Pill href="/channels" label="All" active={!active} />
          {categories.map((c) => (
            <Pill key={c.id} href={`/category/${c.slug}`} label={c.name} active={active === c.slug} />
          ))}
        </nav>
      </div>
    </div>
  );
}

function Pill({ href, label, active }: { href: string; label: string; active?: boolean }) {
  return (
    <Link href={href}
      className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium border transition ${
        active
          ? 'bg-primary text-primary-foreground border-primary'
          : 'bg-card text-foreground border-border hover:border-primary/40 hover:text-primary'
      }`}>
      {label}
    </Link>
  );
}
