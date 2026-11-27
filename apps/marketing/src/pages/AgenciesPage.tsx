import { Reveal } from "@restaurant/ui";
import { Section, SectionHeading } from "../components/Section";
import { MarketingPageHero } from "../components/MarketingPageHero";
import { MarketingClosingCta } from "../components/MarketingClosingCta";
import { ButtonLink } from "../components/ButtonLink";
import { usePageMeta } from "../hooks/usePageMeta";
import { ADMIN_START_URL } from "../lib/links";

/**
 * /agencies — the Agency — Growth plan for web designers and marketing agencies that serve
 * restaurants. Describes only what the product does today (agency accounts, up to 5 client
 * businesses, Growth-tier features per client, the white-label options agencies switch on in their
 * own settings). Not promised here: online card payments, marketplace or POS integrations, a mobile
 * app, or anything on the white-label roadmap that isn't built.
 */

const WHAT_YOU_GET = [
  { title: "One login for every client", body: "Manage up to 5 client restaurant businesses from one agency dashboard, each with its own locations, staff and owner." },
  { title: "Growth features for each client", body: "Every managed business gets Growth-tier features: up to 2 locations, its own ordering domain, business-wide analytics and promotions." },
  { title: "Your brand, not ours", body: "Turn on white-label options per client: your brand name and colour on storefronts, GarnishTable branding hidden, and your own support contact shown to customers." },
  { title: "Client domains, branded sign-in and email", body: "Connect a client's own domain to their ordering page, use a branded sign-in page, and send customer emails from your verified sending domain." },
  { title: "One bill", body: "One agency subscription covers your client businesses: $179/month or $1,790/year." },
  { title: "Fast client setup", body: "Import a client's menu from their website, a PDF or photos, apply their brand, and publish the same day." },
];

const FAQ = [
  { q: "Who is the agency plan for?", a: "Web designers, marketing agencies and consultants who look after several independent restaurants and want to offer them direct online ordering under their own service." },
  { q: "How many restaurants can I manage?", a: "Up to 5 client businesses on Agency — Growth. Each business can have up to 2 locations. For more, contact us." },
  { q: "Can I hide GarnishTable from my clients' customers?", a: "Yes. With white-label switched on for a client, their storefront shows your brand name and colour instead of GarnishTable's, and customers see your support contact." },
  { q: "Do customers pay online by card?", a: "Not yet. Customers currently pay the restaurant directly: at pickup or collection, on delivery, or at the table. Online card payments are planned." },
  { q: "Does it connect to Uber Eats, DoorDash, Just Eat or Deliveroo?", a: "Not at launch. GarnishTable is the restaurant's own direct ordering channel; marketplace connections are planned." },
];

export function AgenciesPage() {
  usePageMeta({
    title: "Restaurant Ordering Software for Agencies — GarnishTable",
    description:
      "Offer your restaurant clients commission-free online ordering under your own brand. Manage up to 5 client businesses from one login for $179/month.",
  });
  return (
    <>
      <MarketingPageHero
        eyebrow="For agencies"
        title="Online ordering for your restaurant clients, under your brand"
        description="Web designers and marketing agencies use GarnishTable to give independent restaurants their own commission-free ordering page, managed from one agency login."
      />

      <Section tone="surface">
        <SectionHeading eyebrow="What you get" title="Agency — Growth" description="$179/month or $1,790/year, for up to 5 client restaurant businesses." />
        <div className="mx-auto mt-10 grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {WHAT_YOU_GET.map((item, i) => (
            <Reveal key={item.title} index={i % 3} className="flex flex-col gap-2 rounded-xl border border-border bg-background p-6">
              <h3 className="font-heading text-lg font-semibold text-foreground">{item.title}</h3>
              <p className="text-sm text-muted">{item.body}</p>
            </Reveal>
          ))}
        </div>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <ButtonLink href={ADMIN_START_URL}>Start your agency trial</ButtonLink>
          <ButtonLink to="/pricing" variant="secondary">See all plans</ButtonLink>
          <ButtonLink to="/demo" variant="secondary">See the live demo</ButtonLink>
        </div>
      </Section>

      <Section>
        <SectionHeading eyebrow="Agency FAQ" title="Questions agencies ask" />
        <div className="mx-auto mt-10 grid max-w-3xl gap-3">
          {FAQ.map((item, i) => (
            <Reveal key={item.q} index={i % 4} className="rounded-xl border border-border bg-surface p-5">
              <h3 className="font-medium text-foreground">{item.q}</h3>
              <p className="mt-1 text-sm text-muted">{item.a}</p>
            </Reveal>
          ))}
        </div>
      </Section>

      <MarketingClosingCta
        title="Bring direct ordering to your restaurant clients"
        description="Set up your agency, add your first client, and publish their ordering page the same day."
      />
    </>
  );
}
