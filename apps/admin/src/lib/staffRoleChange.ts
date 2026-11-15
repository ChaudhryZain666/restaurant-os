import type { UserRole } from "@restaurant/types";

export const STAFF_ROLE_LABELS: Record<string, string> = {
  restaurant_manager: "Manager",
  restaurant_staff: "Staff",
  kitchen_staff: "Kitchen staff",
};

export const STAFF_ROLE_DESCRIPTIONS: Record<string, string> = {
  restaurant_manager: "Full operational access — menu, orders, analytics, tickets.",
  restaurant_staff: "Can view the menu and manage orders.",
  kitchen_staff: "Can view and update order status only.",
};

export interface RoleChangeConfirmation {
  title: string;
  from: string;
  to: string;
  /** What the person will be able to do afterwards. */
  effect: string;
}

/** NEW-3 — what the confirmation shows before a staff member's role changes, or null when the
 *  choice is the role they already have (nothing to confirm or save). */
export function roleChangeConfirmation(name: string, current: UserRole, proposed: UserRole): RoleChangeConfirmation | null {
  if (current === proposed) return null;
  const to = STAFF_ROLE_LABELS[proposed] ?? proposed;
  return {
    title: `Change ${name}'s role to ${to}?`,
    from: STAFF_ROLE_LABELS[current] ?? current,
    to,
    effect: `Their permissions change as soon as you confirm. As ${to}: ${STAFF_ROLE_DESCRIPTIONS[proposed] ?? ""}`.trim(),
  };
}
