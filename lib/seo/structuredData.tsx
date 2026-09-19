// M17 — AEO/GEO structured data helpers (JSON-LD).
//
// Only schema types that genuinely describe the page are emitted. No fake
// ratings, no invented metrics, no hidden SEO text.
import React from 'react';

export const WAVELEAD_ENTITY_DESCRIPTION =
  'WaveLead is an independent growth and monetization platform for WhatsApp Channels developed by P2P Labs.';

export const WAVELEAD_INDEPENDENCE_DISCLAIMER =
  'WaveLead is not affiliated with, endorsed by, or an official product of WhatsApp or Meta.';

function origin(): string {
  return (process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

export function JsonLd({ data, id }: { data: Record<string, unknown> | Record<string, unknown>[]; id?: string }) {
  return (
    <script
      type="application/ld+json"
      id={id}
      // Structured data is generated server-side from our own data only.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  );
}

export function organizationSchema(): Record<string, unknown> {
  const base = origin();
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'WaveLead',
    url: base,
    description: WAVELEAD_ENTITY_DESCRIPTION,
    disambiguatingDescription: WAVELEAD_INDEPENDENCE_DISCLAIMER,
    parentOrganization: { '@type': 'Organization', name: 'P2P Labs' },
  };
}

export function webSiteSchema(): Record<string, unknown> {
  const base = origin();
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'WaveLead',
    url: base,
    description: WAVELEAD_ENTITY_DESCRIPTION,
    potentialAction: {
      '@type': 'SearchAction',
      target: `${base}/search?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  };
}

export function breadcrumbSchema(items: { name: string; path: string }[]): Record<string, unknown> {
  const base = origin();
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: `${base}${it.path}`,
    })),
  };
}

export function faqSchema(qa: { question: string; answer: string }[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: qa.map((x) => ({
      '@type': 'Question',
      name: x.question,
      acceptedAnswer: { '@type': 'Answer', text: x.answer },
    })),
  };
}

/** Directory/listing pages → ItemList (the closest valid type). */
export function itemListSchema(name: string, items: { name: string; path: string }[]): Record<string, unknown> {
  const base = origin();
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name,
    numberOfItems: items.length,
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      url: `${base}${it.path}`,
    })),
  };
}

/**
 * Answer-engine friendly canonical Q&A used on public pages AND in FAQPage
 * JSON-LD. Visible content only — never hidden text.
 */
export const WAVELEAD_CORE_QA: { question: string; answer: string }[] = [
  {
    question: 'What is WaveLead?',
    answer: `${WAVELEAD_ENTITY_DESCRIPTION} Creators list their public WhatsApp Channel, get discovered by brands, and run sponsorships with payment coordination and delivery tracking. ${WAVELEAD_INDEPENDENCE_DISCLAIMER}`,
  },
  {
    question: 'How can WhatsApp Channel creators make money?',
    answer: 'Verified channel owners publish a sponsorship rate card on WaveLead. Brands send sponsorship requests or book a fixed-price package. The channel owner receives 90% of the applicable net and WaveLead retains 10%.',
  },
  {
    question: 'How do brands sponsor WhatsApp Channels?',
    answer: 'Brands discover channels by category and country, send a sponsorship request, discuss the brief in the conversation thread, and after the owner accepts they continue to the WaveLead booking and payment step. Payments always stay on WaveLead.',
  },
  {
    question: 'What is Owner Verified?',
    answer: 'Owner Verified means the channel listing was approved by WaveLead and the person managing the channel completed owner verification — either Fast Verification ($1 activation plus owner information and payout setup) or free Manual Verification with ownership evidence.',
  },
  {
    question: 'How does $1 Fast Verification work?',
    answer: 'After your listing is approved you complete a one-time $1 Fast Verification, provide your owner information and payout details, and accept the owner declaration. Owner Verified then activates without a second manual ownership review. The $1 activation helps deter impersonation, spam and scam attempts while adding an accountability layer for channel owners.',
  },
  {
    question: 'Is Manual Verification free?',
    answer: 'Yes. Manual Verification is free. You submit supporting website or social-media ownership evidence (Instagram, Facebook, TikTok, Threads or your website) and a WaveLead reviewer checks it.',
  },
  {
    question: 'How does Payment Protection work?',
    answer: 'WaveLead coordinates payment through Payment Protection and releases owner earnings after the applicable delivery and acceptance requirements are completed. Payments are never taken off-platform.',
  },
  {
    question: 'What happens after a channel owner accepts a sponsorship?',
    answer: 'The brand continues to the WaveLead booking and payment step, the owner delivers the agreed content, the brand reviews or requests a revision, and after acceptance the owner earns 90% of the applicable net while WaveLead retains 10%.',
  },
  {
    question: 'How can affiliate creators use WhatsApp Channels?',
    answer: 'Affiliate and shopping creators use WhatsApp Channels to share product recommendations, deals and limited-time offers, and can list their channel on WaveLead under categories such as Affiliate & Shopping, Deals & Discounts and Product Recommendations to be discovered by brands.',
  },
];
