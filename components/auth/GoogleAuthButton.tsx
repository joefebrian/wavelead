'use client';

// Emergent Managed Google Auth start button.
//
// Renders only when NEXT_PUBLIC_AUTH_GOOGLE_ENABLED === 'true'. Clicking it hits
// our /api/auth/google/start endpoint which 302s to Emergent's start URL with
// the callback pinned to the current origin. This means the same button works
// on preview AND wavelead.org without any code change.
import { Button } from '@/components/ui/button';

interface Props {
  label?: string;
  className?: string;
}

export function GoogleAuthButton({ label = 'Continue with Google', className = '' }: Props) {
  const enabled = (process.env.NEXT_PUBLIC_AUTH_GOOGLE_ENABLED || '').toLowerCase() === 'true';
  if (!enabled) return null;
  return (
    <div className={`w-full ${className}`}>
      <a
        href="/api/auth/google/start"
        className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
        aria-label={label}
      >
        <GoogleGlyph />
        {label}
      </a>
      <div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
        <div className="flex-1 border-t border-border" />
        <span>OR</span>
        <div className="flex-1 border-t border-border" />
      </div>
    </div>
  );
}

export default GoogleAuthButton;

// Multi-color Google 'G' — inline SVG to avoid external asset fetches.
function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
      <path fill="none" d="M0 0h48v48H0z"/>
    </svg>
  );
}
