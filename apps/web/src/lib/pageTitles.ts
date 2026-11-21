/** QA-013 — every storefront page used the HTML shell's generic "Restaurant Ordering" title and no
 *  description. The menu pages set their own (hooks/useStorefrontSeo.ts); this names the rest.
 *  Returns null for paths that title themselves (menu, not-found, no-restaurant). */
const PAGES: [RegExp, string, string][] = [
  [/^\/(r\/[^/]+\/)?cart\/?$/, "Cart", "Review your order and check out."],
  [/^\/(r\/[^/]+\/)?loyalty\/?$/, "Loyalty rewards", "Your points and rewards."],
  [/^\/login\/?$/, "Sign in", "Sign in to order and see your past orders."],
  [/^\/register\/?$/, "Create an account", "Create an account to order online."],
  [/^\/forgot-password\/?$/, "Reset your password", "Get a link to reset your password."],
  [/^\/reset-password\/?$/, "Choose a new password", "Choose a new password for your account."],
  [/^\/verify-email\/?$/, "Verify your email", "Confirm your email address."],
  [/^\/confirm-email-change\/?$/, "Confirm your new email", "Confirm the change to your email address."],
  [/^\/orders\/?$/, "My orders", "Your past and current orders."],
  [/^\/orders\/[^/]+\/?$/, "Order details", "Your order's status and details."],
  [/^\/orders\/[^/]+\/receipt\/?$/, "Receipt", "A printable receipt for your order."],
  [/^\/account\/?$/, "Account", "Your profile, addresses and account settings."],
  [/^\/support\/?$/, "Help center", "Answers to common questions, and how to reach support."],
  [/^\/support\/articles\/[^/]+\/?$/, "Help article", "Help with ordering online."],
  [/^\/support\/tickets\/?$/, "My support requests", "Your support requests and replies."],
  [/^\/support\/tickets\/new\/?$/, "Contact support", "Send a question to support."],
  [/^\/support\/tickets\/[^/]+\/?$/, "Support request", "A support request and its replies."],
];

export interface PageMeta {
  title: string;
  description: string;
}

export function pageMetaFor(pathname: string, siteName: string | null): PageMeta | null {
  const match = PAGES.find(([pattern]) => pattern.test(pathname));
  if (!match) return null;
  const [, page, description] = match;
  return { title: siteName ? `${page} · ${siteName}` : page, description };
}
