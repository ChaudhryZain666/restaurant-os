import { useEffect, useState } from "react";
import { formatCurrency } from "@restaurant/utils";
import { Button } from "@restaurant/ui";
import { apiClient } from "../../lib/api";
import { IconArrowLeft, IconPlus, IconSearch, IconUsers, IconX } from "../../components/icons";
import type { CustomerHit } from "../types";

export interface WalkInDraft {
  name: string;
  phone: string;
  email: string;
}

/**
 * A dedicated sheet, not the original PosPage's two small "Existing / New walk-in" toggle buttons
 * squeezed into the order panel — same two paths (search GET /restaurants/:id/customers, or a
 * walk-in the server resolves/creates in posCustomer.service.ts), same data, just given the room
 * to be fast: autofocused search, live results with visit history, one-tap walk-in continue, and
 * "add new" inline without ever leaving this sheet.
 */
export function CustomerPicker({
  restaurantId,
  currency,
  selectedCustomer,
  onSelectExisting,
  onContinueAsWalkIn,
  onClose,
}: {
  restaurantId: string;
  currency: string;
  selectedCustomer: CustomerHit | null;
  onSelectExisting: (customer: CustomerHit) => void;
  onContinueAsWalkIn: (draft: WalkInDraft) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<CustomerHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingNew, setAddingNew] = useState(false);
  const [draft, setDraft] = useState<WalkInDraft>({ name: "", phone: "", email: "" });

  useEffect(() => {
    if (search.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ page: "1", limit: "10", search: search.trim() });
      apiClient
        .request<{ items: CustomerHit[] }>(`/restaurants/${restaurantId}/customers?${params}`)
        .then((res) => setResults(res.items))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 280);
    return () => clearTimeout(timer);
  }, [restaurantId, search]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-secondary/40 backdrop-blur-[2px]" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Choose a customer"
        className="flex h-full w-full max-w-sm flex-col bg-surface shadow-elevated"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border p-5">
          {addingNew ? (
            <button onClick={() => setAddingNew(false)} className="flex items-center gap-1.5 text-sm font-medium text-muted hover:text-foreground">
              <IconArrowLeft className="h-4 w-4" /> Back
            </button>
          ) : (
            <h2 className="font-heading text-xl font-semibold text-foreground">Customer</h2>
          )}
          <button onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-black/[0.04] hover:text-foreground">
            <IconX className="h-4 w-4" />
          </button>
        </div>

        {addingNew ? (
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-5">
            <p className="text-sm text-muted">A real customer profile is created for this sale — not a throwaway.</p>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-foreground">Name</span>
              <input
                autoFocus
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                placeholder="Full name"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-foreground">Phone (optional)</span>
              <input
                value={draft.phone}
                onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                placeholder="+1 555 0100"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-foreground">Email (optional)</span>
              <input
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                placeholder="name@example.com"
              />
            </label>
            <Button disabled={!draft.name.trim()} onClick={() => onContinueAsWalkIn(draft)} className="mt-2">
              Use this customer
            </Button>
          </div>
        ) : (
          <>
            <div className="border-b border-border p-5 pb-4">
              <div className="relative">
                <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name, phone or email"
                  className="h-11 w-full rounded-xl border border-border bg-background pl-10 pr-3.5 text-sm text-foreground focus-visible:border-primary"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5 pt-3">
              {selectedCustomer && (
                <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5">
                  <div>
                    <p className="text-sm font-medium text-foreground">{selectedCustomer.name}</p>
                    <p className="text-xs text-muted">Currently selected</p>
                  </div>
                  <button onClick={onClose} className="text-xs font-medium text-primary hover:underline">
                    Done
                  </button>
                </div>
              )}

              {search.trim().length < 2 ? (
                <p className="pt-2 text-sm text-muted">Type at least 2 characters to search.</p>
              ) : searching ? (
                <p className="pt-2 text-sm text-muted">Searching...</p>
              ) : results.length === 0 ? (
                <p className="pt-2 text-sm text-muted">No matching customers.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {results.map((c) => (
                    <li key={c.customerId}>
                      <button
                        onClick={() => onSelectExisting(c)}
                        className="flex w-full items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-left transition-colors duration-fast hover:border-primary/40 hover:bg-primary/5"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
                          {c.name.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-foreground">{c.name}</span>
                          <span className="block truncate text-xs text-muted">{c.phone ?? c.email}</span>
                        </span>
                        {typeof c.totalOrders === "number" && c.totalOrders > 0 && (
                          <span className="shrink-0 text-right text-xs text-muted">
                            {c.totalOrders} order{c.totalOrders === 1 ? "" : "s"}
                            {typeof c.totalSpent === "number" && <><br />{formatCurrency(c.totalSpent, currency)}</>}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex flex-col gap-2 border-t border-border p-5">
              <Button variant="outline" onClick={() => setAddingNew(true)} className="justify-start gap-2">
                <IconPlus className="h-4 w-4" /> Add a new customer
              </Button>
              <Button variant="ghost" onClick={() => onContinueAsWalkIn({ name: "Walk-in", phone: "", email: "" })} className="justify-start gap-2">
                <IconUsers className="h-4 w-4" /> Continue without a name
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
