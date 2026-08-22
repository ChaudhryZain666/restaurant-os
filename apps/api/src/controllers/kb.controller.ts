import type { Request, Response } from "express";
import type { KbArticleInput, KbCategoryInput, UpdateKbArticleInput, UpdateKbCategoryInput } from "@restaurant/validation";
import { KnowledgeBaseArticle, KnowledgeBaseCategory } from "../models/KnowledgeBase.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";

export async function listCategories(_req: Request, res: Response) {
  const categories = await KnowledgeBaseCategory.find({ isActive: true }).sort({ sortOrder: 1, name: 1 });
  sendSuccess(res, { categories: categories.map((c) => c.toJSON()) });
}

export async function listAllCategories(_req: Request, res: Response) {
  const categories = await KnowledgeBaseCategory.find().sort({ sortOrder: 1, name: 1 });
  sendSuccess(res, { categories: categories.map((c) => c.toJSON()) });
}

export async function createCategory(req: Request, res: Response) {
  const body = req.body as KbCategoryInput;
  const category = await KnowledgeBaseCategory.create(body);
  sendSuccess(res, { category: category.toJSON() }, 201);
}

export async function updateCategory(req: Request, res: Response) {
  const updates = req.body as UpdateKbCategoryInput;
  const category = await KnowledgeBaseCategory.findOneAndUpdate(
    { _id: req.params.id },
    { $set: updates },
    { new: true, runValidators: true }
  );
  if (!category) throw ApiError.notFound("Category not found");
  sendSuccess(res, { category: category.toJSON() });
}

export async function deleteCategory(req: Request, res: Response) {
  const articleCount = await KnowledgeBaseArticle.countDocuments({ categoryId: req.params.id });
  if (articleCount > 0) {
    throw ApiError.conflict("Move or delete this category's articles before deleting it");
  }
  const category = await KnowledgeBaseCategory.findOneAndDelete({ _id: req.params.id });
  if (!category) throw ApiError.notFound("Category not found");
  res.status(204).send();
}

interface ArticleQuery {
  categoryId?: string;
  status?: "draft" | "published";
  $text?: { $search: string };
}

/** Public, published-only. Never distinguishes "doesn't exist" from "exists but unpublished" — see getArticleBySlug. */
export async function listPublicArticles(req: Request, res: Response) {
  const { category, q } = req.query as { category?: string; q?: string };
  const query: ArticleQuery = { status: "published" };

  if (category) {
    const categoryDoc = await KnowledgeBaseCategory.findOne({ slug: category });
    if (!categoryDoc) {
      sendSuccess(res, { articles: [] });
      return;
    }
    query.categoryId = categoryDoc.id;
  }
  if (q) query.$text = { $search: q };

  const articles = await KnowledgeBaseArticle.find(query)
    .select("-content")
    .sort(q ? { score: { $meta: "textScore" } } : { sortOrder: 1, title: 1 });
  sendSuccess(res, { articles: articles.map((a) => a.toJSON()) });
}

export async function getPublicArticle(req: Request, res: Response) {
  const article = await KnowledgeBaseArticle.findOne({ slug: req.params.slug, status: "published" });
  // Same 404 whether the slug doesn't exist at all or exists but is unpublished — a draft's
  // existence must never be discoverable from the public endpoint.
  if (!article) throw ApiError.notFound("Article not found");

  const related = await KnowledgeBaseArticle.find({
    categoryId: article.categoryId,
    status: "published",
    _id: { $ne: article._id },
  })
    .select("-content")
    .sort({ sortOrder: 1 })
    .limit(4);

  sendSuccess(res, { article: article.toJSON(), related: related.map((a) => a.toJSON()) });
}

export async function listAdminArticles(req: Request, res: Response) {
  const { category, status, q } = req.query as { category?: string; status?: "draft" | "published"; q?: string };
  const query: ArticleQuery = {};
  if (category) query.categoryId = category;
  if (status) query.status = status;
  if (q) query.$text = { $search: q };

  const articles = await KnowledgeBaseArticle.find(query)
    .select("-content")
    .sort(q ? { score: { $meta: "textScore" } } : { updatedAt: -1 });
  sendSuccess(res, { articles: articles.map((a) => a.toJSON()) });
}

export async function getAdminArticle(req: Request, res: Response) {
  const article = await KnowledgeBaseArticle.findById(req.params.id);
  if (!article) throw ApiError.notFound("Article not found");
  sendSuccess(res, { article: article.toJSON() });
}

export async function createArticle(req: Request, res: Response) {
  const body = req.body as KbArticleInput;
  const categoryExists = await KnowledgeBaseCategory.exists({ _id: body.categoryId });
  if (!categoryExists) throw ApiError.badRequest("Unknown categoryId");

  const article = await KnowledgeBaseArticle.create({
    ...body,
    authorId: req.user!.id,
    publishedAt: body.status === "published" ? new Date() : undefined,
  });
  sendSuccess(res, { article: article.toJSON() }, 201);
}

export async function updateArticle(req: Request, res: Response) {
  const updates = req.body as UpdateKbArticleInput;
  if (updates.categoryId) {
    const categoryExists = await KnowledgeBaseCategory.exists({ _id: updates.categoryId });
    if (!categoryExists) throw ApiError.badRequest("Unknown categoryId");
  }

  const existing = await KnowledgeBaseArticle.findById(req.params.id, "status publishedAt");
  if (!existing) throw ApiError.notFound("Article not found");

  // publishedAt is set the first time an article transitions into "published", and left alone
  // on every subsequent edit (including unpublish/republish) — it should read as "first went
  // live", not "last saved".
  const setPublishedAt = updates.status === "published" && existing.status !== "published" && !existing.publishedAt;

  const article = await KnowledgeBaseArticle.findByIdAndUpdate(
    req.params.id,
    { $set: { ...updates, ...(setPublishedAt ? { publishedAt: new Date() } : {}) } },
    { new: true, runValidators: true }
  );
  if (!article) throw ApiError.notFound("Article not found");
  sendSuccess(res, { article: article.toJSON() });
}

export async function deleteArticle(req: Request, res: Response) {
  const article = await KnowledgeBaseArticle.findByIdAndDelete(req.params.id);
  if (!article) throw ApiError.notFound("Article not found");
  res.status(204).send();
}
