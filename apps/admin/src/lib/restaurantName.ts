/** QA-005 — the same rule the API enforces (updateRestaurantSchema: trimmed, 2-120 characters),
 *  checked before saving so the owner gets a message on the field instead of a failed request.
 *  The server still validates every save. */
export function restaurantNameError(name: string | undefined | null): string | null {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "Enter a restaurant name.";
  if (trimmed.length < 2) return "Restaurant name must be at least 2 characters";
  if (trimmed.length > 120) return "Restaurant name must be 120 characters or fewer";
  return null;
}

/** The server's message for the name field, if the API refused the name. */
export function serverNameError(details: unknown): string | null {
  if (!details || typeof details !== "object") return null;
  const messages = (details as Record<string, unknown>).name;
  return Array.isArray(messages) && typeof messages[0] === "string" ? messages[0] : null;
}
