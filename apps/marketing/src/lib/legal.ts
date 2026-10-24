// Phase 88 — the founder-supplied facts the legal pages (Terms, Privacy, Refund) state. They are
// build-time configuration, never invented in code:
//
//   VITE_LEGAL_ENTITY_NAME         the legal entity that operates GarnishTable
//   VITE_LEGAL_JURISDICTION        governing law for the Terms (e.g. a state/country)
//   VITE_LEGAL_CONTACT_EMAIL       contact for questions about the Terms
//   VITE_PRIVACY_CONTACT_EMAIL     contact for privacy requests
//   VITE_BILLING_CONTACT_EMAIL     contact for billing/refund questions
//
// A production build with SOME but not all of them, or a placeholder/malformed value, refuses to
// run (vite.config.ts via legalConfig.mjs, and check-build-env.sh for the image); with NONE it
// builds and the pages show "Legal documents are being finalized" (Phase 89, option C). The image
// build also scans its output for leftover placeholder tokens (check-build-output.sh) — so
// production can never publish "[LEGAL_ENTITY_NAME]". Local development still shows the bracketed
// markers, so the gap stays visible while writing copy.

export const LEGAL_CONFIG_VARIABLES = [
  "VITE_LEGAL_ENTITY_NAME",
  "VITE_LEGAL_JURISDICTION",
  "VITE_LEGAL_CONTACT_EMAIL",
  "VITE_PRIVACY_CONTACT_EMAIL",
  "VITE_BILLING_CONTACT_EMAIL",
] as const;

/**
 * Phase 89 (option C) — true only when ALL five values are present. A production build without
 * them still builds (vite.config.ts warns loudly; partial/placeholder/malformed values still fail),
 * and each legal page then shows LegalPendingNotice instead of its document — never placeholders,
 * never invented text. Kept visible as a launch blocker via /version.json's legalConfigured flag and
 * the smoke test's warning.
 */
export const LEGAL_CONFIGURED = Boolean(
  import.meta.env.VITE_LEGAL_ENTITY_NAME?.trim() &&
    import.meta.env.VITE_LEGAL_JURISDICTION?.trim() &&
    import.meta.env.VITE_LEGAL_CONTACT_EMAIL?.trim() &&
    import.meta.env.VITE_PRIVACY_CONTACT_EMAIL?.trim() &&
    import.meta.env.VITE_BILLING_CONTACT_EMAIL?.trim() &&
    import.meta.env.VITE_LEGAL_REVIEW_APPROVED?.trim().toLowerCase() === "true"
);

/** Production stays pending until legal facts and explicit review approval are present. */
export const SHOW_LEGAL_PENDING_NOTICE = !LEGAL_CONFIGURED && !import.meta.env.DEV;

function configured(value: string | undefined, devMarker: string): string {
  return value?.trim() || devMarker;
}

// The markers sit inside `import.meta.env.DEV ? … : ""`, which a production build compiles to "",
// so the strings never reach the production bundle (check-build-output.sh verifies). Production
// builds fail earlier anyway when a value is missing (vite.config.ts).
export const LEGAL = {
  entityName: configured(import.meta.env.VITE_LEGAL_ENTITY_NAME, import.meta.env.DEV ? "[LEGAL_ENTITY_NAME]" : ""),
  jurisdiction: configured(import.meta.env.VITE_LEGAL_JURISDICTION, import.meta.env.DEV ? "[GOVERNING_JURISDICTION]" : ""),
  legalEmail: configured(import.meta.env.VITE_LEGAL_CONTACT_EMAIL, import.meta.env.DEV ? "[LEGAL_CONTACT_EMAIL]" : ""),
  privacyEmail: configured(import.meta.env.VITE_PRIVACY_CONTACT_EMAIL, import.meta.env.DEV ? "[PRIVACY_CONTACT_EMAIL]" : ""),
  billingEmail: configured(import.meta.env.VITE_BILLING_CONTACT_EMAIL, import.meta.env.DEV ? "[BILLING_CONTACT_EMAIL]" : ""),
};
