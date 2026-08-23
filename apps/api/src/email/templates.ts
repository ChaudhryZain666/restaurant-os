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
