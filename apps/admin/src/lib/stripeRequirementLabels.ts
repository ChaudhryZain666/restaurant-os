/**
 * Phase 78 — translates Stripe Connect's `requirements.currently_due` codes (raw dot-separated
 * strings like `individual.verification.document`) into plain language for a non-technical
 * restaurant owner. Never render the raw code: Stripe's own taxonomy is large and evolving, so
 * this is a best-effort map with a safe generic fallback for anything unmapped — coverage of the
 * common cases, not a claim of completeness.
 */
const STRIPE_REQUIREMENT_LABELS: Record<string, string> = {
  "individual.verification.document": "Verify your identity with a photo ID",
  "individual.verification.additional_document": "Provide an additional identity document",
  "individual.id_number": "Add your government-issued ID number",
  "individual.dob.day": "Add your date of birth",
  "individual.address.line1": "Add your home address",
  "individual.phone": "Add your phone number",
  "company.verification.document": "Verify your business with a registration document",
  "company.tax_id": "Add your business tax ID",
  "company.address.line1": "Add your business address",
  "business_profile.url": "Add your business website or a description of what you sell",
  "business_profile.mcc": "Tell Stripe what category your business falls under",
  "external_account": "Add a bank account for payouts",
  "tos_acceptance.date": "Accept Stripe's terms of service",
};

const GENERIC_FALLBACK = "Additional information needed";

export function describeStripeRequirement(code: string): string {
  return STRIPE_REQUIREMENT_LABELS[code] ?? GENERIC_FALLBACK;
}
