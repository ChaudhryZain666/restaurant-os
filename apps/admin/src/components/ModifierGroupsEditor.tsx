import { useEffect, useState } from "react";
import type { ModifierGroup, ModifierOption } from "@restaurant/types";
import { Alert, Badge, Button } from "@restaurant/ui";
import { apiClient } from "../lib/api";

const inputClass = "rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground";

interface Props {
  restaurantId: string;
  menuItemId: string;
}

type DraftOption = Pick<ModifierOption, "name" | "priceAdjustment" | "sortOrder" | "isActive">;

function basePath(restaurantId: string, menuItemId: string) {
  return `/restaurants/${restaurantId}/menu/${menuItemId}/modifiers`;
}

export function ModifierGroupsEditor({ restaurantId, menuItemId }: Props) {
  const [groups, setGroups] = useState<ModifierGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupMin, setNewGroupMin] = useState(0);
  const [newGroupMax, setNewGroupMax] = useState(1);

  async function reload() {
    const { modifierGroups } = await apiClient.request<{ modifierGroups: ModifierGroup[] }>(
      basePath(restaurantId, menuItemId)
    );
    setGroups(modifierGroups);
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
      await apiClient.request(basePath(restaurantId, menuItemId), {
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
      await apiClient.request(`${basePath(restaurantId, menuItemId)}/${id}`, { method: "PATCH", body: patch });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function saveOptions(group: ModifierGroup, options: DraftOption[]) {
    setError(null);
    try {
      await apiClient.request(`${basePath(restaurantId, menuItemId)}/${group.id}`, {
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
      await apiClient.request(`${basePath(restaurantId, menuItemId)}/${id}`, { method: "DELETE" });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (loading) return <p className="text-sm text-muted">Loading modifiers...</p>;

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}

      {groups.length === 0 && <p className="text-sm text-muted">No modifier groups yet — sizes, toppings, and other add-ons go here.</p>}

      {groups.map((group) => (
        <GroupCard key={group.id} group={group} onUpdateGroup={updateGroup} onSaveOptions={saveOptions} onDelete={deleteGroup} />
      ))}

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-border p-3">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Group name
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
  onUpdateGroup,
  onSaveOptions,
  onDelete,
}: {
  group: ModifierGroup;
  onUpdateGroup: (id: string, patch: Partial<Pick<ModifierGroup, "name" | "minSelect" | "maxSelect" | "isActive">>) => void;
  onSaveOptions: (group: ModifierGroup, options: DraftOption[]) => void;
  onDelete: (id: string) => void;
}) {
  const [options, setOptions] = useState<DraftOption[]>(group.options);
  const [dirty, setDirty] = useState(false);

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

  const isRequired = group.minSelect >= 1;

  return (
    <div className={`flex flex-col gap-2.5 rounded-lg border border-border bg-background p-3 ${!group.isActive ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          defaultValue={group.name}
          onBlur={(e) => e.target.value !== group.name && onUpdateGroup(group.id, { name: e.target.value })}
          className={`flex-1 font-medium ${inputClass}`}
        />
        <Badge tone={isRequired ? "warning" : "neutral"}>{isRequired ? "Required" : "Optional"}</Badge>
        {!group.isActive && <Badge tone="neutral">Hidden</Badge>}
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
          {group.isActive ? "Hide" : "Show"}
        </button>
        <button onClick={() => onDelete(group.id)} className="text-sm font-medium text-danger hover:underline">
          Delete group
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        {options.map((opt, i) => (
          <div key={i} className={`flex items-center gap-2 ${opt.isActive === false ? "opacity-60" : ""}`}>
            <input
              value={opt.name}
              onChange={(e) => updateOption(i, { name: e.target.value })}
              placeholder="Option name"
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
              Available
            </label>
            <button onClick={() => removeOption(i)} className="text-sm text-danger hover:underline">
              Remove
            </button>
          </div>
        ))}
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
            Save options
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOptions(group.options)}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
