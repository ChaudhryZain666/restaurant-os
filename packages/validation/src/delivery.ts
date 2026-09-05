import { z } from "zod";

export const checkDeliverySchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export type CheckDeliveryInput = z.infer<typeof checkDeliverySchema>;

// Delivery-integrations phase — dispatch/config schemas. See docs/delivery-integrations.md.

export const connectUberDirectAccountSchema = z.object({
  clientId: z.string().min(1).max(500),
  clientSecret: z.string().min(1).max(500),
  customerId: z.string().min(1).max(200),
  webhookSigningSecret: z.string().min(1).max(500),
});
export type ConnectUberDirectAccountInput = z.infer<typeof connectUberDirectAccountSchema>;

export const cancelDeliverySchema = z.object({
  reason: z.string().max(300).optional(),
});
export type CancelDeliveryInput = z.infer<typeof cancelDeliverySchema>;

// Manual-dispatch-only staff actions — advancing a self-fleet delivery one step at a time. A
// third-party provider's own status changes arrive via its webhook instead (see
// deliveryWebhook.controller.ts); this schema is never accepted for a delivery whose provider isn't
// "manual" (deliveryDispatch.service.ts rejects that server-side, not just by omission here).
export const updateManualDeliverySchema = z.object({
  status: z.enum(["driver_assigned", "picked_up", "out_for_delivery", "delivered", "failed"]),
  courierName: z.string().max(200).optional(),
  courierPhone: z.string().max(40).optional(),
  note: z.string().max(300).optional(),
});
export type UpdateManualDeliveryInput = z.infer<typeof updateManualDeliverySchema>;
