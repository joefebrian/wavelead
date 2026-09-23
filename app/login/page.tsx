import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo/metadata';
import LoginClient from './LoginClient';

// SEO remediation — auth pages are noindex. All ?next=... variants canonicalize
// to /login so search engines never see duplicate content across query strings.
export function generateMetadata(): Metadata {
  return buildMetadata({
    title: 'Sign in to WaveLead',
    description:
      'Sign in to your WaveLead account to manage channels, campaigns, sponsorships and marketplace activity.',
    path: '/login',
    robots: 'noindex,follow',
  });
}

export default function LoginPage(): React.JSX.Element {
  return <LoginClient />;
}
