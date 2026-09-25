import { useState } from "react";
import type { MenuImportDraftRow, MenuImportJobDetail, MenuImportReviewCategory, MenuImportUserAction } from "@restaurant/types";
import { Badge, Button } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import { useActiveLocationId } from "../../context/LocationContext";
import { useRestaurantCurrency } from "../../hooks/useRestaurantCurrency";
import { updateMenuImportDraftRow, type UpdateMenuImportDraftRowPatch } from "../../lib/menuImportJobs";
import { IconAlertTriangle, IconCheck, IconChevronDown } from "../icons";

const REVIEW_LABEL: Record<MenuImportReviewCategory, string> = {
  looks_good: "Looks good",
  check_this: "Check this",
  missing: "Missing",
  needs_review: "Needs review",
};
const REVIEW_TONE: Record<MenuImportReviewCategory, "success" | "warning" | "danger" | "neutral"> = {
  looks_good: "success",
  check_this: "warning",
  missing: "danger",
  needs_review: "warning",
};

const DUPLICATE_ACTION_LABEL: Record<MenuImportUserAction, string> = {
  create: "Create new anyway",
  update: "Replace existing",
  merge: "Fill in gaps only",
  skip: "Skip — keep existing",
};

const inputClass = "rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground";

function ImportReviewRow({
  row,
  expanded,
  onToggle,
  onSave,
  saving,
  currency,
}: {
  row: MenuImportDraftRow;
  expanded: boolean;
  onToggle: () => void;
  onSave: (patch: UpdateMenuImportDraftRowPatch) => Promise<void>;
  saving: boolean;
  currency: string;
}) {
  const [draft, setDraft] = useState({
    itemName: row.itemName,
    description: row.description ?? "",
    price: row.price !== undefined ? String(row.price) : "",
    categoryName: row.categoryName,
  });

  async function handleSave() {
    await onSave({
      itemName: draft.itemName,
      description: draft.description || undefined,
      price: draft.price ? Number(draft.price) : undefined,
      categoryName: draft.categoryName,
    });
  }

  return (
    <div className="flex flex-col">
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-fast hover:bg-black/[0.02]">
        <span className={`flex h-2 w-2 shrink-0 rounded-full ${row.reviewCategory === "looks_good" ? "bg-success" : row.reviewCategory === "missing" ? "bg-danger" : "bg-warning"}`} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-foreground">{row.itemName || "(no name)"}</span>
          {row.description && <span className="block truncate text-xs text-muted">{row.description}</span>}
        </span>
        <span className="shrink-0 text-sm text-foreground/80">{row.price !== undefined ? formatCurrency(row.price, currency) : "—"}</span>
        {row.modifierGroups.length > 0 && (
          <span className="shrink-0 text-xs text-muted">
            {row.modifierGroups.length} add-on{row.modifierGroups.length === 1 ? "" : "s"}
          </span>
        )}
        {row.matchedItemId && <Badge tone="info">possible duplicate</Badge>}
        <Badge tone={REVIEW_TONE[row.reviewCategory]}>{REVIEW_LABEL[row.reviewCategory]}</Badge>
        <IconChevronDown className={`h-4 w-4 shrink-0 text-muted transition-transform duration-fast ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded && (
        <div className="flex flex-col gap-3 border-t border-border bg-black/[0.015] px-4 py-4">
          {row.issues.length > 0 && (
            <div className="flex flex-col gap-1">
              {row.issues.map((issue, i) => (
                <p key={i} className="flex items-center gap-1.5 text-xs text-danger">
                  <IconAlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  {issue.message}
                </p>
              ))}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">Item name</span>
              <input value={draft.itemName} onChange={(e) => setDraft((d) => ({ ...d, itemName: e.target.value }))} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">Category</span>
              <input value={draft.categoryName} onChange={(e) => setDraft((d) => ({ ...d, categoryName: e.target.value }))} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">Price</span>
              <input type="number" min="0" step="0.01" value={draft.price} onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">Description</span>
              <textarea value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} rows={2} className={inputClass} />
            </label>
          </div>

          {row.modifierGroups.length > 0 && (
            <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-background p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Add-ons found</p>
              {row.modifierGroups.map((group) => (
                <div key={group.name} className="text-sm">
                  <span className="font-medium text-foreground">{group.name}</span>
                  <ul className="ml-4 list-disc text-xs text-muted">
                    {group.options.map((o) => (
                      <li key={o.name}>
                        {o.name}
                        {o.priceAdjustment ? ` +${formatCurrency(o.priceAdjustment, currency)}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {row.matchedItemId && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">This looks like an existing item — what should publish do?</span>
              <div className="flex flex-wrap gap-2">
                {(["skip", "update", "merge", "create"] as MenuImportUserAction[]).map((action) => (
                  <button
                    key={action}
                    type="button"
                    onClick={() => onSave({ userAction: action })}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors duration-fast ${
                      (row.userAction ?? "skip") === action
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-foreground/70 hover:bg-black/[0.04] hover:text-foreground"
                    }`}
                  >
                    {DUPLICATE_ACTION_LABEL[action]}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
            {row.reviewedAt && (
              <span className="flex items-center gap-1 text-xs text-success">
                <IconCheck className="h-3 w-3" /> Reviewed
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function ImportReviewList({
  job,
  onJobUpdated,
  onPublish,
  publishing,
}: {
  job: MenuImportJobDetail;
  onJobUpdated: (job: MenuImportJobDetail) => void;
  onPublish: (defaultDuplicateStrategy: "skip" | "update" | "merge") => void;
  publishing: boolean;
}) {
  const restaurantId = useActiveLocationId();
  const currency = useRestaurantCurrency();
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [savingRow, setSavingRow] = useState<number | null>(null);
  const [defaultStrategy, setDefaultStrategy] = useState<"skip" | "update" | "merge">("skip");

  const rowsByCategory = new Map<string, MenuImportDraftRow[]>();
  for (const row of job.draftRows) {
    const key = row.categoryName || "Uncategorized";
    const list = rowsByCategory.get(key) ?? [];
    list.push(row);
    rowsByCategory.set(key, list);
  }

  const readyCount = job.draftRows.filter((r) => r.reviewCategory === "looks_good").length;
  const needsAttentionCount = job.draftRows.length - readyCount;
  const duplicateCount = job.draftRows.filter((r) => r.matchedItemId).length;

  async function saveRowPatch(rowNumber: number, patch: UpdateMenuImportDraftRowPatch) {
    if (!restaurantId) return;
    setSavingRow(rowNumber);
    try {
      const updated = await updateMenuImportDraftRow(restaurantId, job.id, rowNumber, patch);
      onJobUpdated(updated);
    } finally {
      setSavingRow(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-xl border border-border bg-surface p-5">
        <h2 className="font-heading text-lg font-semibold text-foreground">
          {job.draftRows.length} item{job.draftRows.length === 1 ? "" : "s"} found
        </h2>
        <p className="mt-1 text-sm text-muted">
          <span className="font-medium text-success">{readyCount} ready</span>
          {needsAttentionCount > 0 && (
            <>
              {" · "}
              <span className="font-medium text-warning">{needsAttentionCount} need a look</span>
            </>
          )}
          {duplicateCount > 0 && (
            <>
              {" · "}
              <span className="font-medium text-foreground/80">
                {duplicateCount} possible duplicate{duplicateCount === 1 ? "" : "s"}
              </span>
            </>
          )}
        </p>
      </div>

      {[...rowsByCategory.entries()].map(([categoryName, rows]) => (
        <div key={categoryName} className="flex flex-col gap-2">
          <h3 className="font-heading text-sm font-semibold uppercase tracking-wide text-muted">{categoryName}</h3>
          <div className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface">
            {rows.map((row) => (
              <ImportReviewRow
                key={row.rowNumber}
                row={row}
                currency={currency}
                expanded={expandedRow === row.rowNumber}
                onToggle={() => setExpandedRow(expandedRow === row.rowNumber ? null : row.rowNumber)}
                onSave={(patch) => saveRowPatch(row.rowNumber, patch)}
                saving={savingRow === row.rowNumber}
              />
            ))}
          </div>
        </div>
      ))}

      <div className="sticky bottom-4 flex flex-col gap-3 rounded-xl border border-border bg-surface p-5 shadow-elevated">
        <div>
          <p className="text-sm font-medium text-foreground">For any duplicate you haven't reviewed individually:</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {(["skip", "update", "merge"] as const).map((strategy) => (
              <button
                key={strategy}
                type="button"
                onClick={() => setDefaultStrategy(strategy)}
                className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors duration-fast ${
                  defaultStrategy === strategy ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/70 hover:bg-black/[0.04] hover:text-foreground"
                }`}
              >
                {strategy === "skip" ? "Skip (recommended)" : strategy === "update" ? "Replace" : "Fill in gaps only"}
              </button>
            ))}
          </div>
        </div>
        <Button onClick={() => onPublish(defaultStrategy)} disabled={publishing || job.draftRows.length === 0}>
          {publishing ? "Publishing…" : "Publish to my menu"}
        </Button>
      </div>
    </div>
  );
}
