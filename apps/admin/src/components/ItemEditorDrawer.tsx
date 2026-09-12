import { useEffect, useRef, useState } from "react";
import type { Category, MenuItemLocationOverride } from "@restaurant/types";
import { Badge, Button } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import { ModifierGroupsEditor } from "./ModifierGroupsEditor";
import { uploadRestaurantImage } from "../lib/uploads";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { IconArrowLeft, IconImage } from "./icons";

const inputClass = "rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground";

export interface ItemDraft {
  name: string;
  description: string;
  price: string;
  categoryId: string;
  imageUrl: string;
  isAvailable: boolean;
}

interface ItemEditorDrawerProps {
  /** Controls the slide-in transition. The component stays mounted regardless (see the doc
   *  comment on its call site in MenuManagementPage.tsx) so the transition actually has a "closed"
   *  frame to animate from — a component that only mounts once already open never gets to play its
   *  own entrance animation. */
  open: boolean;
  mode: "create" | "edit";
  draft: ItemDraft | null;
  setDraft: (draft: ItemDraft) => void;
  categories: Category[];
  saving: boolean;
  justSaved: boolean;
  saveDraft: () => void;
  closePanel: () => void;
  businessId: string;
  restaurantId: string;
  expandedItemId: string | null;
  override?: MenuItemLocationOverride;
  onSaveOverride: (patch: { priceOverride?: number; isAvailable?: boolean }) => void;
  onResetOverride: () => void;
  currency: string;
}

/**
 * Phase 69 — the Menu Builder's item editor, replacing Phase 68's inline expand-in-place panel
 * with a focused slide-over (full-screen on mobile). The underlying data flow is unchanged: the
 * same draft/mode/save/override contract MenuManagementPage already owned, just presented as a
 * dedicated "content editor" experience — large photo dropzone, plain-language fields, a live
 * preview card on wide viewports, and a "Customize this item" section that hosts
 * ModifierGroupsEditor rather than a bare form.
 */
export function ItemEditorDrawer({
  open,
  mode,
  draft,
  setDraft,
  categories,
  saving,
  justSaved,
  saveDraft,
  closePanel,
  businessId,
  restaurantId,
  expandedItemId,
  override,
  onSaveOverride,
  onResetOverride,
  currency,
}: ItemEditorDrawerProps) {
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [priceOverrideDraft, setPriceOverrideDraft] = useState(override?.priceOverride != null ? String(override.priceOverride) : "");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPriceOverrideDraft(override?.priceOverride != null ? String(override.priceOverride) : "");
  }, [override?.priceOverride]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closePanel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Traps Tab/Shift+Tab inside the drawer while open, focuses the name field on open, and returns
  // focus to whatever triggered the drawer (the row's Edit button, or + Add menu item) on close.
  useFocusTrap(panelRef, open, { initialFocusRef: nameInputRef });

  async function handleImageUpload(file: File | undefined) {
    if (!file || !draft) return;
    setUploadingImage(true);
    setUploadError(null);
    try {
      const url = await uploadRestaurantImage(restaurantId, "menuItemImage", file);
      setDraft({ ...draft, imageUrl: url });
    } catch (err) {
      setUploadError((err as Error).message);
    } finally {
      setUploadingImage(false);
    }
  }

  const effectiveAvailable = override?.isAvailable ?? draft?.isAvailable ?? true;
  const categoryName = draft ? categories.find((c) => c.id === draft.categoryId)?.name : undefined;

  return (
    <>
      <div
        aria-hidden
        onClick={closePanel}
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-normal ease-premium ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="item-editor-title"
        className={`fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-surface shadow-elevated transition-transform duration-normal ease-premium sm:max-w-3xl lg:max-w-4xl ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-8">
          <button
            type="button"
            onClick={closePanel}
            aria-label="Back to menu"
            className="flex items-center gap-1.5 rounded-lg py-1 text-sm font-medium text-foreground/70 transition-colors duration-fast hover:text-foreground"
          >
            <IconArrowLeft className="h-4 w-4" />
            Menu
          </button>
          <div className="text-xs font-medium text-muted" role="status" aria-live="polite">
            {saving ? "Saving…" : justSaved ? "✓ Saved" : ""}
          </div>
        </div>

        {draft && (
          <>
            <div className="px-5 pt-5 sm:px-8">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                {mode === "create" ? "New menu item" : "Edit item"}
              </p>
              <h2 id="item-editor-title" className="truncate font-heading text-2xl font-semibold text-foreground">
                {draft.name || "New item"}
              </h2>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-6 sm:px-8">
              <div className="grid gap-10 lg:grid-cols-[1.5fr_1fr]">
                {/* Main editing column */}
                <div className="flex flex-col gap-8">
                  {/* Photo */}
                  <div className="flex flex-col gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      disabled={uploadingImage}
                      onChange={(e) => handleImageUpload(e.target.files?.[0])}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        handleImageUpload(e.dataTransfer.files?.[0]);
                      }}
                      className="group relative flex h-52 w-full items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-border bg-background text-center transition-colors duration-fast hover:border-primary/40"
                    >
                      {draft.imageUrl ? (
                        <img src={draft.imageUrl} alt="" className="h-full w-full object-cover transition-transform duration-normal ease-premium group-hover:scale-[1.03]" />
                      ) : (
                        <span className="flex flex-col items-center gap-1.5 text-muted">
                          <IconImage className="h-6 w-6" />
                          <span className="text-sm font-medium text-foreground">Add a food photo</span>
                          <span className="text-xs">Drag &amp; drop, or click to choose</span>
                        </span>
                      )}
                      {uploadingImage && (
                        <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-sm font-medium text-white">
                          Uploading…
                        </span>
                      )}
                    </button>
                    {draft.imageUrl && (
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="text-sm font-medium text-primary transition-colors duration-fast hover:underline"
                        >
                          Replace photo
                        </button>
                        <button
                          type="button"
                          onClick={() => setDraft({ ...draft, imageUrl: "" })}
                          className="text-sm font-medium text-danger transition-colors duration-fast hover:underline"
                        >
                          Remove
                        </button>
                      </div>
                    )}
                    {uploadError && <p className="text-xs text-danger">{uploadError}</p>}
                  </div>

                  {/* Basics */}
                  <div className="flex flex-col gap-4">
                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted">Item name</span>
                      <input
                        ref={nameInputRef}
                        value={draft.name}
                        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                        placeholder="Name"
                        className={`font-heading text-lg ${inputClass}`}
                      />
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted">Description</span>
                      <textarea
                        value={draft.description}
                        onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                        placeholder="Tell customers what's in it"
                        rows={3}
                        className={inputClass}
                      />
                    </label>
                    <div className="flex flex-wrap gap-4">
                      <label className="flex flex-col gap-1.5">
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Price</span>
                        <div className="relative">
                          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={draft.price}
                            onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                            placeholder="Base price"
                            className={`w-36 pl-6 ${inputClass}`}
                          />
                        </div>
                      </label>
                      <label className="flex flex-1 flex-col gap-1.5">
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Category</span>
                        <select
                          value={draft.categoryId}
                          onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}
                          className={inputClass}
                        >
                          {categories.length === 0 && <option value="">Add a category first</option>}
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>

                  {/* Options / modifiers */}
                  {/* A single div holding both the section heading and ModifierGroupsEditor — e2e
                      specs scope to `locator("div", {hasText: "Customize this item"}).last()` and
                      expect that scope to also contain the modifier controls below the heading. */}
                  {mode === "edit" && expandedItemId && (
                    <div className="flex flex-col gap-3 border-t border-border pt-6">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Customize this item</p>
                      <p className="text-sm text-muted">
                        Sizes and add-ons customers can choose — canonical for every location, with optional per-location overrides.
                      </p>
                      <ModifierGroupsEditor businessId={businessId} restaurantId={restaurantId} menuItemId={expandedItemId} currency={currency} />
                    </div>
                  )}
                  {mode === "create" && (
                    <p className="border-t border-border pt-6 text-sm text-muted">
                      Save this item first, then this same editor lets you add sizes, toppings, and other options.
                    </p>
                  )}

                  {/* Availability */}
                  <div className="flex flex-col gap-3 border-t border-border pt-6">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">Availability</p>
                    <label className="flex items-center gap-2 text-sm text-foreground">
                      <input
                        type="checkbox"
                        checked={draft.isAvailable}
                        onChange={(e) => setDraft({ ...draft, isAvailable: e.target.checked })}
                      />
                      Available to customers (every location, unless overridden below)
                    </label>

                    {mode === "edit" && (
                      <div className="rounded-lg border border-dashed border-border p-3.5">
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">This location only</p>
                        <div className="flex flex-wrap items-center gap-3">
                          {override ? <Badge tone="info">Overridden here</Badge> : <Badge tone="neutral">Using business default</Badge>}
                          <label className="flex items-center gap-1.5 text-sm text-foreground">
                            Price
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={priceOverrideDraft}
                              onChange={(e) => setPriceOverrideDraft(e.target.value)}
                              placeholder={formatCurrency(Number(draft.price) || 0, currency)}
                              className={`w-32 ${inputClass}`}
                            />
                          </label>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              onSaveOverride({
                                priceOverride: priceOverrideDraft ? Number(priceOverrideDraft) : undefined,
                                isAvailable: effectiveAvailable,
                              })
                            }
                            disabled={!priceOverrideDraft}
                          >
                            Save price here
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onSaveOverride({ isAvailable: !effectiveAvailable, priceOverride: override?.priceOverride })}
                          >
                            {effectiveAvailable ? "Hide only at this location" : "Show only at this location"}
                          </Button>
                          {override && (
                            <Button size="sm" variant="ghost" onClick={onResetOverride}>
                              Reset to canonical
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Live preview column — real draft data, not a duplicate storefront renderer */}
                <div className="hidden lg:flex lg:flex-col lg:gap-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">Preview</p>
                  <div className="overflow-hidden rounded-xl border border-border bg-background">
                    <div className="flex aspect-[4/3] w-full items-center justify-center bg-black/[0.04]">
                      {draft.imageUrl ? (
                        <img src={draft.imageUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <IconImage className="h-8 w-8 text-muted" />
                      )}
                    </div>
                    <div className="flex flex-col gap-1.5 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-heading text-base font-semibold text-foreground">{draft.name || "Item name"}</p>
                        <p className="shrink-0 font-medium text-foreground">{formatCurrency(Number(draft.price) || 0, currency)}</p>
                      </div>
                      {draft.description && <p className="text-sm text-muted">{draft.description}</p>}
                      {categoryName && <p className="text-xs uppercase tracking-wide text-muted">{categoryName}</p>}
                      <span className="mt-1 flex w-fit items-center gap-1.5 text-xs font-medium">
                        <span className={`h-1.5 w-1.5 rounded-full ${effectiveAvailable ? "bg-success" : "bg-muted"}`} />
                        <span className={effectiveAvailable ? "text-success" : "text-muted"}>
                          {effectiveAvailable ? "Available" : "Unavailable"}
                        </span>
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-muted">A simple preview of how this item's core details will read — not a full storefront render.</p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 border-t border-border px-5 py-4 sm:px-8">
              <Button onClick={saveDraft} disabled={saving || !draft.name.trim() || !draft.price || !draft.categoryId}>
                {saving ? "Saving…" : mode === "create" ? "Create item & continue" : "Save item"}
              </Button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
