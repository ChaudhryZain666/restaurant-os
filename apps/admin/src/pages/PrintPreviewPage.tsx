import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { PrintJob } from "@restaurant/types";
import { apiClient } from "../lib/api";
import { useActiveLocationId } from "../context/LocationContext";

/**
 * Phase 57 — the browser_print rendering for a PrintJob with no underlying order (currently only
 * test prints — see Section 14: a test print never touches a real Order). Mirrors
 * PrintOrderPage.tsx's own browser-print approach (no Layout wrapper, auto window.print(), reports
 * its outcome via `afterprint`) but renders the job's own generic structured document instead of
 * order-specific fields, since there is no order to fetch here.
 */
export function PrintPreviewPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const restaurantId = useActiveLocationId();
  const [job, setJob] = useState<PrintJob | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .request<{ printJob: PrintJob }>(`/restaurants/${restaurantId}/print-jobs/${jobId}`)
      .then((data) => setJob(data.printJob))
      .catch((err) => setError((err as Error).message));
  }, [jobId, restaurantId]);

  useEffect(() => {
    if (!job) return;
    const t = setTimeout(() => window.print(), 150);
    const reportOutcome = () => {
      apiClient.request(`/restaurants/${restaurantId}/print-jobs/${jobId}`, { method: "PATCH", body: { status: "printed" } }).catch(() => undefined);
    };
    window.addEventListener("afterprint", reportOutcome);
    return () => {
      clearTimeout(t);
      window.removeEventListener("afterprint", reportOutcome);
    };
  }, [job, restaurantId, jobId]);

  if (error) return <p className="p-6 text-danger">{error}</p>;
  if (!job) return <p className="p-6 text-muted">Loading...</p>;

  return (
    <div className="mx-auto max-w-sm p-6 font-mono text-sm text-black">
      {job.document.lines.map((line, i) => {
        if (line.type === "rule") return <hr key={i} className="my-2 border-dashed border-black" />;
        if (line.type === "spacer") return <div key={i} className="h-3" />;
        if (line.type === "row") {
          return (
            <div key={i} className={`flex justify-between ${line.bold ? "font-bold" : ""}`}>
              <span>{line.left}</span>
              <span>{line.right}</span>
            </div>
          );
        }
        return (
          <p key={i} className={`${line.bold ? "font-bold" : ""} ${line.align === "center" ? "text-center" : line.align === "right" ? "text-right" : ""}`}>
            {line.text}
          </p>
        );
      })}
    </div>
  );
}
