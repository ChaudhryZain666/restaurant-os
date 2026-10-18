import type { EmailMessage } from "./EmailService.js";
import type { EmailBrand } from "../services/emailBranding.service.js";
import type { ContactFormInput } from "@restaurant/validation";

// Every other template in this file only ever interpolates server-generated URLs or names a
// platform_admin typed (provisioning flows) — never genuinely untrusted public input. The Phase 56
// contact-form notification below is the first template to render fields an anonymous visitor
// submitted directly, so it needs real HTML-escaping to stay safe against a submitted name/message
// containing markup.
function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** White-label `email_branding`: the header shows the agency brand instead of GarnishTable, and the
 *  footer says who sent it — with no platform credit when `hide_platform_branding` is also on.
 *  Brand values are escaped/validated here even though they're already validated on input. */
function layout(title: string, bodyHtml: string, brand?: EmailBrand): string {
  const color = brand?.color && HEX_COLOR.test(brand.color) ? brand.color : "#4e1d25";
  const name = brand ? escapeHtml(brand.name) : "GarnishTable";
  const logo = brand?.logo?.startsWith("https://")
    ? `<img src="${escapeHtml(brand.logo)}" alt="${name}" style="max-height: 40px; max-width: 160px; display: block; margin: 0 0 24px;">`
    : `<p style="font-weight: 700; font-size: 18px; color: ${color}; margin: 0 0 24px;">${name}</p>`;
  const footer = brand
    ? `<p style="color:#a8a29e; font-size: 12px; margin: 24px 0 0;">${
        brand.hidePlatformBranding ? `Sent on behalf of ${name}.` : `Sent by ${name} using GarnishTable.`
      }</p>`
    : "";
  return `<!doctype html>
<html>
  <body style="font-family: -apple-system, sans-serif; background: #f7f2ed; padding: 24px;">
    <div style="max-width: 480px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 32px;">
      ${logo}
      <h1 style="font-size: 20px; margin: 0 0 16px;">${escapeHtml(title)}</h1>
      ${bodyHtml}
      ${footer}
    </div>
  </body>
</html>`;
}

/** The product name to use in copy ("…on GarnishTable"): the agency brand when platform branding
 *  is hidden, otherwise the platform. */
function productName(brand?: EmailBrand): string {
  return brand?.hidePlatformBranding ? brand.name : "GarnishTable";
}

/** Attaches the tenant sender identity (display name, verified address, reply-to) to a message. */
function withSender(message: EmailMessage, brand?: EmailBrand): EmailMessage {
  if (!brand) return message;
  return { ...message, from: brand.from, ...(brand.replyTo ? { replyTo: brand.replyTo } : {}) };
}

export function passwordResetEmail(to: string, resetUrl: string): EmailMessage {
  return {
    to,
    subject: "Reset your GarnishTable password",
    html: layout(
      "Reset your password",
      `<p>We received a request to reset your password. This link expires in 1 hour and can only be used once.</p>
       <p><a href="${escapeHtml(resetUrl)}" style="color:#4e1d25;">Reset your password</a></p>
       <p style="color:#78716c; font-size: 13px;">If you didn't request this, you can safely ignore this email — your password won't change.</p>`
    ),
    text: `Reset your GarnishTable password: ${resetUrl}\n\nThis link expires in 1 hour and can only be used once. If you didn't request this, ignore this email.`,
  };
}

export function emailVerificationEmail(to: string, verifyUrl: string): EmailMessage {
  return {
    to,
    subject: "Verify your email to finish setting up GarnishTable",
    html: layout(
      "Verify your email address",
      `<p>Confirm this is really your email address to continue setting up your restaurant. This link expires in 24 hours and can only be used once.</p>
       <p><a href="${escapeHtml(verifyUrl)}" style="color:#4e1d25;">Verify my email address</a></p>
       <p style="color:#78716c; font-size: 13px;">If you didn't create a GarnishTable account, you can safely ignore this email.</p>`
    ),
    text: `Verify your GarnishTable email address: ${verifyUrl}\n\nThis link expires in 24 hours and can only be used once. If you didn't create an account, ignore this email.`,
  };
}

export function emailChangeVerificationEmail(to: string, confirmUrl: string): EmailMessage {
  return {
    to,
    subject: "Confirm your new GarnishTable email address",
    html: layout(
      "Confirm your new email address",
      `<p>We received a request to change the email address on your GarnishTable account to this one. This link expires in 1 hour and can only be used once.</p>
       <p><a href="${escapeHtml(confirmUrl)}" style="color:#4e1d25;">Confirm this email address</a></p>
       <p style="color:#78716c; font-size: 13px;">If you didn't request this, you can safely ignore this email — your account's email address won't change.</p>`
    ),
    text: `Confirm your new GarnishTable email address: ${confirmUrl}\n\nThis link expires in 1 hour and can only be used once. If you didn't request this, ignore this email.`,
  };
}

export function ownerInviteEmail(
  to: string,
  acceptUrl: string,
  details: { restaurantName: string; invitedBy?: string },
  brand?: EmailBrand
): EmailMessage {
  const product = productName(brand);
  const who = details.invitedBy ? escapeHtml(details.invitedBy) : `A ${product} platform administrator`;
  const whoText = details.invitedBy ?? `A ${product} platform administrator`;
  return withSender(
    {
      to,
      subject: `You've been invited to set up ${details.restaurantName} on ${product}`,
      html: layout(
        `You're invited to set up ${details.restaurantName}`,
        `<p>${who} has created <strong>${escapeHtml(details.restaurantName)}</strong> and invited you as its owner.</p>
       <p><a href="${escapeHtml(acceptUrl)}" style="color:#4e1d25;">Accept invitation &amp; set your password</a></p>
       <p style="color:#78716c; font-size: 13px;">Once you're in, you'll be guided through setting up your menu and configuration before your restaurant goes live. This invite link expires in 7 days.</p>`,
        brand
      ),
      text: `${whoText} has created ${details.restaurantName} and invited you as its owner.

Accept your invitation and set your password: ${acceptUrl}

Once you're in, you'll be guided through setup before your restaurant goes live. This link expires in 7 days.`,
    },
    brand
  );
}

export function agencyMemberInviteEmail(
  to: string,
  acceptUrl: string,
  details: { agencyName: string; inviterName: string; roleLabel: string; isNewAccount: boolean }
): EmailMessage {
  const setupLine = details.isNewAccount
    ? "Accept your invitation and set your password"
    : "Accept your invitation";
  return {
    to,
    subject: `You've been invited to join ${details.agencyName} on GarnishTable`,
    html: layout(
      `You're invited to ${details.agencyName}`,
      `<p>${escapeHtml(details.inviterName)} has invited you to join <strong>${escapeHtml(details.agencyName)}</strong> as a <strong>${escapeHtml(details.roleLabel)}</strong>.</p>
       <p><a href="${escapeHtml(acceptUrl)}" style="color:#4e1d25;">${escapeHtml(setupLine)}</a></p>
       <p style="color:#78716c; font-size: 13px;">This invite link expires in 7 days.</p>`
    ),
    text: `${details.inviterName} invited you to join ${details.agencyName} on GarnishTable as a ${details.roleLabel}.\n\n${setupLine}: ${acceptUrl}\n\nThis link expires in 7 days.`,
  };
}

export function newOrderRestaurantEmail(
  to: string,
  details: { restaurantName: string; orderNumber: string; total: string; orderType: string; ordersUrl: string },
  brand?: EmailBrand
): EmailMessage {
  return withSender({
    to,
    subject: `New order ${details.orderNumber} — ${details.total}`,
    html: layout(
      "You've got a new order",
      `<p><strong>${escapeHtml(details.restaurantName)}</strong> just received order <strong>${escapeHtml(details.orderNumber)}</strong>
       (${escapeHtml(details.orderType)}, ${escapeHtml(details.total)}).</p>
       <p><a href="${escapeHtml(details.ordersUrl)}" style="color:#4e1d25;">View and accept it</a></p>
       <p style="color:#78716c; font-size: 13px;">You're getting this because no one was watching the live orders
       page when it came in — it's already waiting there too.</p>`,
      brand
    ),
    text: `${details.restaurantName} just received order ${details.orderNumber} (${details.orderType}, ${details.total}).\n\nView and accept it: ${details.ordersUrl}`,
  }, brand);
}

export function orderConfirmationEmail(
  to: string,
  details: { restaurantName: string; orderNumber: string; total: string; orderType: string; trackingUrl: string },
  brand?: EmailBrand
): EmailMessage {
  return withSender({
    to,
    subject: `Your order from ${details.restaurantName} — ${details.orderNumber}`,
    html: layout(
      "Order confirmed",
      `<p>Thanks for your order from <strong>${escapeHtml(details.restaurantName)}</strong>. We've sent it to the restaurant.</p>
       <p>Order <strong>${escapeHtml(details.orderNumber)}</strong> · ${escapeHtml(details.orderType)} · ${escapeHtml(details.total)}</p>
       <p><a href="${escapeHtml(details.trackingUrl)}" style="color:#4e1d25;">Track your order</a></p>`,
      brand
    ),
    text: `Thanks for your order from ${details.restaurantName}.\n\nOrder ${details.orderNumber} · ${details.orderType} · ${details.total}\n\nTrack your order: ${details.trackingUrl}`,
  }, brand);
}

export function orderCancelledEmail(
  to: string,
  details: { restaurantName: string; orderNumber: string; trackingUrl: string },
  brand?: EmailBrand
): EmailMessage {
  return withSender({
    to,
    subject: `Your order from ${details.restaurantName} was cancelled — ${details.orderNumber}`,
    html: layout(
      "Order cancelled",
      `<p>Order <strong>${escapeHtml(details.orderNumber)}</strong> from <strong>${escapeHtml(details.restaurantName)}</strong> has been
       cancelled. If you paid online, any refund will follow the restaurant's usual process.</p>
       <p><a href="${escapeHtml(details.trackingUrl)}" style="color:#4e1d25;">View order details</a></p>`,
      brand
    ),
    text: `Order ${details.orderNumber} from ${details.restaurantName} has been cancelled.\n\nView order details: ${details.trackingUrl}`,
  }, brand);
}

export function paymentReceiptEmail(
  to: string,
  details: { restaurantName: string; orderNumber: string; total: string; trackingUrl: string },
  brand?: EmailBrand
): EmailMessage {
  return withSender({
    to,
    subject: `Payment received — ${details.orderNumber}`,
    html: layout(
      "Payment received",
      `<p>We've received your payment of <strong>${escapeHtml(details.total)}</strong> for order <strong>${escapeHtml(details.orderNumber)}</strong>
       from <strong>${escapeHtml(details.restaurantName)}</strong>.</p>
       <p><a href="${escapeHtml(details.trackingUrl)}" style="color:#4e1d25;">View your order</a></p>`,
      brand
    ),
    text: `We've received your payment of ${details.total} for order ${details.orderNumber} from ${details.restaurantName}.\n\nView your order: ${details.trackingUrl}`,
  }, brand);
}

export function paymentFailedEmail(
  to: string,
  details: { restaurantName: string; orderNumber: string; trackingUrl: string },
  brand?: EmailBrand
): EmailMessage {
  return withSender({
    to,
    subject: `Payment failed — ${details.orderNumber}`,
    html: layout(
      "Payment failed",
      `<p>Your payment for order <strong>${escapeHtml(details.orderNumber)}</strong> from <strong>${escapeHtml(details.restaurantName)}</strong>
       didn't go through. No charge was made.</p>
       <p><a href="${escapeHtml(details.trackingUrl)}" style="color:#4e1d25;">Try again</a></p>`,
      brand
    ),
    text: `Your payment for order ${details.orderNumber} from ${details.restaurantName} didn't go through. No charge was made.\n\nTry again: ${details.trackingUrl}`,
  }, brand);
}

export function refundConfirmationEmail(
  to: string,
  details: { restaurantName: string; orderNumber: string; amount: string; trackingUrl: string },
  brand?: EmailBrand
): EmailMessage {
  return withSender({
    to,
    subject: `Refund issued — ${details.orderNumber}`,
    html: layout(
      "Refund issued",
      `<p>A refund of <strong>${escapeHtml(details.amount)}</strong> has been issued for order <strong>${escapeHtml(details.orderNumber)}</strong>
       from <strong>${escapeHtml(details.restaurantName)}</strong>. It may take a few business days to appear on your original
       payment method.</p>
       <p><a href="${escapeHtml(details.trackingUrl)}" style="color:#4e1d25;">View your order</a></p>`,
      brand
    ),
    text: `A refund of ${details.amount} has been issued for order ${details.orderNumber} from ${details.restaurantName}. It may take a few business days to appear on your original payment method.\n\nView your order: ${details.trackingUrl}`,
  }, brand);
}

export function trialEndingEmail(to: string, details: { planName: string; trialEndsAt: string; billingUrl: string }): EmailMessage {
  return {
    to,
    subject: `Your GarnishTable trial ends ${details.trialEndsAt}`,
    html: layout(
      "Your trial is ending soon",
      `<p>Your <strong>${escapeHtml(details.planName)}</strong> trial ends on <strong>${escapeHtml(details.trialEndsAt)}</strong>. After that,
       billing begins automatically unless you cancel first.</p>
       <p><a href="${escapeHtml(details.billingUrl)}" style="color:#4e1d25;">Review your plan</a></p>`
    ),
    text: `Your ${details.planName} trial ends on ${details.trialEndsAt}. After that, billing begins automatically unless you cancel first.\n\nReview your plan: ${details.billingUrl}`,
  };
}

export function subscriptionPastDueEmail(to: string, details: { planName: string; billingUrl: string }): EmailMessage {
  return {
    to,
    subject: "Your last payment didn't go through",
    html: layout(
      "Payment failed",
      `<p>Your last payment for the <strong>${escapeHtml(details.planName)}</strong> plan didn't go through. Your account keeps
       full access for now — please update your payment method to avoid losing access.</p>
       <p><a href="${escapeHtml(details.billingUrl)}" style="color:#4e1d25;">Update payment method</a></p>`
    ),
    text: `Your last payment for the ${details.planName} plan didn't go through. Your account keeps full access for now — please update your payment method to avoid losing access.\n\nUpdate payment method: ${details.billingUrl}`,
  };
}

export function subscriptionCancelledEmail(to: string, details: { planName: string; billingUrl: string }): EmailMessage {
  return {
    to,
    subject: "Your GarnishTable subscription was cancelled",
    html: layout(
      "Subscription cancelled",
      `<p>Your <strong>${escapeHtml(details.planName)}</strong> subscription has been cancelled. You're welcome back any time.</p>
       <p><a href="${escapeHtml(details.billingUrl)}" style="color:#4e1d25;">Resubscribe</a></p>`
    ),
    text: `Your ${details.planName} subscription has been cancelled. You're welcome back any time.\n\nResubscribe: ${details.billingUrl}`,
  };
}

export function staffInviteEmail(
  to: string,
  acceptUrl: string,
  details: { restaurantName: string; inviterName: string; roleLabel: string },
  brand?: EmailBrand
): EmailMessage {
  const product = productName(brand);
  return withSender(
    {
      to,
      subject: `You've been invited to join ${details.restaurantName} on ${product}`,
      html: layout(
        `You're invited to ${details.restaurantName}`,
        `<p>${escapeHtml(details.inviterName)} has invited you to join <strong>${escapeHtml(details.restaurantName)}</strong> as a <strong>${escapeHtml(details.roleLabel)}</strong>.</p>
       <p><a href="${escapeHtml(acceptUrl)}" style="color:#4e1d25;">Accept invitation &amp; set your password</a></p>
       <p style="color:#78716c; font-size: 13px;">This invite link expires in 7 days.</p>`,
        brand
      ),
      text: `${details.inviterName} invited you to join ${details.restaurantName} on ${product} as a ${details.roleLabel}.

Accept your invitation and set your password: ${acceptUrl}

This link expires in 7 days.`,
    },
    brand
  );
}

/** Phase 56 — internal notification sent to CONTACT_NOTIFICATION_EMAIL when the marketing site's
 *  Contact page or "Request a guided demo" lead form (LeadForm.tsx) is submitted. `to` here is the
 *  team, not the submitter — this is not a confirmation email to the visitor, matching the honest
 *  "our team follows up" copy both forms show. Every field below came from an anonymous,
 *  unauthenticated public submission, so the HTML body escapes it — unlike this file's other
 *  templates, which only ever interpolate server-generated or platform_admin-typed values. */
export function contactFormNotificationEmail(to: string, fields: ContactFormInput): EmailMessage {
  const rows: Array<[string, string | undefined]> = [
    ["Name", fields.name],
    ["Email", fields.email],
    ["Phone", fields.phone],
    ["Reason", fields.reason],
    ["Business / restaurant", fields.businessName],
    ["Restaurant type", fields.restaurantType],
    ["Locations", fields.locationCount?.toString()],
    ["Role", fields.role],
    ["Interested in", fields.interests?.join(", ")],
  ];
  const htmlRows = rows
    .filter(([, value]) => value)
    .map(([label, value]) => `<p style="margin:0 0 6px;"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value!)}</p>`)
    .join("\n");
  const textRows = rows
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");

  return {
    to,
    subject: `New contact form submission from ${fields.name}`,
    html: layout(
      "New contact form submission",
      `${htmlRows}
       ${fields.message ? `<p style="margin-top:16px;"><strong>Message:</strong><br/>${escapeHtml(fields.message).replace(/\n/g, "<br/>")}</p>` : ""}`
    ),
    text: `${textRows}${fields.message ? `\n\nMessage:\n${fields.message}` : ""}`,
  };
}
