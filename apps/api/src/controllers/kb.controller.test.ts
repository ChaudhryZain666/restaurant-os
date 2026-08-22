import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import type { HydratedDocument } from "mongoose";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { User } from "../models/User.js";
import {
  KnowledgeBaseArticle,
  KnowledgeBaseCategory,
  type KnowledgeBaseArticleDoc,
  type KnowledgeBaseCategoryDoc,
} from "../models/KnowledgeBase.js";
import { closeTestConnections, createTestUser, tokenFor } from "../test-utils/fixtures.js";

const app = createApp();

let category: HydratedDocument<KnowledgeBaseCategoryDoc>;
let publishedArticle: HydratedDocument<KnowledgeBaseArticleDoc>;
let draftArticle: HydratedDocument<KnowledgeBaseArticleDoc>;
let adminToken: string;
let ownerToken: string;
let adminId: string;
let ownerId: string;

beforeAll(async () => {
  await connectDB();
  category = await KnowledgeBaseCategory.create({ name: "Menu", slug: `menu-${Date.now()}`, sortOrder: 0 });
  publishedArticle = await KnowledgeBaseArticle.create({
    categoryId: category._id,
    title: "How to add a menu item",
    slug: `add-menu-item-${Date.now()}`,
    summary: "Steps to add a new menu item to your restaurant",
    content: "Go to Menu, click Add item, fill in the details, and save.",
    status: "published",
    publishedAt: new Date(),
  });
  draftArticle = await KnowledgeBaseArticle.create({
    categoryId: category._id,
    title: "Upcoming feature preview",
    slug: `draft-preview-${Date.now()}`,
    summary: "Not ready yet",
    content: "This is still being written.",
    status: "draft",
  });

  const admin = await createTestUser("platform_admin");
  const owner = await createTestUser("restaurant_owner");
  adminToken = tokenFor(admin);
  ownerToken = tokenFor(owner);
  adminId = admin.id;
  ownerId = owner.id;
});

afterAll(async () => {
  await Promise.all([
    KnowledgeBaseArticle.deleteMany({ categoryId: category._id }),
    KnowledgeBaseCategory.deleteOne({ _id: category._id }),
    User.deleteMany({ _id: { $in: [adminId, ownerId] } }),
  ]);
  await closeTestConnections();
});

describe("public knowledge base", () => {
  it("published articles are visible publicly, unauthenticated", async () => {
    const res = await request(app).get("/api/v1/kb/articles");
    expect(res.status).toBe(200);
    expect(res.body.data.articles.some((a: { slug: string }) => a.slug === publishedArticle.slug)).toBe(true);
  });

  it("draft articles are NOT visible in the public list", async () => {
    const res = await request(app).get("/api/v1/kb/articles");
    expect(res.status).toBe(200);
    expect(res.body.data.articles.some((a: { slug: string }) => a.slug === draftArticle.slug)).toBe(false);
  });

  it("a draft article's detail page returns 404, not 403 — its existence is not discoverable", async () => {
    const res = await request(app).get(`/api/v1/kb/articles/${draftArticle.slug}`);
    expect(res.status).toBe(404);
  });

  it("a published article's detail page is publicly visible with its full content", async () => {
    const res = await request(app).get(`/api/v1/kb/articles/${publishedArticle.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.data.article.content).toContain("Add item");
  });

  it("search finds the published article by its content", async () => {
    const res = await request(app).get("/api/v1/kb/articles?q=menu item");
    expect(res.status).toBe(200);
    expect(res.body.data.articles.some((a: { slug: string }) => a.slug === publishedArticle.slug)).toBe(true);
  });

  it("search never surfaces a draft article", async () => {
    const res = await request(app).get("/api/v1/kb/articles?q=upcoming feature");
    expect(res.status).toBe(200);
    expect(res.body.data.articles.some((a: { slug: string }) => a.slug === draftArticle.slug)).toBe(false);
  });
});

describe("knowledge base admin access control", () => {
  it("rejects an unauthenticated request to the admin article list", async () => {
    const res = await request(app).get("/api/v1/kb/admin/articles");
    expect(res.status).toBe(401);
  });

  it("rejects a restaurant_owner (no support.knowledgebase.write) from the admin article list", async () => {
    const res = await request(app).get("/api/v1/kb/admin/articles").set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(403);
  });

  it("platform_admin sees both draft and published articles in the admin list", async () => {
    const res = await request(app).get("/api/v1/kb/admin/articles").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const slugs = res.body.data.articles.map((a: { slug: string }) => a.slug);
    expect(slugs).toContain(publishedArticle.slug);
    expect(slugs).toContain(draftArticle.slug);
  });

  it("platform_admin can create, publish, and delete an article", async () => {
    const createRes = await request(app)
      .post("/api/v1/kb/admin/articles")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        categoryId: category.id,
        title: "Test article",
        slug: `test-article-${Date.now()}`,
        summary: "A test article",
        content: "Test content",
        status: "draft",
      });
    expect(createRes.status).toBe(201);
    const articleId = createRes.body.data.article.id;

    const publishRes = await request(app)
      .patch(`/api/v1/kb/admin/articles/${articleId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "published" });
    expect(publishRes.status).toBe(200);
    expect(publishRes.body.data.article.status).toBe("published");
    expect(publishRes.body.data.article.publishedAt).toEqual(expect.any(String));

    const deleteRes = await request(app)
      .delete(`/api/v1/kb/admin/articles/${articleId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(deleteRes.status).toBe(204);
  });

  it("rejects deleting a category that still has articles", async () => {
    const res = await request(app)
      .delete(`/api/v1/kb/admin/categories/${category.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(409);
  });
});
