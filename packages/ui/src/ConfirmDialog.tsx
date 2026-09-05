import { useEffect, type ReactNode } from "react";
import { Button } from "./Button.js";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  /** Structured detail body (e.g. a plan comparison) — rendered below `description`. */
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" renders the confirm button as destructive — use for actions that remove/disable
   *  something. Plain "default" (a normal primary button) is right for actions that are
   *  consequential but not destructive, like changing a subscription plan. */
  tone?: "default" | "danger";
  busy?: boolean;
  /** Blocks confirming (e.g. an unsafe downgrade) while still letting the user read why and cancel. */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A general-purpose confirmation modal for consequential actions whose blast radius needs more
 * than a single sentence to explain (a plan comparison, a scope statement, a conflict warning) —
 * something `window.confirm()` can't render. Simpler yes/no confirmations elsewhere in this
 * codebase intentionally keep using `window.confirm()` (see Menu/Tables delete, Agency member
 * removal) rather than this component, matching the existing convention; reach for this one only
 * when the confirmation genuinely needs structured content.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  busy = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => !busy && onCancel()}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-dialog-title" className="font-heading text-lg font-semibold text-foreground">
          {title}
        </h2>
        {description && <p className="mt-1.5 text-sm text-muted">{description}</p>}
        {children && <div className="mt-3">{children}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={tone === "danger" ? "destructive" : "primary"}
            size="sm"
            onClick={onConfirm}
            disabled={busy || confirmDisabled}
          >
            {busy ? "Working…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
