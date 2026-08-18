import Link from 'next/link';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  title?: string;
  message?: string;
  ctaHref?: string;
  ctaLabel?: string;
}

export default function EmptyState({
  title = 'Nothing to show yet',
  message = 'We couldn’t load this section right now. Explore all channels instead.',
  ctaHref = '/channels',
  ctaLabel = 'Browse Channels',
}: Props) {
  return (
    <div className="wh-card p-8 text-center">
      <div className="mx-auto h-10 w-10 grid place-items-center rounded-full bg-primary/10 text-primary">
        <Search className="h-5 w-5" />
      </div>
      <div className="mt-3 font-semibold">{title}</div>
      <p className="mt-1 text-sm text-muted-foreground">{message}</p>
      <div className="mt-4"><Link href={ctaHref}><Button>{ctaLabel}</Button></Link></div>
    </div>
  );
}
