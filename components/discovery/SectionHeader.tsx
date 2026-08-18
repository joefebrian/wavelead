import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';

interface Props {
  title: string;
  subtitle?: string;
  href?: string;
  cta?: string;
  right?: ReactNode;
}

export default function SectionHeader({ title, subtitle, href, cta = 'View all', right }: Props) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <h2 className="text-xl md:text-2xl font-bold tracking-tight text-foreground">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-3">
        {right}
        {href && (
          <Link href={href} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline whitespace-nowrap">
            {cta} <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </div>
    </div>
  );
}
