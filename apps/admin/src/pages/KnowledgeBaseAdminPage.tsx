import { useEffect, useState } from "react";
import type { KnowledgeBaseArticle, KnowledgeBaseCategory } from "@restaurant/types";
import { Badge, Button, Card } from "@restaurant/ui";
import { apiClient } from "../lib/api";

const emptyArticleForm = { id: "", categoryId: "", title: "", slug: "", summary: "", content: "", status: "draft" as "draft" | "published" };

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function KnowledgeBaseAdminPage() {
  const [categories, setCategories] = useState<KnowledgeBaseCategory[]>([]);
  const [articles, setArticles] = useState<KnowledgeBaseArticle[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [categoryName, setCategoryName] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);

  const [articleForm, setArticleForm] = useState(emptyArticleForm);
  const [savingArticle, setSavingArticle] = useState(false);

  function reload() {
    return Promise.all([
      apiClient.request<{ categories: KnowledgeBaseCategory[] }>("/kb/admin/categories"),
      apiClient.request<{ articles: KnowledgeBaseArticle[] }>("/kb/admin/articles"),
    ]).then(([c, a]) => {
      setCategories(c.categories);
      setArticles(a.articles);
    });
  }

  useEffect(() => {
    reload().catch((err) => setError((err as Error).message));
  }, []);

  async function addCategory() {
    if (!categoryName.trim()) return;
    setAddingCategory(true);
    setError(null);
    try {
      await apiClient.request("/kb/admin/categories", {
        method: "POST",
        body: { name: categoryName, slug: slugify(categoryName) },
      });
      setCategoryName("");
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAddingCategory(false);
    }
  }

  function editArticle(article: KnowledgeBaseArticle) {
    setArticleForm({
      id: article.id,
      categoryId: article.categoryId,
      title: article.title,
      slug: article.slug,
      summary: article.summary,
      content: article.content,
      status: article.status,
    });
  }

  async function saveArticle() {
    if (!articleForm.title.trim() || !articleForm.categoryId || !articleForm.summary.trim() || !articleForm.content.trim()) {
      setError("Title, category, summary, and content are all required");
      return;
    }
    setSavingArticle(true);
    setError(null);
    try {
      const body = {
        categoryId: articleForm.categoryId,
        title: articleForm.title,
        slug: articleForm.slug || slugify(articleForm.title),
        summary: articleForm.summary,
        content: articleForm.content,
        status: articleForm.status,
      };
      if (articleForm.id) {
        await apiClient.request(`/kb/admin/articles/${articleForm.id}`, { method: "PATCH", body });
      } else {
        await apiClient.request("/kb/admin/articles", { method: "POST", body });
      }
      setArticleForm(emptyArticleForm);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingArticle(false);
    }
  }

  async function toggleStatus(article: KnowledgeBaseArticle) {
    setError(null);
    try {
      await apiClient.request(`/kb/admin/articles/${article.id}`, {
        method: "PATCH",
        body: { status: article.status === "published" ? "draft" : "published" },
      });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function deleteArticle(article: KnowledgeBaseArticle) {
    if (!window.confirm(`Delete the article "${article.title}"? This can't be undone.`)) return;
    setError(null);
    try {
      await apiClient.request(`/kb/admin/articles/${article.id}`, { method: "DELETE" });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const categoryName2 = (id: string) => categories.find((c) => c.id === id)?.name ?? "—";

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-heading text-2xl font-semibold text-foreground">Knowledge base</h1>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}

      <Card className="flex flex-col gap-2">
        <h2 className="font-medium text-foreground">Categories</h2>
        <ul className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <li key={c.id} className="rounded-pill bg-black/[0.04] px-3 py-1 text-sm text-foreground/80">
              {c.name}
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <input
            value={categoryName}
            onChange={(e) => setCategoryName(e.target.value)}
            placeholder="New category name"
            className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
          />
          <Button size="sm" onClick={addCategory} disabled={addingCategory}>
            Add category
          </Button>
        </div>
      </Card>

      <Card className="flex flex-col gap-2">
        <h2 className="font-medium text-foreground">{articleForm.id ? "Edit article" : "New article"}</h2>
        <div className="grid grid-cols-2 gap-2">
          <select
            value={articleForm.categoryId}
            onChange={(e) => setArticleForm({ ...articleForm, categoryId: e.target.value })}
            className="col-span-2 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
          >
            <option value="">Select a category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            value={articleForm.title}
            onChange={(e) => setArticleForm({ ...articleForm, title: e.target.value })}
            placeholder="Title"
            className="col-span-2 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
          />
          <input
            value={articleForm.summary}
            onChange={(e) => setArticleForm({ ...articleForm, summary: e.target.value })}
            placeholder="Summary (shown in search results)"
            className="col-span-2 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
          />
          <textarea
            value={articleForm.content}
            onChange={(e) => setArticleForm({ ...articleForm, content: e.target.value })}
            rows={6}
            placeholder="Article content"
            className="col-span-2 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
          />
          <select
            value={articleForm.status}
            onChange={(e) => setArticleForm({ ...articleForm, status: e.target.value as "draft" | "published" })}
            className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
          >
            <option value="draft">Draft</option>
            <option value="published">Published</option>
          </select>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={saveArticle} disabled={savingArticle}>
            {articleForm.id ? "Save changes" : "Create article"}
          </Button>
          {articleForm.id && (
            <Button size="sm" variant="ghost" onClick={() => setArticleForm(emptyArticleForm)}>
              Cancel
            </Button>
          )}
        </div>
      </Card>

      <Card className="flex flex-col gap-2">
        <h2 className="font-medium text-foreground">All articles</h2>
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-border text-muted">
              <th className="py-2 font-medium">Title</th>
              <th className="font-medium">Category</th>
              <th className="font-medium">Status</th>
              <th className="font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="text-foreground/80">
            {articles.map((a) => (
              <tr key={a.id} className="border-b border-border">
                <td className="py-2 text-foreground">{a.title}</td>
                <td>{categoryName2(a.categoryId)}</td>
                <td>
                  <Badge tone={a.status === "published" ? "success" : "neutral"}>{a.status}</Badge>
                </td>
                <td className="flex gap-2 py-2">
                  <button onClick={() => editArticle(a)} className="text-foreground/70 underline hover:text-foreground">
                    Edit
                  </button>
                  <button onClick={() => toggleStatus(a)} className="text-foreground/70 underline hover:text-foreground">
                    {a.status === "published" ? "Unpublish" : "Publish"}
                  </button>
                  <button onClick={() => deleteArticle(a)} className="text-danger underline">
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
