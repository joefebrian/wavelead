// M18 — WaveLead brand mark.
//
// The logo is the EXACT operator-supplied PNG, persisted locally at
// /public/brand/wavelead-logo.png (2172×724, 3:1). It is never redrawn,
// regenerated or reinterpreted, and it is never hotlinked from a temporary /
// signed external asset URL — the file ships with the repository.
import Image from 'next/image';

/** Canonical local asset path. Single source of truth for every surface. */
export const WAVELEAD_LOGO_SRC = '/brand/wavelead-logo.png';
export const WAVELEAD_LOGO_INTRINSIC = { width: 2172, height: 724 } as const;
export const WAVELEAD_LOGO_ASPECT = WAVELEAD_LOGO_INTRINSIC.width / WAVELEAD_LOGO_INTRINSIC.height;

const SIZES = {
  sm: 24,
  md: 30,
  lg: 40,
  xl: 56,
} as const;

export type BrandLogoSize = keyof typeof SIZES;

/**
 * Renders the WaveLead logo at the correct aspect ratio (never stretched):
 * the caller picks a height and the width is derived from the real intrinsic
 * dimensions of the supplied asset.
 */
export default function BrandLogo({
  size = 'md', priority = false, className = '', withWordmarkFallback = false,
}: {
  size?: BrandLogoSize;
  priority?: boolean;
  className?: string;
  /** Screen-reader-only text companion; the asset already contains the wordmark. */
  withWordmarkFallback?: boolean;
}) {
  const h = SIZES[size];
  const w = Math.round(h * WAVELEAD_LOGO_ASPECT);
  return (
    <span className={`inline-flex items-center ${className}`} data-testid="brand-logo">
      <Image
        src={WAVELEAD_LOGO_SRC}
        alt="WaveLead"
        width={w}
        height={h}
        priority={priority}
        sizes={`${w}px`}
        style={{ height: h, width: 'auto' }}   // preserve aspect ratio
      />
      {withWordmarkFallback && <span className="sr-only">WaveLead</span>}
    </span>
  );
}
