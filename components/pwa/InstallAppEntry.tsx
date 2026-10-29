'use client';

// Persistent "Install WaveLead" entry points (mobile menu + footer). Render
// nothing on desktop, when already installed, or where no install path exists.
import { Smartphone } from 'lucide-react';
import { usePwa, type InstallTrigger } from './PwaProvider';

export default function InstallAppEntry({ trigger, onOpen, className = '' }: {
  trigger: Extract<InstallTrigger, 'menu' | 'footer'>;
  onOpen?: () => void;
  className?: string;
}) {
  const { canOfferInstall, openInstall } = usePwa();
  if (!canOfferInstall) return null;
  return (
    <button
      type="button"
      onClick={() => { onOpen?.(); openInstall(trigger); }}
      className={`inline-flex items-center gap-2 text-left ${className}`}
      data-testid={`pwa-install-entry-${trigger}`}
    >
      <Smartphone className="h-4 w-4 text-primary" />
      Install WaveLead
    </button>
  );
}
