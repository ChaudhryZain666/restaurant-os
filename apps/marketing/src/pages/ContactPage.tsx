import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Alert, Badge, Button, Card, Reveal } from "@restaurant/ui";
import { Section, SectionHeading } from "../components/Section";
import { IconArrowRight, IconHeadset, IconMapPin, IconPhone, IconStore } from "../components/icons";
import { usePageMeta } from "../hooks/usePageMeta";

const REASONS = [
  { value: "starting", label: "I'm interested in starting" },
  { value: "demo", label: "I want a product demo" },
  { value: "support", label: "I have a support question" },
  { value: "multi-location", label: "I manage multiple restaurants" },
  { value: "partnership", label: "Partnership" },
  { value: "general", label: "General question" },
] as const;

const RESTAURANT_TYPES = [
  "Independent restaurant",
  "Café",
  "Takeaway / fast food",
  "Pizzeria",
  "Multi-location group",
  "Other",
] as const;

const inputClass = "rounded-lg border border-border bg-background px-3 py-2 text-sm";

function reasonHelpText(reason: string): string {
  switch (reason) {
    case "starting":
      return "Tell us about your restaurant and what's stopping you from taking orders online today.";
    case "demo":
      return "Let us know what you'd most like to see — the owner dashboard, the storefront, or both.";
    case "support":
      return "Describe what's happening and what you expected instead. If you're already a customer, the in-product help center usually gets you an answer faster.";
    case "multi-location":
      return "Tell us how many locations you run and whether they'd share a menu or need separate ones.";
    case "partnership":
      return "Tell us who you are and what kind of partnership you have in mind.";
    default:
      return "Tell us what's on your mind — as much or as little detail as you like.";
  }
}

export function ContactPage() {
  usePageMeta({
    title: "Contact — Tablecloth",
    description: "Get in touch about starting with Tablecloth, requesting a demo, or getting support for your restaurant.",
  });
  const [submitted, setSubmitted] = useState(false);
  const [name, setName] = useState("");
  const [reason, setReason] = useState<(typeof REASONS)[number]["value"]>("starting");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
  }

  return (
    <>
      <Section className="pt-14 sm:pt-20">
        <SectionHeading
          eyebrow="Company"
          title="Let's build a better ordering experience for your restaurant"
          description="Whether you're just curious, ready to start, or already a customer with a question — tell us what you need and the right person will get back to you."
        />
      </Section>

      <Section tone="surface">
        <div className="mx-auto grid max-w-5xl gap-10 lg:grid-cols-[1fr_1.3fr]">
          <Reveal className="flex flex-col gap-6">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <IconPhone className="h-5 w-5" />
              </span>
              <div>
                <p className="font-medium text-foreground">Response time</p>
                <p className="text-sm text-muted">
                  We reply to every message within one business day — usually much sooner for demo and sales
                  questions.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <IconHeadset className="h-5 w-5" />
              </span>
              <div>
                <p className="font-medium text-foreground">Already a customer?</p>
                <p className="text-sm text-muted">
                  The in-product help center gets you the fastest answer — searchable articles plus a support ticket
                  queue your restaurant's team can see.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <IconStore className="h-5 w-5" />
              </span>
              <div>
                <p className="font-medium text-foreground">Sales &amp; demos</p>
                <p className="text-sm text-muted">
                  Want to see it running before you talk to anyone? Try the{" "}
                  <Link to="/demo" className="font-medium text-primary hover:underline">
                    live demo
                  </Link>{" "}
                  first — most sales conversations start there.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <IconMapPin className="h-5 w-5" />
              </span>
              <div>
                <p className="font-medium text-foreground">Where we work</p>
                <p className="text-sm text-muted">Available to independent restaurants and small groups, wherever you're based.</p>
              </div>
            </div>

            <div className="mt-2 flex flex-col gap-1.5 border-t border-border pt-4 text-sm">
              <Link to="/pricing" className="flex items-center gap-1 font-medium text-primary hover:underline">
                View pricing <IconArrowRight className="h-3.5 w-3.5" />
              </Link>
              <Link to="/faq" className="flex items-center gap-1 font-medium text-primary hover:underline">
                Read the FAQ <IconArrowRight className="h-3.5 w-3.5" />
              </Link>
              <Link to="/start-trial" className="flex items-center gap-1 font-medium text-primary hover:underline">
                Start free <IconArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </Reveal>

          <Reveal index={1}>
            {submitted ? (
              <Alert tone="success" className="flex-col items-start gap-1">
                <p className="font-medium">Thanks{name ? `, ${name.split(" ")[0]}` : ""}!</p>
                <p className="text-sm">We've received your message and will get back to you within one business day.</p>
              </Alert>
            ) : (
              <Card className="flex flex-col gap-4">
                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                  <fieldset className="flex flex-col gap-2">
                    <legend className="mb-0.5 text-sm font-medium text-foreground">What can we help with?</legend>
                    <div className="flex flex-wrap gap-2">
                      {REASONS.map((r) => (
                        <button
                          key={r.value}
                          type="button"
                          onClick={() => setReason(r.value)}
                          className={`rounded-pill border px-3 py-1.5 text-xs font-medium transition-colors duration-fast ${
                            reason === r.value
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border text-foreground/70 hover:bg-black/[0.03]"
                          }`}
                        >
                          {r.label}
                        </button>
                      ))}
                    </div>
                  </fieldset>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="flex flex-col gap-1 text-sm">
                      Your name
                      <input required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="Jamie Rivera" />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      Work email
                      <input required type="email" className={inputClass} placeholder="jamie@yourrestaurant.com" />
                    </label>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="flex flex-col gap-1 text-sm">
                      Business / restaurant name
                      <input className={inputClass} placeholder="The Ember Kitchen" />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      Phone (optional)
                      <input type="tel" className={inputClass} placeholder="(555) 123-4567" />
                    </label>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="flex flex-col gap-1 text-sm">
                      Restaurant type
                      <select className={inputClass} defaultValue={RESTAURANT_TYPES[0]}>
                        {RESTAURANT_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      Number of locations
                      <input type="number" min={1} defaultValue={1} className={inputClass} />
                    </label>
                  </div>

                  <label className="flex flex-col gap-1 text-sm">
                    <span className="flex items-center gap-2">
                      Message
                      <Badge tone="neutral">{REASONS.find((r) => r.value === reason)?.label}</Badge>
                    </span>
                    <textarea required rows={4} className={inputClass} placeholder={reasonHelpText(reason)} />
                    <span className="text-xs text-muted">{reasonHelpText(reason)}</span>
                  </label>

                  <Button type="submit" size="lg">
                    Send message
                  </Button>
                  <p className="text-xs text-muted">
                    This is a preview build — submitting doesn't create an account or send a real message yet. In
                    production, our team follows up directly.
                  </p>
                </form>
              </Card>
            )}
          </Reveal>
        </div>
      </Section>
    </>
  );
}
