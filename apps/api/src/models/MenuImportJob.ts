import { Schema, model, Types } from "mongoose";
import { idTransform } from "../utils/schemaOptions.js";

/**
 * Phase 81 — the async menu-import pipeline's job/state record (PDF/URL/image sources), a sibling
 * to the existing synchronous CSV/XLSX importer (services/menuImport/), never a replacement for
 * it. Explicit hand-written interface, not InferSchemaType — same reason as ModifierGroup.ts:
 * `draftRows` is a subdocument array whose entries need a stable identifier across polls/edits
 * (reuses `rowNumber`, assigned once at extraction and never renumbered, matching the CSV
 * pipeline's own convention) — the class of type this codebase's InferSchemaType usage already
 * documents it cannot flatten cleanly.
 *
 * Draft/review state lives HERE, not on the menu itself (Category/MenuItem/ModifierGroup) — see
 * docs/menu-import-architecture.md's Phase 81 addendum. A menu import is a one-shot batch of
 * proposed changes, not a persistent alternate menu state (the only existing draft/publish
 * precedent, Restaurant.themeDraft, works because there's exactly one "live" theme per restaurant —
 * a menu import has no such single-slot shape). Manual menu editing via menu.controller.ts/
 * category.controller.ts/modifier.controller.ts is completely unaffected by this model's existence.
 */
export interface MenuImportSourceFileRef {
  storageKey: string;
  originalFileName: string;
  contentType: string;
  sizeBytes: number;
  /** 1-based — preserves multi-page/photo ordering. Assigned once at upload from multipart field
   *  order, never reassigned; extractionPipeline.service.ts must never reorder this array. */
  order: number;
}

export interface MenuImportFieldConfidenceSubdoc {
  field: string;
  score: number;
}

export interface MenuImportDraftModifierOptionSubdoc {
  name: string;
  priceAdjustment: number;
}

export interface MenuImportDraftModifierGroupSubdoc {
  name: string;
  minSelect: number;
  maxSelect: number;
  options: MenuImportDraftModifierOptionSubdoc[];
}

export interface MenuImportRowIssueSubdoc {
  field?: string;
  message: string;
}

export type MenuImportJobStatus =
  | "pending"
  | "processing"
  | "extracting"
  | "normalizing"
  | "ready_for_review"
  | "publishing"
  | "completed"
  | "failed"
  | "cancelled";

export type MenuImportSourceType = "pdf" | "image" | "images" | "url";

export interface MenuImportJobProgressSubdoc {
  stage: MenuImportJobStatus;
  percent: number;
  currentUnit?: number;
  totalUnits?: number;
  message?: string;
}

export interface MenuImportDraftRowSubdoc {
  rowNumber: number;
  categoryName: string;
  itemName: string;
  description?: string;
  price?: number;
  isAvailable: boolean;
  sortOrder: number;
  imageUrl?: string;
  modifierGroups: MenuImportDraftModifierGroupSubdoc[];
  issues: MenuImportRowIssueSubdoc[];
  overallConfidence: number;
  fieldConfidence: MenuImportFieldConfidenceSubdoc[];
  reviewCategory: "looks_good" | "check_this" | "missing" | "needs_review";
  sourcePageIndex?: number;
  /** What resolveImport() (re-run fresh at publish time, never trusted stale) would do absent any
   *  reviewer override. Computed at extraction time for initial display, RECOMPUTED at publish. */
  systemAction: "create" | "update" | "skip" | "error";
  matchedItemId?: Types.ObjectId;
  userAction?: "create" | "update" | "merge" | "skip";
  reviewedAt?: Date;
}

export interface MenuImportCategorySummarySubdoc {
  name: string;
  status: "existing" | "new";
  itemCount: number;
}

export interface MenuImportJobErrorSubdoc {
  message: string;
  stage: MenuImportJobStatus;
  occurredAt: Date;
}

export interface MenuImportJobDoc {
  _id: Types.ObjectId;
  /** The initiating location — always set, even for a canonical-business-scoped job. */
  restaurantId: Types.ObjectId;
  /** Set via resolveImportScope(), same canonical-vs-legacy resolution CSV commit already uses. */
  businessId?: Types.ObjectId;
  requestedByUserId: Types.ObjectId;
  sourceType: MenuImportSourceType;
  /** url jobs only — the original user-submitted URL (post-validation, pre-fetch). */
  sourceUrl?: string;
  sourceFiles: MenuImportSourceFileRef[];
  status: MenuImportJobStatus;
  progress: MenuImportJobProgressSubdoc;
  draftRows: MenuImportDraftRowSubdoc[];
  categories: MenuImportCategorySummarySubdoc[];
  extractionProviderName?: string;
  extractionModel?: string;
  error?: MenuImportJobErrorSubdoc;
  /** Denormalized from BullMQ's own attempt counter — lets a status read reflect retry state
   *  without a second Redis round-trip. */
  attempts: number;
  publishedReport?: {
    importId: string;
    totalRows: number;
    created: number;
    updated: number;
    skipped: number;
    errors: number;
    categoriesCreated: number;
    modifierGroupsCreated: number;
    modifierOptionsCreated: number;
  };
  publishedAt?: Date;
  cancelledAt?: Date;
  /** Set the moment the job enters a terminal state — the retention sweep's own query target. The
   *  job document itself (draft rows, confidence, report) is kept indefinitely, same as AuditLog;
   *  only the raw uploaded source bytes are perishable. See menuImportRetention.service.ts. */
  sourceRetentionDeleteAt?: Date;
  sourceFilesDeletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const menuImportFieldConfidenceSchema = new Schema<MenuImportFieldConfidenceSubdoc>(
  { field: { type: String, required: true }, score: { type: Number, required: true, min: 0, max: 1 } },
  { _id: false }
);

const menuImportDraftModifierOptionSchema = new Schema<MenuImportDraftModifierOptionSubdoc>(
  { name: { type: String, required: true }, priceAdjustment: { type: Number, required: true, min: 0 } },
  { _id: false }
);

const menuImportDraftModifierGroupSchema = new Schema<MenuImportDraftModifierGroupSubdoc>(
  {
    name: { type: String, required: true },
    minSelect: { type: Number, required: true, min: 0 },
    maxSelect: { type: Number, required: true, min: 1 },
    options: { type: [menuImportDraftModifierOptionSchema], required: true },
  },
  { _id: false }
);

const menuImportRowIssueSchema = new Schema<MenuImportRowIssueSubdoc>(
  { field: { type: String }, message: { type: String, required: true } },
  { _id: false }
);

const menuImportDraftRowSchema = new Schema<MenuImportDraftRowSubdoc>(
  {
    rowNumber: { type: Number, required: true },
    categoryName: { type: String, required: true },
    itemName: { type: String, required: true },
    description: { type: String },
    price: { type: Number },
    isAvailable: { type: Boolean, required: true, default: true },
    sortOrder: { type: Number, required: true, default: 0 },
    imageUrl: { type: String },
    modifierGroups: { type: [menuImportDraftModifierGroupSchema], default: [] },
    issues: { type: [menuImportRowIssueSchema], default: [] },
    overallConfidence: { type: Number, required: true, min: 0, max: 1 },
    fieldConfidence: { type: [menuImportFieldConfidenceSchema], default: [] },
    reviewCategory: { type: String, enum: ["looks_good", "check_this", "missing", "needs_review"], required: true },
    sourcePageIndex: { type: Number },
    systemAction: { type: String, enum: ["create", "update", "skip", "error"], required: true },
    matchedItemId: { type: Schema.Types.ObjectId, ref: "MenuItem" },
    userAction: { type: String, enum: ["create", "update", "merge", "skip"] },
    reviewedAt: { type: Date },
  },
  { _id: false }
);

const menuImportCategorySummarySchema = new Schema<MenuImportCategorySummarySubdoc>(
  { name: { type: String, required: true }, status: { type: String, enum: ["existing", "new"], required: true }, itemCount: { type: Number, required: true } },
  { _id: false }
);

const menuImportSourceFileSchema = new Schema<MenuImportSourceFileRef>(
  {
    storageKey: { type: String, required: true },
    originalFileName: { type: String, required: true },
    contentType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    order: { type: Number, required: true },
  },
  { _id: false }
);

const menuImportJobSchema = new Schema<MenuImportJobDoc>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true },
    businessId: { type: Schema.Types.ObjectId, ref: "Business" },
    requestedByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    sourceType: { type: String, enum: ["pdf", "image", "images", "url"], required: true },
    sourceUrl: { type: String },
    sourceFiles: { type: [menuImportSourceFileSchema], default: [] },
    status: {
      type: String,
      enum: ["pending", "processing", "extracting", "normalizing", "ready_for_review", "publishing", "completed", "failed", "cancelled"],
      required: true,
      default: "pending",
    },
    progress: {
      type: new Schema<MenuImportJobProgressSubdoc>(
        {
          stage: { type: String, required: true },
          percent: { type: Number, required: true, default: 0 },
          currentUnit: { type: Number },
          totalUnits: { type: Number },
          message: { type: String },
        },
        { _id: false }
      ),
      required: true,
      default: () => ({ stage: "pending", percent: 0 }),
    },
    draftRows: { type: [menuImportDraftRowSchema], default: [] },
    categories: { type: [menuImportCategorySummarySchema], default: [] },
    extractionProviderName: { type: String },
    extractionModel: { type: String },
    error: {
      type: new Schema<MenuImportJobErrorSubdoc>(
        { message: { type: String, required: true }, stage: { type: String, required: true }, occurredAt: { type: Date, required: true } },
        { _id: false }
      ),
    },
    attempts: { type: Number, required: true, default: 0 },
    publishedReport: {
      type: new Schema(
        {
          importId: { type: String, required: true },
          totalRows: { type: Number, required: true },
          created: { type: Number, required: true },
          updated: { type: Number, required: true },
          skipped: { type: Number, required: true },
          errors: { type: Number, required: true },
          categoriesCreated: { type: Number, required: true },
          modifierGroupsCreated: { type: Number, required: true },
          modifierOptionsCreated: { type: Number, required: true },
        },
        { _id: false }
      ),
    },
    publishedAt: { type: Date },
    cancelledAt: { type: Date },
    sourceRetentionDeleteAt: { type: Date },
    sourceFilesDeletedAt: { type: Date },
  },
  { timestamps: true, toJSON: idTransform }
);

menuImportJobSchema.index({ restaurantId: 1, createdAt: -1 });
menuImportJobSchema.index({ businessId: 1, createdAt: -1 });
// Ops/stuck-job queries (e.g. a support investigation into a job that never left "extracting") —
// not a functional dependency of the pipeline itself, which always loads a job by _id.
menuImportJobSchema.index({ status: 1, createdAt: 1 });
// Backs menuImportRetention.service.ts's sweep query. Not a Mongo TTL index — the job document is
// kept indefinitely (same audit-history precedent as AuditLog); only sourceFiles are swept, via an
// explicit, logged, retryable cron tick, never silent Mongo-driven document deletion.
menuImportJobSchema.index({ sourceRetentionDeleteAt: 1, sourceFilesDeletedAt: 1 });

export const MenuImportJob = model<MenuImportJobDoc>("MenuImportJob", menuImportJobSchema);
