import { useState, type FormEvent } from "react";
import { Alert, Button, Card } from "@restaurant/ui";
import { apiClient } from "../lib/api";

const ROLES = ["Restaurant owner", "Restaurant manager", "Agency", "Multi-location operator", "Other"] as const;
const INTERESTS = [
  "Online ordering",
  "Menu management",
  "Delivery",
  "Analytics",
  "Multi-location",
  "Agency management",
  "Integrations",
] as const;

const inputClass = "rounded-lg border border-border bg-background px-3 py-2 text-sm";

/**
 * Phase 56 — a real lead-capture form: submits to POST /public/contact (an internal-notification
 * email, not account creation — see contact.controller.ts). Previously client-side-only
 * (setSubmitted(true), no network call at all) per an earlier phase's own comment claiming "there
 * is no self-service 'create a restaurant' API on the backend" — that's no longer true (see
 * OwnerSignupWizardPage.tsx/StartTrialPage.tsx's real /signup flow), but this form was never a
 * disguised account-creation attempt either way: it always captured interest for a human follow-up,
 * which is exactly what it now genuinely does. Still never pretends to create an account — the
 * disclaimer below stays, just made accurate (a message is actually sent now).
 */
export function LeadForm({
  submitLabel,
  successTitle,
  successBody,
  showRestaurantField = true,
  qualification = false,
}: {
  submitLabel: string;
  successTitle: string;
  successBody: string;
  showRestaurantField?: boolean;
  /** Adds role, restaurant count, and interest fields — for sales/demo-qualification contexts. */
  qualification?: boolean;
}) {
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<string>(ROLES[0]);
  const [locationCount, setLocationCount] = useState(1);
  const [interests, setInterests] = useState<string[]>([]);
  const [message, setMessage] = useState("");

  function toggleInterest(value: string) {
    setInterests((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiClient.request("/public/contact", {
        method: "POST",
        body: {
          name,
          email,
          businessName: showRestaurantField ? businessName : undefined,
          phone: phone || undefined,
          role: qualification ? role : undefined,
          locationCount: qualification ? locationCount : undefined,
          interests: qualification && interests.length > 0 ? interests : undefined,
          message: message || undefined,
        },
      });
      setSubmitted(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <Alert tone="success" className="flex-col items-start gap-1">
        <p className="font-medium">
          {successTitle}
          {name ? `, ${name.split(" ")[0]}` : ""}!
        </p>
        <p className="text-sm">{successBody}</p>
      </Alert>
    );
  }

  return (
    <Card className="flex flex-col gap-4">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && (
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        )}
        <label className="flex flex-col gap-1 text-sm">
          Your name
          <input required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="Jamie Rivera" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Work email
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
            placeholder="jamie@yourrestaurant.com"
          />
        </label>
        {showRestaurantField && (
          <label className="flex flex-col gap-1 text-sm">
            Restaurant / company
            <input
              required
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              className={inputClass}
              placeholder="The Ember Kitchen"
            />
          </label>
        )}
        <label className="flex flex-col gap-1 text-sm">
          Phone (optional)
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} placeholder="(555) 123-4567" />
        </label>

        {qualification && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                Role
                <select value={role} onChange={(e) => setRole(e.target.value)} className={inputClass}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Number of restaurants
                <input
                  type="number"
                  min={1}
                  value={locationCount}
                  onChange={(e) => setLocationCount(Number(e.target.value) || 1)}
                  className={inputClass}
                />
              </label>
            </div>

            <fieldset className="flex flex-col gap-1.5 text-sm">
              <legend className="mb-0.5">What would you like to see?</legend>
              <div className="grid grid-cols-2 gap-1.5">
                {INTERESTS.map((item) => (
                  <label key={item} className="flex items-center gap-1.5 text-xs text-foreground/80">
                    <input type="checkbox" checked={interests.includes(item)} onChange={() => toggleInterest(item)} />
                    {item}
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="flex flex-col gap-1 text-sm">
              Anything else? (optional)
              <textarea
                rows={3}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className={inputClass}
                placeholder="Tell us a bit more about what you're looking for."
              />
            </label>
          </>
        )}

        <Button type="submit" size="lg" disabled={submitting}>
          {submitting ? "Sending..." : submitLabel}
        </Button>
        <p className="text-xs text-muted">
          Submitting sends your message to our team — it doesn't create an account. We'll follow up by email.
        </p>
      </form>
    </Card>
  );
}
