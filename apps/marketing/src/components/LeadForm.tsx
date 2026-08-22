import { useState, type FormEvent } from "react";
import { Alert, Button, Card } from "@restaurant/ui";

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
 * A client-side-only lead-capture form. There is no self-service "create a restaurant" API on
 * the backend (only a platform_admin can create a tenant — see RBAC), and this phase is
 * explicitly frontend-only, so this intentionally does NOT call any backend endpoint or pretend
 * to provision an account. It just captures interest and shows an honest confirmation state.
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
  const [name, setName] = useState("");
  const [interests, setInterests] = useState<string[]>([]);

  function toggleInterest(value: string) {
    setInterests((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
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
        <label className="flex flex-col gap-1 text-sm">
          Your name
          <input required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="Jamie Rivera" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Work email
          <input required type="email" className={inputClass} placeholder="jamie@yourrestaurant.com" />
        </label>
        {showRestaurantField && (
          <label className="flex flex-col gap-1 text-sm">
            Restaurant / company
            <input required className={inputClass} placeholder="The Ember Kitchen" />
          </label>
        )}
        <label className="flex flex-col gap-1 text-sm">
          Phone (optional)
          <input type="tel" className={inputClass} placeholder="(555) 123-4567" />
        </label>

        {qualification && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                Role
                <select className={inputClass} defaultValue={ROLES[0]}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Number of restaurants
                <input type="number" min={1} defaultValue={1} className={inputClass} />
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
              <textarea rows={3} className={inputClass} placeholder="Tell us a bit more about what you're looking for." />
            </label>
          </>
        )}

        <Button type="submit" size="lg">
          {submitLabel}
        </Button>
        <p className="text-xs text-muted">
          This is a preview build — submitting doesn't create an account yet. In production, our team follows up to
          finish setting up your restaurant.
        </p>
      </form>
    </Card>
  );
}
