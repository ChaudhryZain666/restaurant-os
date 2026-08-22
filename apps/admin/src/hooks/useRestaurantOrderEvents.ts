import { useEffect, useRef } from "react";
import { socket } from "../lib/socket";

export interface OrderEventPayload {
  type: string;
  orderId: string;
  orderNumber: string;
  restaurantId: string;
  customerId: string;
  status: string;
}

/**
 * Restaurant-scoped equivalent of apps/web/src/hooks/useOrderEvents.ts — same shape, same
 * "trigger a re-fetch, never apply the payload as state" rule (see socketClient.ts). Used by both
 * OrdersManagementPage and KitchenPage, since both just need "something about this restaurant's
 * orders changed, go reload."
 */
export function useRestaurantOrderEvents(onEvent: (event: OrderEventPayload) => void) {
  const handlerRef = useRef(onEvent);
  useEffect(() => {
    handlerRef.current = onEvent;
  });

  useEffect(() => {
    function handle(payload: OrderEventPayload) {
      handlerRef.current(payload);
    }
    socket.on("order:event", handle);
    return () => {
      socket.off("order:event", handle);
    };
  }, []);
}
