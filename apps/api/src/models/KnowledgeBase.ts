import { Schema, model, type InferSchemaType } from "mongoose";
import { idTransform } from "../utils/schemaOptions.js";

// Platform-wide, not restaurant-scoped: the knowledge base documents the platform product
// itself (menu management, orders, settings, ...), not any individual restaurant's content.
const knowledgeBaseCategorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    description: { type: String, maxlength: 500 },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: idTransform }
);

const ARTICLE_STATUSES = ["draft", "published"] as const;

const knowledgeBaseArticleSchema = new Schema(
  {
    categoryId: { type: Schema.Types.ObjectId, ref: "KnowledgeBaseCategory", required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    summary: { type: String, required: true, maxlength: 300 },
    content: { type: String, required: true },
    // No standalone index: the compound index below already covers status-only queries via its
    // leading-field prefix.
    status: { type: String, enum: ARTICLE_STATUSES, default: "draft" },
    sortOrder: { type: Number, default: 0 },
    authorId: { type: Schema.Types.ObjectId, ref: "User" },
    publishedAt: { type: Date },
  },
  { timestamps: true, toJSON: idTransform }
);

// Public browse/search only ever filters status:"published" plus optionally categoryId — this
// compound index covers that query directly. A separate text index powers free-text search.
knowledgeBaseArticleSchema.index({ status: 1, categoryId: 1, sortOrder: 1 });
knowledgeBaseArticleSchema.index({ title: "text", summary: "text", content: "text" });

export type KnowledgeBaseCategoryDoc = InferSchemaType<typeof knowledgeBaseCategorySchema>;
export const KnowledgeBaseCategory = model<KnowledgeBaseCategoryDoc>(
  "KnowledgeBaseCategory",
  knowledgeBaseCategorySchema
);

export type KnowledgeBaseArticleDoc = InferSchemaType<typeof knowledgeBaseArticleSchema>;
export const KnowledgeBaseArticle = model<KnowledgeBaseArticleDoc>(
  "KnowledgeBaseArticle",
  knowledgeBaseArticleSchema
);
