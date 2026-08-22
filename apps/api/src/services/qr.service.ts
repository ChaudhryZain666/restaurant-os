import QRCode from "qrcode";

/**
 * Generated on demand, never persisted as a file — the QR image is fully derived from the
 * table's current qrToken (via the URL it encodes), so there's nothing to keep in sync or
 * invalidate separately when a token is regenerated (see tableToken.service.ts). This trades a
 * few milliseconds per request for "the QR the admin sees is always provably current," which
 * matters more here than the cost of re-rendering a tiny PNG.
 */
export async function generateQrDataUrl(targetUrl: string): Promise<string> {
  return QRCode.toDataURL(targetUrl, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 512,
  });
}
