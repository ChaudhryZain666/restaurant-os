import type { EmailMessage } from "./EmailService.js";

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html>
  <body style="font-family: -apple-system, sans-serif; background: #f7f2ed; padding: 24px;">
    <div style="max-width: 480px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 32px;">
      <p style="font-weight: 700; font-size: 18px; color: #c2410c; margin: 0 0 24px;">Tablecloth</p>
      <h1 style="font-size: 20px; margin: 0 0 16px;">${title}</h1>
      ${bodyHtml}
    </div>
  </body>
</html>`;
}

export function passwordResetEmail(to: string, resetUrl: string): EmailMessage {
  return {
    to,
    subject: "Reset your Tablecloth password",
    html: layout(
      "Reset your password",
      `<p>We received a request to reset your password. This link expires in 1 hour and can only be used once.</p>
       <p><a href="${resetUrl}" style="color:#c2410c;">Reset your password</a></p>
       <p style="color:#78716c; font-size: 13px;">If you didn't request this, you can safely ignore this email — your password won't change.</p>`
    ),
    text: `Reset your Tablecloth password: ${resetUrl}\n\nThis link expires in 1 hour and can only be used once. If you didn't request this, ignore this email.`,
  };
}

export function emailChangeVerificationEmail(to: string, confirmUrl: string): EmailMessage {
  return {
    to,
    subject: "Confirm your new Tablecloth email address",
    html: layout(
      "Confirm your new email address",
      `<p>We received a request to change the email address on your Tablecloth account to this one. This link expires in 1 hour and can only be used once.</p>
       <p><a href="${confirmUrl}" style="color:#c2410c;">Confirm this email address</a></p>
       <p style="color:#78716c; font-size: 13px;">If you didn't request this, you can safely ignore this email — your account's email address won't change.</p>`
    ),
    text: `Confirm your new Tablecloth email address: ${confirmUrl}\n\nThis link expires in 1 hour and can only be used once. If you didn't request this, ignore this email.`,
  };
}

export function ownerInviteEmail(to: string, acceptUrl: string, details: { restaurantName: string }): EmailMessage {
  return {
    to,
    subject: `You've been invited to set up ${details.restaurantName} on Tablecloth`,
    html: layout(
      `You're invited to set up ${details.restaurantName}`,
      `<p>A Tablecloth platform administrator has created <strong>${details.restaurantName}</strong> and invited you as its owner.</p>
       <p><a href="${acceptUrl}" style="color:#c2410c;">Accept invitation &amp; set your password</a></p>
       <p style="color:#78716c; font-size: 13px;">Once you're in, you'll be guided through setting up your menu and configuration before your restaurant goes live. This invite link expires in 7 days.</p>`
    ),
    text: `A Tablecloth platform administrator has created ${details.restaurantName} and invited you as its owner.\n\nAccept your invitation and set your password: ${acceptUrl}\n\nOnce you're in, you'll be guided through setup before your restaurant goes live. This link expires in 7 days.`,
  };
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
    subject: `You've been invited to join ${details.agencyName} on Tablecloth`,
    html: layout(
      `You're invited to ${details.agencyName}`,
      `<p>${details.inviterName} has invited you to join <strong>${details.agencyName}</strong> as a <strong>${details.roleLabel}</strong>.</p>
       <p><a href="${acceptUrl}" style="color:#c2410c;">${setupLine}</a></p>
       <p style="color:#78716c; font-size: 13px;">This invite link expires in 7 days.</p>`
    ),
    text: `${details.inviterName} invited you to join ${details.agencyName} on Tablecloth as a ${details.roleLabel}.\n\n${setupLine}: ${acceptUrl}\n\nThis link expires in 7 days.`,
  };
}

export function newOrderRestaurantEmail(
  to: string,
  details: { restaurantName: string; orderNumber: string; total: string; orderType: string; ordersUrl: string }
): EmailMessage {
  return {
    to,
    subject: `New order ${details.orderNumber} — ${details.total}`,
    html: layout(
      "You've got a new order",
      `<p><strong>${details.restaurantName}</strong> just received order <strong>${details.orderNumber}</strong>
       (${details.orderType}, ${details.total}).</p>
       <p><a href="${details.ordersUrl}" style="color:#c2410c;">View and accept it</a></p>
       <p style="color:#78716c; font-size: 13px;">You're getting this because no one was watching the live orders
       page when it came in — it's already waiting there too.</p>`
    ),
    text: `${details.restaurantName} just received order ${details.orderNumber} (${details.orderType}, ${details.total}).\n\nView and accept it: ${details.ordersUrl}`,
  };
}

export function orderConfirmationEmail(
  to: string,
  details: { restaurantName: string; orderNumber: string; total: string; orderType: string; trackingUrl: string }
): EmailMessage {
  return {
    to,
    subject: `Your order from ${details.restaurantName} — ${details.orderNumber}`,
    html: layout(
      "Order confirmed",
      `<p>Thanks for your order from <strong>${details.restaurantName}</strong>. We've sent it to the restaurant.</p>
       <p>Order <strong>${details.orderNumber}</strong> · ${details.orderType} · ${details.total}</p>
       <p><a href="${details.trackingUrl}" style="color:#c2410c;">Track your order</a></p>`
    ),
    text: `Thanks for your order from ${details.restaurantName}.\n\nOrder ${details.orderNumber} · ${details.orderType} · ${details.total}\n\nTrack your order: ${details.trackingUrl}`,
  };
}

export function orderCancelledEmail(
  to: string,
  details: { restaurantName: string; orderNumber: string; trackingUrl: string }
): EmailMessage {
  return {
    to,
    subject: `Your order from ${details.restaurantName} was cancelled — ${details.orderNumber}`,
    html: layout(
      "Order cancelled",
      `<p>Order <strong>${details.orderNumber}</strong> from <strong>${details.restaurantName}</strong> has been
       cancelled. If you paid online, any refund will follow the restaurant's usual process.</p>
       <p><a href="${details.trackingUrl}" style="color:#c2410c;">View order details</a></p>`
    ),
    text: `Order ${details.orderNumber} from ${details.restaurantName} has been cancelled.\n\nView order details: ${details.trackingUrl}`,
  };
}

export function paymentReceiptEmail(
  to: string,
  details: { restaurantName: string; orderNumber: string; total: string; trackingUrl: string }
): EmailMessage {
  return {
    to,
    subject: `Payment received — ${details.orderNumber}`,
    html: layout(
      "Payment received",
      `<p>We've received your payment of <strong>${details.total}</strong> for order <strong>${details.orderNumber}</strong>
       from <strong>${details.restaurantName}</strong>.</p>
       <p><a href="${details.trackingUrl}" style="color:#c2410c;">View your order</a></p>`
    ),
    text: `We've received your payment of ${details.total} for order ${details.orderNumber} from ${details.restaurantName}.\n\nView your order: ${details.trackingUrl}`,
  };
}

export function paymentFailedEmail(
  to: string,
  details: { restaurantName: string; orderNumber: string; trackingUrl: string }
): EmailMessage {
  return {
    to,
    subject: `Payment failed — ${details.orderNumber}`,
    html: layout(
      "Payment failed",
      `<p>Your payment for order <strong>${details.orderNumber}</strong> from <strong>${details.restaurantName}</strong>
       didn't go through. No charge was made.</p>
       <p><a href="${details.trackingUrl}" style="color:#c2410c;">Try again</a></p>`
    ),
    text: `Your payment for order ${details.orderNumber} from ${details.restaurantName} didn't go through. No charge was made.\n\nTry again: ${details.trackingUrl}`,
  };
}

export function refundConfirmationEmail(
  to: string,
  details: { restaurantName: string; orderNumber: string; amount: string; trackingUrl: string }
): EmailMessage {
  return {
    to,
    subject: `Refund issued — ${details.orderNumber}`,
    html: layout(
      "Refund issued",
      `<p>A refund of <strong>${details.amount}</strong> has been issued for order <strong>${details.orderNumber}</strong>
       from <strong>${details.restaurantName}</strong>. It may take a few business days to appear on your original
       payment method.</p>
       <p><a href="${details.trackingUrl}" style="color:#c2410c;">View your order</a></p>`
    ),
    text: `A refund of ${details.amount} has been issued for order ${details.orderNumber} from ${details.restaurantName}. It may take a few business days to appear on your original payment method.\n\nView your order: ${details.trackingUrl}`,
  };
}

export function trialEndingEmail(to: string, details: { planName: string; trialEndsAt: string; billingUrl: string }): EmailMessage {
  return {
    to,
    subject: `Your Tablecloth trial ends ${details.trialEndsAt}`,
    html: layout(
      "Your trial is ending soon",
      `<p>Your <strong>${details.planName}</strong> trial ends on <strong>${details.trialEndsAt}</strong>. After that,
       billing begins automatically unless you cancel first.</p>
       <p><a href="${details.billingUrl}" style="color:#c2410c;">Review your plan</a></p>`
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
      `<p>Your last payment for the <strong>${details.planName}</strong> plan didn't go through. Your account keeps
       full access for now — please update your payment method to avoid losing access.</p>
       <p><a href="${details.billingUrl}" style="color:#c2410c;">Update payment method</a></p>`
    ),
    text: `Your last payment for the ${details.planName} plan didn't go through. Your account keeps full access for now — please update your payment method to avoid losing access.\n\nUpdate payment method: ${details.billingUrl}`,
  };
}

export function subscriptionCancelledEmail(to: string, details: { planName: string; billingUrl: string }): EmailMessage {
  return {
    to,
    subject: "Your Tablecloth subscription was cancelled",
    html: layout(
      "Subscription cancelled",
      `<p>Your <strong>${details.planName}</strong> subscription has been cancelled. You're welcome back any time.</p>
       <p><a href="${details.billingUrl}" style="color:#c2410c;">Resubscribe</a></p>`
    ),
    text: `Your ${details.planName} subscription has been cancelled. You're welcome back any time.\n\nResubscribe: ${details.billingUrl}`,
  };
}

export function staffInviteEmail(
  to: string,
  acceptUrl: string,
  details: { restaurantName: string; inviterName: string; roleLabel: string }
): EmailMessage {
  return {
    to,
    subject: `You've been invited to join ${details.restaurantName} on Tablecloth`,
    html: layout(
      `You're invited to ${details.restaurantName}`,
      `<p>${details.inviterName} has invited you to join <strong>${details.restaurantName}</strong> as a <strong>${details.roleLabel}</strong>.</p>
       <p><a href="${acceptUrl}" style="color:#c2410c;">Accept invitation &amp; set your password</a></p>
       <p style="color:#78716c; font-size: 13px;">This invite link expires in 7 days.</p>`
    ),
    text: `${details.inviterName} invited you to join ${details.restaurantName} on Tablecloth as a ${details.roleLabel}.\n\nAccept your invitation and set your password: ${acceptUrl}\n\nThis link expires in 7 days.`,
  };
}
