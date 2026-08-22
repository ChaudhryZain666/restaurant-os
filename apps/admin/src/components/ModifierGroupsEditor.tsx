import { useEffect, useState } from "react";
import type { ModifierGroup, ModifierGroupLocationOverride, ModifierOption } from "@restaurant/types";
import { Alert, Badge, Button } from "@restaurant/ui";
import { apiClient } from "../lib/api";

const inputClass = "rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground";

interface Props {
  businessId: string;
  restaurantId: string;
  menuItemId: string;
}

type DraftOption = Pick<ModifierOption, "name" | "priceAdjustment" | "sortOrder" | "isActive">;

function canonicalBasePath(businessId: string, menuItemId: string) {
  return `/businesses/${businessId}/menu/${menuItemId}/modifiers`;
}

function overridePath(restaurantId: string, menuItemId: string, groupId: string) {
  return `/restaurants/${restaurantId}/menu/${menuItemId}/modifiers/${groupId}/override`;
}

export function ModifierGroupsEditor({ businessId, restaurantId, menuItemId }: Props) {
  const [groups, setGroups] = useState<ModifierGroup[]>([]);
  const [overrides, setOverrides] = useState<ModifierGroupLocationOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupMin, setNewGroupMin] = useState(0);
  const [newGroupMax, setNewGroupMax] = useState(1);

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
      await apiClient.request(canonicalBasePath(businessId, menuItemId), {
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

      {groups.length === 0 && <p className="text-sm text-muted">No modifier groups yet — sizes, toppings, and other add-ons go here.</p>}

      {groups.map((group) => (
        <GroupCard
          key={group.id}
          group={group}
          override={overrideByGroupId.get(group.id)}
          onUpdateGroup={updateGroup}
          onSaveOptions={saveOptions}
          onDelete={deleteGroup}
          onSaveOverride={saveGroupOverride}
          onResetOverride={resetGroupOverride}
        />
      ))}

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-border p-3">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Group name (all locations)
          <input
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            placeholder="e.g. Size, Toppings"
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Min select
          <input type="number" min={0} value={newGroupMin} onChange={(e) => setNewGroupMin(Number(e.target.value))} className={`w-20 ${inputClass}`} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Max select
          <input type="number" min={1} value={newGroupMax} onChange={(e) => setNewGroupMax(Number(e.target.value))} className={`w-20 ${inputClass}`} />
        </label>
        <Button size="sm" onClick={createGroup} disabled={!newGroupName.trim()}>
          Add modifier group
        </Button>
      </div>
    </div>
  );
}

function GroupCard({
  group,
  override,
  onUpdateGroup,
  onSaveOptions,
  onDelete,
  onSaveOverride,
  onResetOverride,
}: {
  group: ModifierGroup;
  override?: ModifierGroupLocationOverride;
  onUpdateGroup: (id: string, patch: Partial<Pick<ModifierGroup, "name" | "minSelect" | "maxSelect" | "isActive">>) => void;
  onSaveOptions: (group: ModifierGroup, options: DraftOption[]) => void;
  onDelete: (id: string) => void;
  onSaveOverride: (
    groupId: string,
    patch: { isActive?: boolean; optionOverrides?: ModifierGroupLocationOverride["optionOverrides"] }
  ) => void;
  onResetOverride: (groupId: string) => void;
}) {
  const [options, setOptions] = useState<DraftOption[]>(group.options);
  const [dirty, setDirty] = useState(false);
  const [optionPriceOverrideDrafts, setOptionPriceOverrideDrafts] = useState<Record<string, string>>({});

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

  return (
    <div className={`flex flex-col gap-2.5 rounded-lg border border-border bg-background p-3 ${!group.isActive ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          defaultValue={group.name}
          onBlur={(e) => e.target.value !== group.name && onUpdateGroup(group.id, { name: e.target.value })}
          className={`flex-1 font-medium ${inputClass}`}
        />
        <Badge tone={isRequired ? "warning" : "neutral"}>{isRequired ? "Required" : "Optional"}</Badge>
        {!group.isActive && <Badge tone="neutral">Hidden (all locations)</Badge>}
        {override && <Badge tone="info">Overridden here</Badge>}
        <label className="flex items-center gap-1 text-xs text-muted">
          Min
          <input
            type="number"
            min={0}
            defaultValue={group.minSelect}
            onBlur={(e) => Number(e.target.value) !== group.minSelect && onUpdateGroup(group.id, { minSelect: Number(e.target.value) })}
            className={`w-16 ${inputClass}`}
          />
        </label>
        <label className="flex items-center gap-1 text-xs text-muted">
          Max
          <input
            type="number"
            min={1}
            defaultValue={group.maxSelect}
            onBlur={(e) => Number(e.target.value) !== group.maxSelect && onUpdateGroup(group.id, { maxSelect: Number(e.target.value) })}
            className={`w-16 ${inputClass}`}
          />
        </label>
        <button
          onClick={() => onUpdateGroup(group.id, { isActive: !group.isActive })}
          className="text-sm font-medium text-foreground/70 hover:text-foreground hover:underline"
        >
          {group.isActive ? "Hide (all locations)" : "Show (all locations)"}
        </button>
        <button onClick={() => onDelete(group.id)} className="text-sm font-medium text-danger hover:underline">
          Delete group
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        {options.map((opt, i) => {
          const optId = (opt as { id?: string }).id;
          const optOverride = optId ? optionOverrideById.get(optId) : undefined;
          const effectivePrice = optOverride?.priceAdjustmentOverride ?? opt.priceAdjustment;
          const effectiveOptActive = optOverride?.isActive ?? opt.isActive;
          return (
            <div key={i} className="flex flex-col gap-1 border-b border-border/50 pb-1.5 last:border-0">
              <div className={`flex items-center gap-2 ${opt.isActive === false ? "opacity-60" : ""}`}>
                <input
                  value={opt.name}
                  onChange={(e) => updateOption(i, { name: e.target.value })}
                  placeholder="Option name (all locations)"
                  className={`flex-1 ${inputClass}`}
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
                  Available (all locations)
                </label>
                <button onClick={() => removeOption(i)} className="text-sm text-danger hover:underline">
                  Remove
                </button>
              </div>
              {optId && (
                <div className="ml-1 flex flex-wrap items-center gap-2 text-xs text-muted">
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
        <button onClick={addOption} className="self-start text-sm font-medium text-primary hover:underline">
          + Add option
        </button>
      </div>

      {dirty && (
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => onSaveOptions(group, options.filter((o) => o.name.trim()))}
            disabled={options.filter((o) => o.name.trim()).length === 0}
          >
            Save options (all locations)
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOptions(group.options)}>
            Cancel
          </Button>
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-border/50 pt-2 text-xs text-muted">
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
      </div>
    </div>
  );
}
