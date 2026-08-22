import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { KnowledgeBaseArticle, KnowledgeBaseCategory } from "@restaurant/types";
import { Button, Card, EmptyState, Reveal, Skeleton } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useRestaurant } from "../context/RestaurantContext";

function SearchGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className} aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.4-3.4" strokeLinecap="round" />
    </svg>
  );
}

export function SupportCenterPage() {
  const { user } = useAuth();
  const { supportIdentity } = useRestaurant();
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get("q") ?? "";
  const categorySlug = searchParams.get("category") ?? "";

  const [categories, setCategories] = useState<KnowledgeBaseCategory[]>([]);
  const [articles, setArticles] = useState<KnowledgeBaseArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [queryInput, setQueryInput] = useState(q);

  useEffect(() => {
    apiClient.request<{ categories: KnowledgeBaseCategory[] }>("/kb/categories").then((data) => setCategories(data.categories));
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (categorySlug) params.set("category", categorySlug);
    apiClient
      .request<{ articles: KnowledgeBaseArticle[] }>(`/kb/articles?${params.toString()}`)
      .then((data) => setArticles(data.articles))
      .finally(() => setLoading(false));
  }, [q, categorySlug]);

  function submitSearch() {
    setSearchParams(queryInput ? { q: queryInput } : {});
  }

  const activeCategory = categories.find((c) => c.slug === categorySlug);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="animate-fade-up text-center">
        <h1 className="font-heading text-3xl font-semibold text-foreground">{supportIdentity?.name ?? "Support"}</h1>
        <p className="mt-1 text-muted">Search our help center or browse by topic.</p>
      </div>

      <form
        className="animate-fade-up flex gap-2"
        style={{ animationDelay: "60ms" }}
        onSubmit={(e) => {
          e.preventDefault();
          submitSearch();
        }}
      >
        <div className="relative flex-1">
          <SearchGlyph className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            placeholder="Search for help..."
            className="w-full rounded-pill border border-border bg-surface py-2.5 pl-9 pr-3 shadow-sm"
          />
        </div>
        <Button type="submit">Search</Button>
      </form>

      {!q && (
        <div className="flex flex-wrap justify-center gap-2">
          <button
            onClick={() => setSearchParams({})}
            className={`rounded-pill px-3.5 py-1.5 text-sm font-medium transition-colors duration-fast ${
              !categorySlug ? "bg-primary text-primary-foreground" : "bg-black/[0.04] text-foreground hover:bg-black/[0.08]"
            }`}
          >
            All
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setSearchParams({ category: c.slug })}
              className={`rounded-pill px-3.5 py-1.5 text-sm font-medium transition-colors duration-fast ${
                categorySlug === c.slug ? "bg-primary text-primary-foreground" : "bg-black/[0.04] text-foreground hover:bg-black/[0.08]"
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {q && (
        <p className="text-sm text-muted">
          {articles.length} result{articles.length === 1 ? "" : "s"} for "{q}"
        </p>
      )}
      {activeCategory && !q && <h2 className="text-lg font-medium text-foreground">{activeCategory.name}</h2>}

      {loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : articles.length === 0 ? (
        <EmptyState icon={<SearchGlyph className="h-6 w-6" />} title="No articles found" description="Try a different search, or contact us below." />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {articles.map((a, i) => (
            <Reveal index={i} key={a.id}>
              <Link to={`/support/articles/${a.slug}`}>
                <Card className="flex h-full flex-col gap-1 transition-shadow duration-normal hover:shadow-md">
                  <h3 className="font-medium text-foreground">{a.title}</h3>
                  <p className="text-sm text-muted">{a.summary}</p>
                </Card>
              </Link>
            </Reveal>
          ))}
        </div>
      )}

      <Card className="flex flex-col items-center gap-2 py-8 text-center">
        <p className="text-foreground">Still need help?</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Link to="/support/tickets/new">
            <Button>Contact {supportIdentity?.name ?? "support"}</Button>
          </Link>
          {user && (
            <Link to="/support/tickets">
              <Button variant="secondary">My tickets</Button>
            </Link>
          )}
        </div>
      </Card>
    </div>
  );
}
