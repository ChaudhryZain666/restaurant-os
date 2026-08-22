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
 * Subscribes to the shared socket's "order:event" stream for the lifetime of the component.
 * `onEvent` is read from a ref, not a hook dependency — callers don't need to useCallback it, and
 * the socket subscription itself doesn't churn on every render. `orderId`, when given, filters to
 * just that order (the server already only ever sends this customer their OWN orders' events —
 * see realtime/socket.ts's per-user room — this is a client-side narrowing on top of that, not a
 * security boundary).
 *
 * This is a trigger, not a data source: callers should re-fetch on event, never apply the payload
 * directly as new state — see socketClient.ts's doc-comment for why (a missed event must not
 * leave the UI stuck, since the next real fetch always restores the correct state regardless).
 */
export function useOrderEvents(onEvent: (event: OrderEventPayload) => void, orderId?: string) {
  const handlerRef = useRef(onEvent);
  useEffect(() => {
    handlerRef.current = onEvent;
  });

  useEffect(() => {
    function handle(payload: OrderEventPayload) {
      if (orderId && payload.orderId !== orderId) return;
      handlerRef.current(payload);
    }
    socket.on("order:event", handle);
    return () => {
      socket.off("order:event", handle);
    };
  }, [orderId]);
}
