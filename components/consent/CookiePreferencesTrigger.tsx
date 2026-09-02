'use client';
// Small pill link used inside the footer to re-open the Cookie Preferences
// manager. Broadcasts a window event so the mounted ConsentBanner can react.
import { Cookie } from 'lucide-react';

export default function CookiePreferencesTrigger() {
  return (
    <button
      type="button"
      data-testid="footer-cookie-preferences"
      onClick={() => window.dispatchEvent(new Event('wl:open-cookie-preferences'))}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <Cookie className="h-3.5 w-3.5" /> Cookie Preferences
    </button>
  );
}
