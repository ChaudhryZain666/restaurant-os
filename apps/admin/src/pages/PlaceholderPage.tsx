import { Link } from "react-router-dom";
import { Card } from "@restaurant/ui";

function ConstructionIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6" aria-hidden>
      <path d="M12 3v4M4.2 8.2l2.8 2.8M2 15h4M18 15h4M16.9 11l2.9-2.9M8 21h8M9 17h6l-1-6H10z" />
    </svg>
  );
}

/**
 * A richer "not built yet" state than a bare EmptyState: explains what the feature will do, why it
 * matters, and — critically — what's already available today that gets a restaurant most of the way
 * there, so this doesn't read as a dead end.
 */
export function PlaceholderPage({
  title,
  description,
  whyItMatters,
  availableNow,
}: {
  title: string;
  description: string;
  whyItMatters?: string;
  availableNow?: { label: string; to: string }[];
}) {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-heading text-2xl font-semibold text-foreground">{title}</h1>
      <Card className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ConstructionIcon />
          </span>
          <div className="flex flex-col gap-1">
            <p className="font-medium text-foreground">Not built yet — on our roadmap</p>
            <p className="text-sm text-muted">{description}</p>
          </div>
        </div>
        {whyItMatters && (
          <p className="border-t border-border pt-3 text-sm text-muted">
            <span className="font-medium text-foreground">Why it matters: </span>
            {whyItMatters}
          </p>
        )}
        {availableNow && availableNow.length > 0 && (
          <div className="border-t border-border pt-3">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
              Available today instead
            </p>
            <ul className="flex flex-col gap-1">
              {availableNow.map((item) => (
                <li key={item.to}>
                  <Link to={item.to} className="text-sm font-medium text-primary hover:underline">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}
