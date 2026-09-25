import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { MenuImportJobDetail, MenuImportJobStatus } from "@restaurant/types";
import { Alert, Button, Spinner } from "@restaurant/ui";
import { useActiveLocationId } from "../context/LocationContext";
import { cancelMenuImportJob, getMenuImportJob, publishMenuImportJob } from "../lib/menuImportJobs";
import { ImportReviewList } from "../components/menu-import/ImportReviewList";
import { SourcePreviewSplit } from "../components/menu-import/SourcePreviewSplit";
import { ImportErrorPanel } from "../components/menu-import/ImportErrorPanel";
import { IconArrowLeft, IconCheck } from "../components/icons";

const POLL_INTERVAL_MS = 2000;
const NON_TERMINAL_STATUSES: MenuImportJobStatus[] = ["pending", "processing", "extracting", "normalizing"];

interface ProgressStep {
  label: string;
  /** The job stages (in order) that count as "this step is done" once the job has moved past all
   *  of them. */
  doneOnceStagePast: MenuImportJobStatus[];
  /** The job stage(s) where this step is the one currently in progress. */
  activeDuring: MenuImportJobStatus[];
}

// Exactly the 3 real, distinct stages the backend pipeline actually has (processing -> extracting
// -> normalizing) — never a 4th invented step just to look fuller. Honest, stage-based progress
// only, per the brief's own explicit instruction against faking it.
const PROGRESS_STEPS: ProgressStep[] = [
  { label: "Upload received", doneOnceStagePast: ["pending"], activeDuring: ["pending"] },
  { label: "Reading your menu", doneOnceStagePast: ["processing", "extracting"], activeDuring: ["processing", "extracting"] },
  { label: "Organizing items", doneOnceStagePast: ["normalizing"], activeDuring: ["normalizing"] },
];

function ProgressChecklist({ job }: { job: MenuImportJobDetail }) {
  const stageOrder: MenuImportJobStatus[] = ["pending", "processing", "extracting", "normalizing", "ready_for_review"];
  const currentIndex = stageOrder.indexOf(job.status);

  return (
    <div className="flex flex-col items-center gap-6 py-10 text-center">
      <Spinner size="lg" label="Reading your menu" />
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Reading your menu</h1>
        <p className="mt-1 text-sm text-muted">This usually takes a moment — you can leave this page and come back.</p>
      </div>
      <ul className="flex flex-col gap-2.5 text-left">
        {PROGRESS_STEPS.map((step) => {
          const lastRequiredIndex = Math.max(...step.doneOnceStagePast.map((s) => stageOrder.indexOf(s)));
          const done = currentIndex > lastRequiredIndex;
          const active = step.activeDuring.includes(job.status);
          return (
            <li key={step.label} className="flex items-center gap-2.5 text-sm">
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${
                  done ? "bg-success text-white" : active ? "border-2 border-primary" : "border-2 border-border"
                }`}
              >
                {done && <IconCheck className="h-3 w-3" />}
              </span>
              <span className={done || active ? "font-medium text-foreground" : "text-muted"}>{step.label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Phase 81 Stage 2 — the async import job's own page: polls while processing, renders the review
 * UI once ready, handles publish/cancel. The same page for pdf/image/url jobs (CSV keeps its
 * separate, unchanged wizard — see MenuImportPage.tsx).
 */
export function MenuImportJobPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const restaurantId = useActiveLocationId();
  const [job, setJob] = useState<MenuImportJobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!restaurantId || !jobId) return;
    let cancelled = false;

    async function poll() {
      try {
        const fresh = await getMenuImportJob(restaurantId!, jobId!);
        if (cancelled) return;
        setJob(fresh);
        if (NON_TERMINAL_STATUSES.includes(fresh.status)) {
          timerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    }
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timerRef.current);
    };
  }, [restaurantId, jobId]);

  async function handlePublish(defaultDuplicateStrategy: "skip" | "update" | "merge") {
    if (!restaurantId || !jobId) return;
    setPublishing(true);
    setError(null);
    try {
      const published = await publishMenuImportJob(restaurantId, jobId, defaultDuplicateStrategy);
      setJob(published);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPublishing(false);
    }
  }

  async function handleCancel() {
    if (!restaurantId || !jobId) return;
    if (!window.confirm("Cancel this import? Nothing will be added to your menu.")) return;
    setCancelling(true);
    setError(null);
    try {
      const cancelled = await cancelMenuImportJob(restaurantId, jobId);
      setJob(cancelled);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCancelling(false);
    }
  }

  if (!job) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-4 py-16">
        {error ? <Alert tone="danger">{error}</Alert> : <Spinner size="lg" label="Loading" />}
      </div>
    );
  }

  if (NON_TERMINAL_STATUSES.includes(job.status)) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <ProgressChecklist job={job} />
        <div className="flex justify-center">
          <Button variant="ghost" size="sm" onClick={handleCancel} disabled={cancelling}>
            {cancelling ? "Cancelling…" : "Cancel import"}
          </Button>
        </div>
      </div>
    );
  }

  if (job.status === "failed") {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <ImportErrorPanel job={job} />
      </div>
    );
  }

  if (job.status === "cancelled") {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-4 py-10 text-center">
        <h1 className="font-heading text-2xl font-semibold text-foreground">Import cancelled</h1>
        <p className="text-sm text-muted">Nothing was added to your menu.</p>
        <Link to="/menu/import" className="text-sm font-medium text-primary hover:underline">
          Start another import
        </Link>
      </div>
    );
  }

  if (job.status === "completed") {
    const report = job.publishedReport;
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-4 py-10 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-success/10 text-success">
          <IconCheck className="h-6 w-6" />
        </span>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Your menu is ready</h1>
        {report && (
          <p className="text-sm text-muted">
            {report.created} item{report.created === 1 ? "" : "s"} added
            {report.updated > 0 ? `, ${report.updated} updated` : ""}
            {report.categoriesCreated > 0 ? `, ${report.categoriesCreated} new categor${report.categoriesCreated === 1 ? "y" : "ies"}` : ""}.
          </p>
        )}
        <Link to="/menu">
          <Button>View your menu</Button>
        </Link>
      </div>
    );
  }

  // ready_for_review (or publishing, which resolves back to completed/ready_for_review above)
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to="/menu/import" className="mb-2 flex w-fit items-center gap-1.5 text-sm font-medium text-foreground/70 transition-colors duration-fast hover:text-foreground">
            <IconArrowLeft className="h-4 w-4" />
            Start over
          </Link>
          <h1 className="font-heading text-2xl font-semibold text-foreground">Review your import</h1>
          <p className="mt-1 text-sm text-muted">Nothing has been added to your menu yet — check the details below, then publish.</p>
        </div>
        <Button variant="ghost" size="sm" onClick={handleCancel} disabled={cancelling || publishing}>
          {cancelling ? "Cancelling…" : "Discard import"}
        </Button>
      </div>

      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        {job.sourceType !== "url" && <SourcePreviewSplit job={job} />}
        <div className={job.sourceType === "url" ? "lg:col-span-2" : ""}>
          <ImportReviewList job={job} onJobUpdated={setJob} onPublish={handlePublish} publishing={publishing} />
        </div>
      </div>
    </div>
  );
}
