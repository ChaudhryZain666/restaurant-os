export type TableStatus = "available" | "occupied";

export interface Table {
  id: string;
  restaurantId: string;
  name: string;
  capacity: number;
  section?: string;
  isActive: boolean;
  /** Only present on staff-facing responses — never returned by the public resolve endpoint. */
  qrToken?: string;
  createdAt: string;
}

/** Table plus derived, live operational info — computed from active orders, not stored
 *  (see docs/qr-dine-in-architecture.md's table-status section). Staff-facing only. */
export interface TableWithStatus extends Table {
  status: TableStatus;
  activeOrderCount: number;
  activeOrderNumbers: string[];
}

/** What a customer gets after scanning a QR — deliberately minimal, no restaurantId/qrToken/
 *  internal fields. */
export interface ResolvedTable {
  id: string;
  name: string;
  capacity: number;
  section?: string;
}
