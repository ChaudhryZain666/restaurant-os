export const ARTICLE_STATUSES = ["draft", "published"] as const;
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];

export interface KnowledgeBaseCategory {
  id: string;
  name: string;
  slug: string;
  description?: string;
  sortOrder: number;
  isActive: boolean;
}

export interface KnowledgeBaseArticle {
  id: string;
  categoryId: string;
  title: string;
  slug: string;
  summary: string;
  content: string;
  status: ArticleStatus;
  sortOrder: number;
  authorId?: string;
  authorName?: string;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}
