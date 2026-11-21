import { ApiClientError } from "@restaurant/utils";

/** QA-007 — what a customer sees when an order can't be opened. Someone else's order (403), a
 *  missing one (404) and a malformed link (400) all read the same, so the page never confirms that
 *  another customer's order exists. The API's own ownership check is unchanged. */
export const ORDER_NOT_FOUND_MESSAGE =
  "We couldn't find that order on your account. Check the link, or open it from My orders.";

export function orderLoadErrorMessage(err: unknown): string {
  if (err instanceof ApiClientError) {
    if (err.status === 400 || err.status === 403 || err.status === 404) return ORDER_NOT_FOUND_MESSAGE;
    if (err.status === 401) return "Sign in to see this order.";
  }
  return "We couldn't load this order right now. Please try again in a moment.";
}
