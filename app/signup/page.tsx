import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo/metadata';
import SignupClient from './SignupClient';

// SEO remediation — auth pages are noindex. All ?next=... variants canonicalize
// to /signup so search engines never see duplicate content across query strings.
export function generateMetadata(): Metadata {
  return buildMetadata({
    title: 'Create Your WaveLead Account',
    description:
      'Create a WaveLead account to grow and monetize WhatsApp Channels, or to run creator campaigns for your brand.',
    path: '/signup',
    robots: 'noindex,follow',
  });
}

export default function SignupPage(): React.JSX.Element {
  return <SignupClient />;
}
