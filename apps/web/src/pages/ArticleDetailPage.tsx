import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { KnowledgeBaseArticle } from "@restaurant/types";
import { Card, Skeleton } from "@restaurant/ui";
import { apiClient } from "../lib/api";

interface ArticleResponse {
  article: KnowledgeBaseArticle;
  related: KnowledgeBaseArticle[];
}

export function ArticleDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const [data, setData] = useState<ArticleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    apiClient
      .request<ArticleResponse>(`/kb/articles/${slug}`)
      .then(setData)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card className="mx-auto max-w-2xl text-center text-muted">
        <p>We couldn't find that article.</p>
        <Link to="/support" className="font-medium text-primary hover:opacity-80">
          Back to Support
        </Link>
      </Card>
    );
  }

  const { article, related } = data;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <nav className="animate-fade-up text-sm text-muted" aria-label="Breadcrumb">
        <Link to="/support" className="hover:text-foreground">
          Support
        </Link>{" "}
        / <span className="text-foreground">{article.title}</span>
      </nav>

      <article className="animate-fade-up flex flex-col gap-4" style={{ animationDelay: "60ms" }}>
        <h1 className="font-heading text-2xl font-semibold text-foreground sm:text-3xl">{article.title}</h1>
        <p className="whitespace-pre-wrap leading-relaxed text-foreground/90">{article.content}</p>
      </article>

      {related.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <h2 className="font-medium text-foreground">Related articles</h2>
          <ul className="flex flex-col gap-1">
            {related.map((a) => (
              <li key={a.id}>
                <Link to={`/support/articles/${a.slug}`} className="text-sm font-medium text-primary hover:opacity-80">
                  {a.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
