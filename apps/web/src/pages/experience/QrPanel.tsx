import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Card } from "@restaurant/ui";

/**
 * Phase 32 — generated entirely client-side (the same `qrcode` package apps/api uses server-side
 * for real dine-in table QR codes, here run in the browser instead) so this needs no new backend
 * endpoint and no abuse surface: it only ever encodes the current page's own URL.
 */
export function QrPanel({ url }: { url: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(url, { margin: 1, width: 220 })
      .then((d) => !cancelled && setDataUrl(d))
      .catch(() => {
        // A failed QR render just means the panel silently shows nothing extra — "Open on phone"
        // below is a fully working fallback either way.
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <Card className="flex flex-col items-center gap-3 p-6 text-center">
      <p className="font-heading text-lg font-semibold text-foreground">Scan to experience it on your phone</p>
      <p className="max-w-xs text-sm text-muted">
        This is exactly what a customer sees after scanning a table QR code or a printed menu card — same
        storefront, same ordering flow.
      </p>
      {dataUrl ? (
        <img src={dataUrl} alt="QR code linking to this demo" width={180} height={180} className="rounded-lg border border-border" />
      ) : (
        <div className="h-[180px] w-[180px] animate-pulse rounded-lg bg-border" aria-hidden />
      )}
      <a href={url} className="text-sm font-medium text-primary hover:underline">
        Or open on this device →
      </a>
    </Card>
  );
}
