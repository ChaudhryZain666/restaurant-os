import { useEffect, useState } from "react";
import type { ModifierGroup, ModifierGroupLocationOverride, ModifierOption } from "@restaurant/types";
import { Alert, Badge, Button } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import { apiClient } from "../lib/api";
import { IconSliders, IconX } from "./icons";

const inputClass = "rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground";

interface Props {
  businessId: string;
  restaurantId: string;
  menuItemId: string;
  currency: string;
}

type DraftOption = Pick<ModifierOption, "name" | "priceAdjustment" | "sortOrder" | "isActive">;

function canonicalBasePath(businessId: string, menuItemId: string) {
  return `/businesses/${businessId}/menu/${menuItemId}/modifiers`;
}

function overridePath(restaurantId: string, menuItemId: string, groupId: string) {
  return `/restaurants/${restaurantId}/menu/${menuItemId}/modifiers/${groupId}/override`;
}

export function ModifierGroupsEditor({ businessId, restaurantId, menuItemId, currency }: Props) {
  const [groups, setGroups] = useState<ModifierGroup[]>([]);
  const [overrides, setOverrides] = useState<ModifierGroupLocationOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupMin, setNewGroupMin] = useState(0);
  const [newGroupMax, setNewGroupMax] = useState(1);
  // Phase 69 — the "+ Add option group" affordance is a reveal, not an always-visible form (the
  // Menu Builder redesign's progressive-disclosure principle). justCreatedGroupId is the one piece
  // of state that decides which GroupCard mounts pre-expanded (see defaultExpanded below) — a
  // brand-new group needs its default "Option 1" renamed immediately, so it shouldn't start
  // collapsed into a summary the user would have to re-open.
  const [showNewGroupForm, setShowNewGroupForm] = useState(false);
  const [justCreatedGroupId, setJustCreatedGroupId] = useState<string | null>(null);

  async function reload() {
    const [{ modifierGroups }, overridesRes] = await Promise.all([
      apiClient.request<{ modifierGroups: ModifierGroup[] }>(canonicalBasePath(businessId, menuItemId)),
      apiClient.request<{ modifierGroupOverrides: ModifierGroupLocationOverride[] }>(`/restaurants/${restaurantId}/menu/overrides`),
    ]);
    setGroups(modifierGroups);
    // The combined endpoint returns every override this location has, across every menu item —
    // filter down to just this item's groups client-side rather than adding a menuItemId query
    // param to a deliberately simple, sparse-by-design endpoint.
    const groupIds = new Set(modifierGroups.map((g) => g.id));
    setOverrides(overridesRes.modifierGroupOverrides.filter((o) => groupIds.has(o.modifierGroupId)));
  }

  useEffect(() => {
    setLoading(true);
    reload()
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuItemId]);

  async function createGroup() {
    if (!newGroupName.trim()) return;
    setError(null);
    try {
      const { modifierGroup } = await apiClient.request<{ modifierGroup: ModifierGroup }>(canonicalBasePath(businessId, menuItemId), {
        method: "POST",
        body: {
          name: newGroupName,
          minSelect: newGroupMin,
          maxSelect: newGroupMax,
          options: [{ name: "Option 1", priceAdjustment: 0, sortOrder: 0 }],
        },
      });
      setNewGroupName("");
      setNewGroupMin(0);
      setNewGroupMax(1);
      setShowNewGroupForm(false);
      setJustCreatedGroupId(modifierGroup.id);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function updateGroup(id: string, patch: Partial<Pick<ModifierGroup, "name" | "minSelect" | "maxSelect" | "isActive">>) {
    setError(null);
    try {
      await apiClient.request(`${canonicalBasePath(businessId, menuItemId)}/${id}`, { method: "PATCH", body: patch });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function saveOptions(group: ModifierGroup, options: DraftOption[]) {
    setError(null);
    try {
      await apiClient.request(`${canonicalBasePath(businessId, menuItemId)}/${group.id}`, {
        method: "PATCH",
        body: { options },
      });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function deleteGroup(id: string) {
    setError(null);
    try {
      await apiClient.request(`${canonicalBasePath(businessId, menuItemId)}/${id}`, { method: "DELETE" });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function saveGroupOverride(
    groupId: string,
    patch: { isActive?: boolean; optionOverrides?: ModifierGroupLocationOverride["optionOverrides"] }
  ) {
    setError(null);
    try {
      await apiClient.request(overridePath(restaurantId, menuItemId, groupId), { method: "PUT", body: patch });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function resetGroupOverride(groupId: string) {
    setError(null);
    try {
      await apiClient.request(overridePath(restaurantId, menuItemId, groupId), { method: "DELETE" });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (loading) return <p className="text-sm text-muted">Loading modifiers...</p>;

  const overrideByGroupId = new Map(overrides.map((o) => [o.modifierGroupId, o]));

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}

      {groups.length === 0 && !showNewGroupForm && (
        <p className="text-sm text-muted">No options yet — sizes, toppings, and other add-ons go here.</p>
      )}

      {groups.map((group) => (
        <GroupCard
          key={group.id}
          group={group}
          override={overrideByGroupId.get(group.id)}
          currency={currency}
          defaultExpanded={group.id === justCreatedGroupId}
          onUpdateGroup={updateGroup}
          onSaveOptions={saveOptions}
          onDelete={deleteGroup}
          onSaveOverride={saveGroupOverride}
          onResetOverride={resetGroupOverride}
        />
      ))}

      {showNewGroupForm ? (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-border p-3">
          <label className="flex flex-col gap-1 text-xs text-muted">
            Group name (all locations)
            <input
              autoFocus
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="e.g. Size, Toppings"
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Minimum choices
            <input type="number" min={0} value={newGroupMin} onChange={(e) => setNewGroupMin(Number(e.target.value))} className={`w-20 ${inputClass}`} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Maximum choices
            <input type="number" min={1} value={newGroupMax} onChange={(e) => setNewGroupMax(Number(e.target.value))} className={`w-20 ${inputClass}`} />
          </label>
          <Button size="sm" onClick={createGroup} disabled={!newGroupName.trim()}>
            Create option group
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setShowNewGroupForm(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowNewGroupForm(true)}
          className="self-start text-sm font-medium text-primary transition-colors duration-fast hover:underline"
        >
          + New option group
        </button>
      )}
    </div>
  );
}

/** Choose-N phrased the way an owner (or their customer) would say it out loud, not as raw
 *  min/max integers — "Choose 1", "Choose up to 3", "Choose 1-3". */
function chooseLabel(minSelect: number, maxSelect: number): string {
  if (maxSelect === 1) return "Choose 1";
  if (minSelect <= 0) return `Choose up to ${maxSelect}`;
  return `Choose ${minSelect}-${maxSelect}`;
}

function formatAdjustment(amount: number, currency: string): string {
  if (amount <= 0) return "+" + formatCurrency(0, currency);
  return "+" + formatCurrency(amount, currency);
}

function GroupCard({
  group,
  override,
  currency,
  defaultExpanded,
  onUpdateGroup,
  onSaveOptions,
  onDelete,
  onSaveOverride,
  onResetOverride,
}: {
  group: ModifierGroup;
  override?: ModifierGroupLocationOverride;
  currency: string;
  defaultExpanded: boolean;
  onUpdateGroup: (id: string, patch: Partial<Pick<ModifierGroup, "name" | "minSelect" | "maxSelect" | "isActive">>) => void;
  onSaveOptions: (group: ModifierGroup, options: DraftOption[]) => Promise<void>;
  onDelete: (id: string) => void;
  onSaveOverride: (
    groupId: string,
    patch: { isActive?: boolean; optionOverrides?: ModifierGroupLocationOverride["optionOverrides"] }
  ) => void;
  onResetOverride: (groupId: string) => void;
}) {
  // Phase 69 — a pre-existing, already-configured group opens as a compact, scannable summary; a
  // group just created via "+ Add option group" (defaultExpanded) opens straight into the editable
  // form, since its default "Option 1" placeholder needs renaming right away. Plain useState
  // (evaluated once) is correct here specifically because this component is keyed by group.id and
  // never remounts across reloads of the SAME group — see this file's own Phase 69 notes elsewhere.
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [options, setOptions] = useState<DraftOption[]>(group.options);
  const [dirty, setDirty] = useState(false);
  const [savingOptions, setSavingOptions] = useState(false);
  const [justSavedOptions, setJustSavedOptions] = useState(false);
  const [optionPriceOverrideDrafts, setOptionPriceOverrideDrafts] = useState<Record<string, string>>({});
  const [openOverrideOptionIds, setOpenOverrideOptionIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setOptions(group.options);
    setDirty(false);
  }, [group.options]);

  function updateOption(i: number, patch: Partial<DraftOption>) {
    setOptions((opts) => opts.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
    setDirty(true);
  }

  function removeOption(i: number) {
    setOptions((opts) => opts.filter((_, idx) => idx !== i));
    setDirty(true);
  }

  function addOption() {
    setOptions((opts) => [...opts, { name: "", priceAdjustment: 0, sortOrder: opts.length, isActive: true }]);
    setDirty(true);
  }

  function toggleOverrideRow(optId: string) {
    setOpenOverrideOptionIds((prev) => {
      const next = new Set(prev);
      if (next.has(optId)) next.delete(optId);
      else next.add(optId);
      return next;
    });
  }

  async function handleSaveOptions() {
    setSavingOptions(true);
    try {
      await onSaveOptions(group, options.filter((o) => o.name.trim()));
      setJustSavedOptions(true);
      setTimeout(() => setJustSavedOptions(false), 2000);
    } finally {
      setSavingOptions(false);
    }
  }

  /** PUT replaces the whole optionOverrides array, so saving one option's override must carry
   *  every other option's existing override forward alongside it. */
  function saveOptionPriceOverride(optionId: string, priceAdjustmentOverride: number) {
    const existing = override?.optionOverrides ?? [];
    const next = [
      ...existing.filter((o) => o.optionId !== optionId),
      { optionId, priceAdjustmentOverride, isActive: existing.find((o) => o.optionId === optionId)?.isActive },
    ];
    onSaveOverride(group.id, { isActive: override?.isActive, optionOverrides: next });
  }

  function toggleOptionAvailabilityOverride(optionId: string, canonicalActive: boolean) {
    const existing = override?.optionOverrides ?? [];
    const current = existing.find((o) => o.optionId === optionId);
    const currentEffective = current?.isActive ?? canonicalActive;
    const next = [
      ...existing.filter((o) => o.optionId !== optionId),
      { optionId, isActive: !currentEffective, priceAdjustmentOverride: current?.priceAdjustmentOverride },
    ];
    onSaveOverride(group.id, { isActive: override?.isActive, optionOverrides: next });
  }

  const isRequired = group.minSelect >= 1;
  const effectiveGroupActive = override?.isActive ?? group.isActive;
  const optionOverrideById = new Map((override?.optionOverrides ?? []).map((o) => [o.optionId, o]));

  if (!expanded) {
    return (
      <div className={`flex flex-col gap-2 rounded-lg border border-border bg-background p-3.5 animate-fade-up ${!group.isActive ? "opacity-60" : ""}`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="font-medium text-foreground">{group.name}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
              <Badge tone={isRequired ? "warning" : "neutral"}>{isRequired ? "Required" : "Optional"}</Badge>
              {chooseLabel(group.minSelect, group.maxSelect)}
              {!group.isActive && <Badge tone="neutral">Hidden</Badge>}
              {override && <Badge tone="info">Overridden here</Badge>}
            </p>
          </div>
        </div>
        <ul className="flex flex-col gap-1 text-sm text-foreground">
          {group.options.map((opt) => {
            const optId = (opt as { id?: string }).id;
            const optOverride = optId ? optionOverrideById.get(optId) : undefined;
            const effectivePrice = optOverride?.priceAdjustmentOverride ?? opt.priceAdjustment;
            return (
              <li key={optId ?? opt.name} className="flex items-center justify-between gap-2">
                <span className={opt.isActive === false ? "text-muted line-through" : ""}>{opt.name}</span>
                <span className="text-muted">{formatAdjustment(effectivePrice, currency)}</span>
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="self-end text-sm font-medium text-primary transition-colors duration-fast hover:underline"
        >
          Edit options →
        </button>
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-4 rounded-lg border border-border bg-background p-4 animate-fade-up ${!group.isActive ? "opacity-60" : ""}`}>
      {/* Name + summary — the same badge/chooseLabel line the collapsed view shows, so expanding
          a group never feels like switching to a different component. */}
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <input
            defaultValue={group.name}
            onBlur={(e) => e.target.value !== group.name && onUpdateGroup(group.id, { name: e.target.value })}
            aria-label="Option group name"
            className={`min-w-[100px] flex-1 font-heading text-base font-semibold ${inputClass}`}
          />
          <button
            onClick={() => onUpdateGroup(group.id, { isActive: !group.isActive })}
            className="text-sm font-medium text-foreground/70 hover:text-foreground hover:underline"
          >
            {group.isActive ? "Hide" : "Show"}
          </button>
          <button onClick={() => onDelete(group.id)} className="text-sm font-medium text-danger hover:underline">
            Delete group
          </button>
        </div>
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <Badge tone={isRequired ? "warning" : "neutral"}>{isRequired ? "Required" : "Optional"}</Badge>
          {chooseLabel(group.minSelect, group.maxSelect)}
          {!group.isActive && <Badge tone="neutral">Hidden (all locations)</Badge>}
          {override && <Badge tone="info">Overridden here</Badge>}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Options</p>
        <div className="flex flex-col gap-1.5">
          {options.map((opt, i) => {
            const optId = (opt as { id?: string }).id;
            const optOverride = optId ? optionOverrideById.get(optId) : undefined;
            const effectivePrice = optOverride?.priceAdjustmentOverride ?? opt.priceAdjustment;
            const effectiveOptActive = optOverride?.isActive ?? opt.isActive;
            const overrideRowOpen = optId ? openOverrideOptionIds.has(optId) : false;
            return (
              <div key={i} className="flex flex-col gap-1.5 border-b border-border/50 pb-1.5 last:border-0">
                <div className={`flex flex-wrap items-center gap-2 ${opt.isActive === false ? "opacity-60" : ""}`}>
                  <input
                    value={opt.name}
                    onChange={(e) => updateOption(i, { name: e.target.value })}
                    placeholder="Option name"
                    className={`min-w-[100px] flex-1 ${inputClass}`}
                  />
                  <div className="flex items-center gap-1 text-sm text-muted">
                    +$
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={opt.priceAdjustment}
                      onChange={(e) => updateOption(i, { priceAdjustment: Number(e.target.value) })}
                      className={`w-20 ${inputClass}`}
                    />
                  </div>
                  <label className="flex items-center gap-1 text-xs text-muted">
                    <input
                      type="checkbox"
                      checked={opt.isActive !== false}
                      onChange={(e) => updateOption(i, { isActive: e.target.checked })}
                    />
                    Available
                  </label>
                  <div className="ml-auto flex shrink-0 items-center gap-1">
                    {optId && (
                      <button
                        type="button"
                        onClick={() => toggleOverrideRow(optId)}
                        aria-expanded={overrideRowOpen}
                        aria-label={`${overrideRowOpen ? "Hide" : "Show"} per-location settings for ${opt.name || "this option"}`}
                        title="This location's price or availability"
                        className={`rounded-md p-1.5 transition-colors duration-fast hover:bg-black/[0.04] ${
                          optOverride ? "text-primary" : "text-muted hover:text-foreground"
                        }`}
                      >
                        <IconSliders className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => removeOption(i)}
                      aria-label={`Remove ${opt.name || "option"}`}
                      title="Remove"
                      className="rounded-md p-1.5 text-muted transition-colors duration-fast hover:bg-black/[0.04] hover:text-danger"
                    >
                      <IconX className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {optId && overrideRowOpen && (
                  <div className="ml-1 flex flex-wrap items-center gap-2 rounded-md bg-black/[0.025] p-2 text-xs text-muted animate-fade-up">
                    <span>This location:</span>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      placeholder={String(effectivePrice)}
                      value={optionPriceOverrideDrafts[optId] ?? ""}
                      onChange={(e) => setOptionPriceOverrideDrafts((d) => ({ ...d, [optId]: e.target.value }))}
                      className={`w-20 ${inputClass}`}
                    />
                    <button
                      className="font-medium text-foreground/70 hover:text-foreground hover:underline"
                      onClick={() => {
                        const val = optionPriceOverrideDrafts[optId];
                        if (val) saveOptionPriceOverride(optId, Number(val));
                      }}
                      disabled={!optionPriceOverrideDrafts[optId]}
                    >
                      override price here
                    </button>
                    <button
                      className="font-medium text-foreground/70 hover:text-foreground hover:underline"
                      onClick={() => toggleOptionAvailabilityOverride(optId, opt.isActive !== false)}
                    >
                      {effectiveOptActive ? "hide only here" : "show only here"}
                    </button>
                    {optOverride && <Badge tone="info">overridden</Badge>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <button onClick={addOption} className="self-start text-sm font-medium text-primary transition-colors duration-fast hover:underline">
          + Add option
        </button>
      </div>

      <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Selection rules</p>
        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1 text-xs text-muted">
            Minimum choices
            <input
              type="number"
              min={0}
              defaultValue={group.minSelect}
              onBlur={(e) => Number(e.target.value) !== group.minSelect && onUpdateGroup(group.id, { minSelect: Number(e.target.value) })}
              className={`w-20 ${inputClass}`}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Maximum choices
            <input
              type="number"
              min={1}
              defaultValue={group.maxSelect}
              onBlur={(e) => Number(e.target.value) !== group.maxSelect && onUpdateGroup(group.id, { maxSelect: Number(e.target.value) })}
              className={`w-20 ${inputClass}`}
            />
          </label>
        </div>
      </div>

      <div className="flex min-h-[2rem] items-center gap-2">
        {dirty ? (
          <>
            <Button size="sm" onClick={handleSaveOptions} disabled={savingOptions || options.filter((o) => o.name.trim()).length === 0}>
              {savingOptions ? "Saving…" : "Save options"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOptions(group.options)} disabled={savingOptions}>
              Cancel
            </Button>
          </>
        ) : (
          justSavedOptions && <span className="text-xs font-medium text-success">✓ Saved</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border/50 pt-2 text-xs text-muted">
        <span>This group, this location:</span>
        <button
          onClick={() => onSaveOverride(group.id, { isActive: !effectiveGroupActive, optionOverrides: override?.optionOverrides })}
          className="font-medium text-foreground/70 hover:text-foreground hover:underline"
        >
          {effectiveGroupActive ? "hide only here" : "show only here"}
        </button>
        {override && (
          <button onClick={() => onResetOverride(group.id)} className="font-medium text-foreground/70 hover:text-foreground hover:underline">
            reset to canonical
          </button>
        )}
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="ml-auto font-medium text-foreground/70 transition-colors duration-fast hover:text-foreground hover:underline"
        >
          Show summary
        </button>
      </div>
    </div>
  );
}
