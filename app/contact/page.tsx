import type { Metadata } from 'next';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import ContactForm from './ContactForm';
import { contactService } from '@/lib/services/contactService';
import { buildMetadata } from '@/lib/seo/metadata';

export const metadata: Metadata = buildMetadata({
  title: 'Contact WaveLead',
  description:
    'Talk to the WaveLead team about enterprise, agency partnerships, sponsorship help, ownership questions or press. WaveLead is a product by P2P Labs.',
  path: '/contact',
});

export const dynamic = 'force-dynamic';

interface Props { searchParams?: Promise<Record<string, string | string[] | undefined>>; }

export default async function ContactPage({ searchParams }: Props) {
  const sp = searchParams ? await searchParams : {};
  const topicParam = typeof sp.topic === 'string' ? sp.topic : '';
  const preselectedTopic = (contactService.CONTACT_TOPICS as readonly string[]).includes(topicParam) ? topicParam : '';
  const emailAvailable = contactService.hasRealEmailDelivery();

  return (
    <>
      <Header />
      <main>
        <section className="wh-gradient-hero border-b border-border/60">
          <div className="container py-10 md:py-14 max-w-3xl">
            <div className="text-xs font-semibold uppercase tracking-widest text-primary">Contact</div>
            <h1 className="mt-2 text-3xl md:text-4xl font-bold">Talk to WaveLead</h1>
            <p className="mt-2 text-muted-foreground">Enterprise, partnerships, ownership questions, sponsorship help, press — send us a note and we&apos;ll get back to you.</p>
          </div>
        </section>

        <section className="container py-10 max-w-3xl">
          <ContactForm
            destination={contactService.destination}
            preselectedTopic={preselectedTopic}
            emailAvailable={emailAvailable}
          />
        </section>
      </main>
      <Footer />
    </>
  );
}
