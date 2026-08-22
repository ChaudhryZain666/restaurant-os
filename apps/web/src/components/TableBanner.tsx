import { useTable } from "../context/TableContext";

/** Mirrors AvailabilityBanner's pattern — driven entirely by TableContext's resolved state. */
export function TableBanner() {
  const { table, error, clearTable } = useTable();

  if (table) {
    return (
      <div role="status" className="animate-slide-up border-b border-primary/20 bg-primary/5 px-4 py-2.5 text-center sm:px-6">
        <p className="flex flex-wrap items-center justify-center gap-2 text-sm font-medium text-foreground">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
          Ordering for <strong>{table.name}</strong>
          <button onClick={clearTable} className="text-primary underline-offset-2 hover:underline" type="button">
            Not your table?
          </button>
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div role="status" className="animate-slide-up border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-center sm:px-6">
        <p className="text-sm font-medium text-amber-900">
          That table code isn't valid anymore — please ask staff for a fresh QR code, or order for pickup/delivery below.
        </p>
      </div>
    );
  }

  return null;
}
