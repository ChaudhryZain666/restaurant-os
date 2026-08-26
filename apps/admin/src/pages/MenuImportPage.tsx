import { useState } from "react";
import { Link } from "react-router-dom";
import {
  MENU_IMPORT_FIELD_KEYS,
  type MenuImportColumnMapping,
  type MenuImportFieldKey,
  type MenuImportPreviewResponse,
  type MenuImportReport,
  type MenuImportRowAction,
} from "@restaurant/types";
import { Alert, Badge, Button, Card } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import { apiClient } from "../lib/api";
import { useActiveLocationId } from "../context/LocationContext";
import { useRestaurantCurrency } from "../hooks/useRestaurantCurrency";

type Step = "upload" | "mapping" | "preview" | "result";

const STEP_ORDER: Step[] = ["upload", "mapping", "preview", "result"];
const STEP_LABEL: Record<Step, string> = {
  upload: "Choose file",
  mapping: "Map columns",
  preview: "Review",
  result: "Done",
};

const FIELD_LABEL: Record<MenuImportFieldKey, string> = {
  categoryName: "Category",
  itemName: "Item name",
  description: "Description",
  price: "Price",
  isAvailable: "Available",
  sortOrder: "Sort order",
  imageUrl: "Image URL",
  modifierGroupName: "Modifier group",
  modifierOptionName: "Modifier option",
  modifierPrice: "Modifier price",
  modifierMinSelect: "Modifier min select",
  modifierMaxSelect: "Modifier max select",
};

const ACTION_LABEL: Record<MenuImportRowAction, string> = {
  create: "New item",
  update: "Will update",
  skip: "Already exists — skipped",
  error: "Needs fixing",
};

const ACTION_TONE: Record<MenuImportRowAction, "success" | "info" | "neutral" | "danger"> = {
  create: "success",
  update: "info",
  skip: "neutral",
  error: "danger",
};

/**
 * Phase 30 — the menu importer wizard: Choose file -> Map columns -> Review -> Done. The same File
 * object is re-uploaded at each step that needs the server to re-parse it (mapping refinement,
 * preview, and finally commit) rather than the browser ever computing prices/categories/duplicates
 * itself — the server is the sole authority for what actually gets written (see
 * apps/api/src/services/menuImport/commitImport.ts's own doc comment). Preview never mutates the
 * live menu; only the final "Confirm import" action does.
 */
export function MenuImportPage() {
  const restaurantId = useActiveLocationId();
  const currency = useRestaurantCurrency();

  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [preview, setPreview] = useState<MenuImportPreviewResponse | null>(null);
  const [mapping, setMapping] = useState<MenuImportColumnMapping>({});
  const [duplicateStrategy, setDuplicateStrategy] = useState<"skip" | "update">("skip");
  const [report, setReport] = useState<MenuImportReport | null>(null);

  async function runPreview(fileToUse: File, mappingToUse: MenuImportColumnMapping | undefined, strategy: "skip" | "update") {
    setBusy(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", fileToUse);
      if (mappingToUse) formData.append("mapping", JSON.stringify(mappingToUse));
      formData.append("duplicateStrategy", strategy);
      const res = await apiClient.request<MenuImportPreviewResponse>(`/restaurants/${restaurantId}/menu/import/preview`, {
        method: "POST",
        body: formData,
      });
      setPreview(res);
      setMapping(res.appliedMapping);
      setStep(res.unmappedRequiredFields.length > 0 ? "mapping" : "preview");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function handleFileChosen(chosen: File) {
    // LocationContext resolves activeLocationId asynchronously (see docs/multi-tenant-storefront-
    // architecture.md's Phase 28 section) — a hard navigation straight to this page (not an in-app
    // link click) can render this component before it's ready, sending `/restaurants/null/...`
    // otherwise. The file input itself is disabled until restaurantId resolves (see below), but
    // this guard stays as defense in depth against a race on the input's own change event.
    if (!restaurantId) {
      setError("Still loading this restaurant — please try again in a moment.");
      return;
    }
    setFile(chosen);
    void runPreview(chosen, undefined, duplicateStrategy);
  }

  function updateMapping(column: string, field: MenuImportFieldKey | null) {
    setMapping((prev) => ({ ...prev, [column]: field }));
  }

  async function confirmMapping() {
    if (!file) return;
    await runPreview(file, mapping, duplicateStrategy);
  }

  async function changeDuplicateStrategy(strategy: "skip" | "update") {
    setDuplicateStrategy(strategy);
    if (!file) return;
    await runPreview(file, mapping, strategy);
  }

  async function confirmImport() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("mapping", JSON.stringify(mapping));
      formData.append("duplicateStrategy", duplicateStrategy);
      const res = await apiClient.request<{ report: MenuImportReport }>(`/restaurants/${restaurantId}/menu/import/commit`, {
        method: "POST",
        body: formData,
      });
      setReport(res.report);
      setStep("result");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function startOver() {
    setStep("upload");
    setFile(null);
    setPreview(null);
    setMapping({});
    setReport(null);
    setError(null);
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Import menu</h1>
        <p className="text-sm text-muted">
          Upload a spreadsheet of your menu to create categories and items in bulk, instead of adding them one at a
          time.
        </p>
      </div>

      <ol className="flex flex-wrap gap-2 text-xs text-muted">
        {STEP_ORDER.map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${
                s === step ? "bg-primary text-primary-foreground" : STEP_ORDER.indexOf(step) > i ? "bg-success/20 text-success" : "bg-border text-muted"
              }`}
            >
              {i + 1}
            </span>
            {STEP_LABEL[s]}
            {i < STEP_ORDER.length - 1 && <span className="text-border">→</span>}
          </li>
        ))}
      </ol>

      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}

      {step === "upload" && (
        <Card className="flex flex-col gap-4">
          <div>
            <h2 className="font-heading text-lg font-medium text-foreground">Choose a file</h2>
            <p className="text-sm text-muted">
              CSV or Excel (.xlsx). Only the first sheet of an Excel workbook is read. Need a starting point?{" "}
              <a
                href="/menu-import-template.csv"
                download
                className="font-medium text-primary underline underline-offset-2"
              >
                Download the sample template
              </a>
              .
            </p>
          </div>
          <input
            type="file"
            accept=".csv,.xlsx"
            disabled={busy || !restaurantId}
            onChange={(e) => {
              const chosen = e.target.files?.[0];
              if (chosen) handleFileChosen(chosen);
            }}
            className="text-sm text-foreground"
          />
          {!restaurantId && <p className="text-sm text-muted">Loading...</p>}
          {busy && <p className="text-sm text-muted">Reading your file...</p>}
        </Card>
      )}

      {step === "mapping" && preview && (
        <Card className="flex flex-col gap-4">
          <div>
            <h2 className="font-heading text-lg font-medium text-foreground">Match your columns</h2>
            <p className="text-sm text-muted">
              We matched what we could automatically. Category, item name, and price are required — everything else
              is optional.
            </p>
          </div>
          {preview.unmappedRequiredFields.length > 0 && (
            <Alert tone="warning">
              Still missing: {preview.unmappedRequiredFields.map((f) => FIELD_LABEL[f]).join(", ")}. Choose a column
              for each below.
            </Alert>
          )}
          {preview.extraSheetsIgnored.length > 0 && (
            <Alert tone="warning">
              This workbook has more than one sheet — only the first sheet was read. Ignored:{" "}
              {preview.extraSheetsIgnored.join(", ")}.
            </Alert>
          )}
          <div className="flex flex-col gap-2">
            {preview.headers.map((header) => (
              <div key={header} className="flex items-center gap-3 rounded-lg border border-border p-2.5">
                <span className="flex-1 text-sm font-medium text-foreground">{header}</span>
                <span className="text-muted">→</span>
                <select
                  className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
                  value={mapping[header] ?? ""}
                  onChange={(e) => updateMapping(header, (e.target.value || null) as MenuImportFieldKey | null)}
                >
                  <option value="">Ignore this column</option>
                  {MENU_IMPORT_FIELD_KEYS.map((f) => (
                    <option key={f} value={f}>
                      {FIELD_LABEL[f]}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button onClick={confirmMapping} disabled={busy}>
              {busy ? "Checking..." : "Continue"}
            </Button>
            <Button variant="ghost" onClick={startOver} disabled={busy}>
              Start over
            </Button>
          </div>
        </Card>
      )}

      {step === "preview" && preview && (
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-4">
            <h2 className="font-heading text-lg font-medium text-foreground">Review before importing</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="New items" value={preview.summary.toCreate} tone="success" />
              <Stat label="Updates" value={preview.summary.toUpdate} tone="info" />
              <Stat label="Skipped" value={preview.summary.toSkip} tone="neutral" />
              <Stat label="Needs fixing" value={preview.summary.rowsWithErrors} tone="danger" />
            </div>
            <p className="text-sm text-muted">
              {preview.summary.newCategories} new categor{preview.summary.newCategories === 1 ? "y" : "ies"} will be
              created, {preview.summary.existingCategories} matched existing ones. {preview.summary.modifierGroups}{" "}
              modifier group{preview.summary.modifierGroups === 1 ? "" : "s"} with {preview.summary.modifierOptions}{" "}
              option{preview.summary.modifierOptions === 1 ? "" : "s"} on new items.
            </p>

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-foreground">
                If an item already exists (same name in the same category):
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={duplicateStrategy === "skip" ? "primary" : "outline"}
                  onClick={() => changeDuplicateStrategy("skip")}
                  disabled={busy}
                >
                  Skip it (recommended)
                </Button>
                <Button
                  size="sm"
                  variant={duplicateStrategy === "update" ? "primary" : "outline"}
                  onClick={() => changeDuplicateStrategy("update")}
                  disabled={busy}
                >
                  Update its price/description/availability
                </Button>
              </div>
            </div>
          </Card>

          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2.5 font-medium">Row</th>
                  <th className="px-4 py-2.5 font-medium">Category</th>
                  <th className="px-4 py-2.5 font-medium">Item</th>
                  <th className="px-4 py-2.5 font-medium">Price</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {preview.rows.map((row) => (
                  <tr key={row.rowNumber}>
                    <td className="px-4 py-2.5 text-muted">{row.rowNumber}</td>
                    <td className="px-4 py-2.5">{row.categoryName || "—"}</td>
                    <td className="px-4 py-2.5 font-medium text-foreground">{row.itemName || "—"}</td>
                    <td className="px-4 py-2.5">
                      {row.price !== undefined ? formatCurrency(row.price, currency) : "—"}
                      {row.action === "update" && row.previousValues && row.previousValues.price !== row.price && (
                        <span className="ml-1.5 text-xs text-muted">
                          (was {formatCurrency(row.previousValues.price, currency)})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={ACTION_TONE[row.action]}>{ACTION_LABEL[row.action]}</Badge>
                      {row.issues.length > 0 && (
                        <ul className="mt-1 flex flex-col gap-0.5 text-xs text-danger">
                          {row.issues.map((issue, i) => (
                            <li key={i}>{issue.message}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <div className="flex gap-2">
            <Button onClick={confirmImport} disabled={busy || preview.summary.toCreate + preview.summary.toUpdate === 0}>
              {busy ? "Importing..." : `Confirm import (${preview.summary.toCreate + preview.summary.toUpdate} items)`}
            </Button>
            <Button variant="ghost" onClick={() => setStep("mapping")} disabled={busy}>
              Back to column mapping
            </Button>
            <Button variant="ghost" onClick={startOver} disabled={busy}>
              Start over
            </Button>
          </div>
        </div>
      )}

      {step === "result" && report && (
        <Card className="flex flex-col gap-4">
          <h2 className="font-heading text-lg font-medium text-foreground">Import complete</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Created" value={report.created} tone="success" />
            <Stat label="Updated" value={report.updated} tone="info" />
            <Stat label="Skipped" value={report.skipped} tone="neutral" />
            <Stat label="Errors" value={report.errors} tone="danger" />
          </div>
          <p className="text-sm text-muted">
            {report.categoriesCreated} new categor{report.categoriesCreated === 1 ? "y" : "ies"},{" "}
            {report.modifierGroupsCreated} modifier group{report.modifierGroupsCreated === 1 ? "" : "s"} with{" "}
            {report.modifierOptionsCreated} option{report.modifierOptionsCreated === 1 ? "" : "s"} from{" "}
            {report.fileName}.
          </p>
          <div className="flex gap-2">
            <Link to="/menu">
              <Button>View your menu</Button>
            </Link>
            <Button variant="ghost" onClick={startOver}>
              Import another file
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "success" | "info" | "neutral" | "danger" }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className={`font-heading text-xl font-semibold ${tone === "danger" && value > 0 ? "text-danger" : "text-foreground"}`}>{value}</p>
    </div>
  );
}
