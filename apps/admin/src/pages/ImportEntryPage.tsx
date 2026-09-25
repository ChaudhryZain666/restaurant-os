import { useRef, useState, type ComponentType, type FormEvent, type SVGProps } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Alert } from "@restaurant/ui";
import { useActiveLocationId } from "../context/LocationContext";
import { createMenuImportJob } from "../lib/menuImportJobs";
import { IconArrowLeft, IconFileText, IconGrid3, IconImage, IconLink, IconMenuBook } from "../components/icons";

function ImportOptionButton({
  icon: Icon,
  title,
  description,
  onClick,
  disabled,
}: {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex flex-col items-start gap-3 rounded-xl border border-border bg-surface p-5 text-left transition-colors duration-fast hover:border-primary/40 hover:bg-primary/[0.03] disabled:pointer-events-none disabled:opacity-60"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </span>
      <span>
        <span className="block font-heading text-base font-semibold text-foreground">{title}</span>
        <span className="mt-0.5 block text-sm text-muted">{description}</span>
      </span>
    </button>
  );
}

/**
 * Phase 81 Stage 2 — the entry point for every menu-import source, replacing the old direct mount
 * of the CSV-only wizard. "Import your existing menu" is the primary framing (per the founder's own
 * brief), with the 4 real source options underneath, plus a clearly-secondary "build manually" path
 * — never five identical generic buttons.
 */
export function ImportEntryPage() {
  const restaurantId = useActiveLocationId();
  const navigate = useNavigate();
  const [urlValue, setUrlValue] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const photosInputRef = useRef<HTMLInputElement>(null);

  async function startFilesJob(sourceType: "pdf" | "images", files: FileList | null) {
    if (!files || files.length === 0 || !restaurantId) return;
    setCreating(true);
    setError(null);
    try {
      const job = await createMenuImportJob(restaurantId, sourceType, { files: Array.from(files) });
      navigate(`/menu/import/job/${job.id}`);
    } catch (err) {
      setError((err as Error).message);
      setCreating(false);
    }
  }

  async function startUrlJob(e: FormEvent) {
    e.preventDefault();
    if (!restaurantId || !urlValue.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const job = await createMenuImportJob(restaurantId, "url", { url: urlValue.trim() });
      navigate(`/menu/import/job/${job.id}`);
    } catch (err) {
      setError((err as Error).message);
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <div>
        <Link to="/menu" className="mb-4 flex w-fit items-center gap-1.5 text-sm font-medium text-foreground/70 transition-colors duration-fast hover:text-foreground">
          <IconArrowLeft className="h-4 w-4" />
          Menu
        </Link>
        <h1 className="font-heading text-3xl font-semibold text-foreground">Bring your menu to GarnishTable</h1>
        <p className="mt-1.5 text-sm text-muted">
          Import your existing menu and we'll turn it into your restaurant menu — or start from scratch.
        </p>
      </div>

      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}
      {creating && (
        <Alert tone="info" role="status">
          Getting your import ready…
        </Alert>
      )}

      <div className="flex flex-col gap-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Import your existing menu</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <ImportOptionButton
            icon={IconFileText}
            title="Upload a PDF"
            description="A menu file you already have — one or multiple pages."
            onClick={() => pdfInputRef.current?.click()}
            disabled={creating || !restaurantId}
          />
          <ImportOptionButton
            icon={IconImage}
            title="Upload photos"
            description="Photos of a printed menu, one photo per page."
            onClick={() => photosInputRef.current?.click()}
            disabled={creating || !restaurantId}
          />
          <ImportOptionButton
            icon={IconGrid3}
            title="Import a CSV"
            description="Structured menu data from a spreadsheet."
            onClick={() => navigate("/menu/import/csv")}
            disabled={creating}
          />
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <IconLink className="h-5 w-5" />
            </span>
            <span>
              <span className="block font-heading text-base font-semibold text-foreground">Paste your menu URL</span>
              <span className="mt-0.5 block text-sm text-muted">Your existing online menu page.</span>
            </span>
            <form onSubmit={startUrlJob} className="flex flex-col gap-2 sm:flex-row">
              <input
                type="url"
                required
                value={urlValue}
                onChange={(e) => setUrlValue(e.target.value)}
                placeholder="https://yourrestaurant.com/menu"
                disabled={creating || !restaurantId}
                className="flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
              />
              <button
                type="submit"
                disabled={creating || !restaurantId || !urlValue.trim()}
                className="rounded-lg bg-primary px-3.5 py-1.5 text-sm font-semibold text-primary-foreground transition-opacity duration-fast hover:opacity-90 disabled:pointer-events-none disabled:opacity-50"
              >
                Import
              </button>
            </form>
          </div>
        </div>
        <input ref={pdfInputRef} type="file" accept="application/pdf" hidden onChange={(e) => startFilesJob("pdf", e.target.files)} />
        <input
          ref={photosInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          hidden
          onChange={(e) => startFilesJob("images", e.target.files)}
        />
      </div>

      <div className="flex flex-col items-center gap-1.5 border-t border-border pt-6 text-center">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/[0.04] text-muted">
          <IconMenuBook className="h-4 w-4" />
        </span>
        <Link to="/menu" className="text-sm font-medium text-primary hover:underline">
          Or start from scratch — build your menu manually
        </Link>
      </div>
    </div>
  );
}
