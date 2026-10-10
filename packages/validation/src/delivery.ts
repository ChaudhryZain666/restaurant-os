import { z } from "zod";

export const checkDeliverySchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  })
  // Phase 47 — same guard as order.ts/pos.ts's deliveryAddressInputSchema: (0, 0) is syntactically
  // valid but never a real customer location.
  .refine((v) => !(v.latitude === 0 && v.longitude === 0), {
    message: "A real, geocoded location is required",
    path: ["latitude"],
  });
export type CheckDeliveryInput = z.infer<typeof checkDeliverySchema>;

// Delivery-integrations phase — dispatch/config schemas. See docs/delivery-integrations.md.

export const connectUberDirectAccountSchema = z.object({
  clientId: z.string().min(1).max(500),
  clientSecret: z.string().min(1).max(500),
  customerId: z.string().min(1).max(200),
  // Phase 89 — optional at connect: Uber only issues the signing secret once our webhook URL is
  // registered in its dashboard, and that URL only exists after connecting. Added later with
  // updateDeliveryWebhookSecretSchema; webhooks are rejected until then.
  webhookSigningSecret: z.string().min(1).max(500).optional(),
});
export type ConnectUberDirectAccountInput = z.infer<typeof connectUberDirectAccountSchema>;

export const updateDeliveryWebhookSecretSchema = z.object({
  webhookSigningSecret: z.string().trim().min(1).max(500),
});
export type UpdateDeliveryWebhookSecretInput = z.infer<typeof updateDeliveryWebhookSecretSchema>;

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
