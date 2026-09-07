import type { Order, PrintDocument, PrinterPaperWidthMm } from "@restaurant/types";
import { buildEscposBase64 } from "./escpos.js";

/** Trivial, presentational-only — not worth pulling the whole @restaurant/utils package (which
 *  transitively depends on socket.io-client, a browser/Node client library with no reason to load
 *  into this backend process) in for one Intl.NumberFormat call identical to the frontend's own. */
function formatMoney(amount: number, currency: string | undefined): string {
  if (!currency) return amount.toFixed(2);
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return amount.toFixed(2);
  }
}

function orderTypeLabel(order: Order): string {
  const base = order.orderType.replace("_", " ");
  return order.orderType === "dine_in" && order.tableName ? `${base} — ${order.tableName}` : base;
}

/**
 * Customer receipt content — same field selection as PrintOrderPage.tsx's receipt mode (never
 * fabricates a field that order doesn't actually carry, e.g. no "amount tendered"/"change" line
 * since the order model has no tendered-amount field to source it from).
 */
export function buildReceiptDocument(order: Order, paperWidthMm: PrinterPaperWidthMm): PrintDocument {
  const lines: PrintDocument["lines"] = [];
  lines.push({ type: "text", text: order.restaurantName ?? "Restaurant", bold: true, align: "center" });
  if (order.restaurantAddress) lines.push({ type: "text", text: order.restaurantAddress, align: "center" });
  if (order.restaurantPhone) lines.push({ type: "text", text: order.restaurantPhone, align: "center" });
  lines.push({ type: "rule" });
  lines.push({ type: "text", text: "RECEIPT", bold: true });
  lines.push({ type: "text", text: `Order #${order.orderNumber}` });
  lines.push({ type: "text", text: new Date(order.createdAt).toLocaleString() });
  lines.push({ type: "text", text: orderTypeLabel(order) });
  if (order.orderType === "delivery" && order.deliveryAddress) {
    const addr = [
      order.deliveryAddress.line1,
      order.deliveryAddress.line2,
      order.deliveryAddress.city,
      order.deliveryAddress.state,
      order.deliveryAddress.postalCode,
    ]
      .filter(Boolean)
      .join(", ");
    lines.push({ type: "text", text: addr });
  }
  lines.push({ type: "rule" });
  for (const item of order.items) {
    lines.push({ type: "row", left: `${item.quantity} x ${item.name}`, right: formatMoney(item.lineTotal, order.currency) });
    if (item.selectedModifiers.length > 0) {
      lines.push({ type: "text", text: `  ${item.selectedModifiers.map((m) => m.optionName).join(", ")}` });
    }
    if (item.specialInstructions) lines.push({ type: "text", text: `  "${item.specialInstructions}"` });
  }
  lines.push({ type: "rule" });
  lines.push({ type: "row", left: "Subtotal", right: formatMoney(order.subtotal, order.currency) });
  if (order.discount > 0) {
    lines.push({ type: "row", left: `Discount${order.promoCode ? ` (${order.promoCode})` : ""}`, right: `-${formatMoney(order.discount, order.currency)}` });
  }
  if (order.deliveryFee > 0) lines.push({ type: "row", left: "Delivery fee", right: formatMoney(order.deliveryFee, order.currency) });
  lines.push({ type: "row", left: "Tax", right: formatMoney(order.taxAmount, order.currency) });
  lines.push({ type: "row", left: "Total", right: formatMoney(order.total, order.currency), bold: true });
  lines.push({ type: "rule" });
  const paymentLabel =
    order.paymentMethod === "online" ? `Paid online · ${order.paymentStatus}` : order.paymentMethod === "card" ? `Card · ${order.paymentStatus}` : `Cash · ${order.paymentStatus}`;
  lines.push({ type: "text", text: paymentLabel });
  lines.push({ type: "spacer" });
  lines.push({ type: "text", text: "Thank you!", align: "center" });

  return { title: "Receipt", lines, escposBase64: buildEscposBase64({ title: "Receipt", lines, escposBase64: "" }, paperWidthMm) };
}

/**
 * Kitchen ticket content — same field selection as PrintOrderPage.tsx's ticket mode. Deliberately
 * omits prices/payment method/payment status (kitchen staff don't need pricing information to
 * prepare food — see Section 6's "do not unnecessarily expose sensitive payment/customer
 * information to kitchen staff").
 */
export function buildKitchenTicketDocument(order: Order, paperWidthMm: PrinterPaperWidthMm): PrintDocument {
  const lines: PrintDocument["lines"] = [];
  lines.push({ type: "text", text: order.restaurantName ?? "Restaurant", bold: true, align: "center" });
  lines.push({ type: "rule" });
  lines.push({ type: "text", text: "KITCHEN TICKET", bold: true });
  lines.push({ type: "text", text: `Order #${order.orderNumber}` });
  lines.push({ type: "text", text: new Date(order.createdAt).toLocaleString() });
  lines.push({ type: "text", text: orderTypeLabel(order) });
  if (order.customerName || order.customerPhone) {
    lines.push({ type: "text", text: [order.customerName, order.customerPhone].filter(Boolean).join(" · ") });
  }
  if (order.orderType === "delivery" && order.deliveryAddress) {
    const addr = [
      order.deliveryAddress.line1,
      order.deliveryAddress.line2,
      order.deliveryAddress.city,
      order.deliveryAddress.state,
      order.deliveryAddress.postalCode,
    ]
      .filter(Boolean)
      .join(", ");
    lines.push({ type: "text", text: addr });
  }
  lines.push({ type: "rule" });
  for (const item of order.items) {
    lines.push({ type: "text", text: `${item.quantity} x ${item.name}`, bold: true });
    if (item.selectedModifiers.length > 0) {
      lines.push({ type: "text", text: `  ${item.selectedModifiers.map((m) => m.optionName).join(", ")}` });
    }
    if (item.specialInstructions) lines.push({ type: "text", text: `  "${item.specialInstructions}"` });
  }
  if (order.customerNotes) {
    lines.push({ type: "rule" });
    lines.push({ type: "text", text: `Notes: ${order.customerNotes}` });
  }

  return { title: "Kitchen ticket", lines, escposBase64: buildEscposBase64({ title: "Kitchen ticket", lines, escposBase64: "" }, paperWidthMm) };
}

/** A test print never touches a real Order — canned content only, clearly labeled so it can never
 *  be mistaken for a real receipt/ticket (Section 14: never fabricate an Order to test printing). */
export function buildTestDocument(printerName: string, paperWidthMm: PrinterPaperWidthMm): PrintDocument {
  const lines: PrintDocument["lines"] = [
    { type: "text", text: "TEST PRINT", bold: true, align: "center" },
    { type: "rule" },
    { type: "text", text: `Printer: ${printerName}` },
    { type: "text", text: `Paper width: ${paperWidthMm}mm` },
    { type: "text", text: new Date().toLocaleString() },
    { type: "rule" },
    { type: "row", left: "Sample item", right: "$0.00" },
    { type: "text", text: "If you can read this clearly, the printer is connected and working." },
  ];
  return { title: "Test print", lines, escposBase64: buildEscposBase64({ title: "Test print", lines, escposBase64: "" }, paperWidthMm) };
}
