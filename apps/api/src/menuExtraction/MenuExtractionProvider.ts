/**
 * Phase 81 — provider-agnostic menu-extraction capability, mirroring apps/api/src/payments/
 * PaymentProvider.ts's exact shape (one interface, every controller/service talks only to it,
 * provider-specific code stays isolated in one adapter file). Extraction from PDF/images/HTML is
 * modeled as a single `extract()` method over a discriminated-union input, since all three sources
 * ultimately become one call to the same underlying model with different content shapes — a
 * unified method keeps extractionPipeline.service.ts source-agnostic, branching once at
 * input-construction time rather than at every provider call site.
 */

export type MenuExtractionInput =
  | { kind: "pdf"; buffer: Buffer; fileName: string }
  /** Ordered — index 0 is page/photo 1. Preserving this order end-to-end (never re-sorted between
   *  upload and extraction) is how multi-page/multi-photo ordering is preserved. */
  | { kind: "images"; buffers: Buffer[]; fileNames: string[]; mimeTypes: string[] }
  | { kind: "html"; html: string; sourceUrl: string };

export interface ExtractedFieldConfidence {
  field: string;
  score: number;
}

export interface ExtractedModifierOption {
  name: string;
  priceAdjustment?: number;
}

export interface ExtractedModifierGroup {
  name: string;
  minSelect?: number;
  maxSelect?: number;
  options: ExtractedModifierOption[];
}

export interface ExtractedRow {
  categoryName: string;
  itemName: string;
  description?: string;
  /** A raw string, not a number — deliberately: the extraction result is untrusted input like any
   *  other import source, and extractionResultToRows.ts runs it through the SAME price-parsing
   *  guard normalizeRows.ts already uses for CSV, rather than trusting a provider-returned number
   *  to already be clean. */
  price?: string;
  isAvailable?: boolean;
  imageUrl?: string;
  modifierGroups?: ExtractedModifierGroup[];
  overallConfidence: number;
  fieldConfidence: ExtractedFieldConfidence[];
  /** 1-based — which input page/image this row was read from. Absent for "html" input. */
  sourcePageIndex?: number;
}

export interface MenuExtractionResult {
  rows: ExtractedRow[];
  /** Provider-reported, for input the model couldn't confidently read at all (e.g. an illegible
   *  scan) — surfaces as a job-level warning, never a thrown error on its own. */
  warnings: string[];
  modelUsed: string;
}

export type MenuExtractionErrorCode =
  | "timeout"
  | "invalid_credentials"
  | "provider_unavailable"
  | "not_configured"
  | "provider_error"
  // Phase 89 — finer outcomes, so the job runner can tell a temporary failure from a permanent one.
  | "rate_limited"
  | "quota_exceeded"
  | "rejected"
  | "refused"
  | "incomplete"
  | "invalid_source";

/** Phase 89 — codes whose failure won't change by trying the exact same request again: retrying
 *  would only repeat a paid call. Everything else (timeouts, provider outages, rate limits, a
 *  garbled response) is worth BullMQ's retry with backoff. */
const PERMANENT_CODES: ReadonlySet<MenuExtractionErrorCode> = new Set([
  "invalid_credentials",
  "not_configured",
  "quota_exceeded",
  "rejected",
  "refused",
  "incomplete",
  "invalid_source",
]);

export class MenuExtractionError extends Error {
  /** Whether trying the same extraction again could succeed. Defaults from the code; an adapter can
   *  override it when the code alone doesn't say (e.g. a generic provider_error on an HTTP 400). */
  readonly retryable: boolean;

  constructor(
    message: string,
    public readonly code: MenuExtractionErrorCode,
    options: { retryable?: boolean } = {}
  ) {
    super(message);
    this.name = "MenuExtractionError";
    this.retryable = options.retryable ?? !PERMANENT_CODES.has(code);
  }
}

export interface MenuExtractionProvider {
  readonly name: string;
  extract(input: MenuExtractionInput): Promise<MenuExtractionResult>;
}
