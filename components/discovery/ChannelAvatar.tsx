import { resolveChannelAvatar, CHANNEL_FALLBACK_AVATAR } from '@/lib/seo/channelAvatar';

interface Props {
  logoUrl: string | null | undefined;
  name: string | null | undefined;
  size?: string;
  alt?: string;
  /**
   * When true, always render an <img> (initials fallback disabled). Used on
   * the channel profile page hero where a stable frame is expected.
   */
  preferImage?: boolean;
  testId?: string;
}

export default function ChannelAvatar({ logoUrl, name, size = 'h-12 w-12 text-lg', alt = '', preferImage = false, testId }: Props): React.JSX.Element {
  const safe = resolveChannelAvatar(logoUrl);
  const initial = ((name || 'W').trim().charAt(0) || 'W').toUpperCase();
  return (
    <div
      className={`${size} shrink-0 rounded-xl bg-gradient-to-br from-primary/80 to-primary grid place-items-center text-primary-foreground font-bold overflow-hidden`}
      aria-hidden
      data-testid={testId}
    >
      {safe ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={safe} alt={alt} className="h-full w-full object-cover" referrerPolicy="no-referrer" loading="lazy" />
      ) : preferImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={CHANNEL_FALLBACK_AVATAR} alt={alt} className="h-full w-full object-cover" loading="lazy" />
      ) : (
        initial
      )}
    </div>
  );
}
