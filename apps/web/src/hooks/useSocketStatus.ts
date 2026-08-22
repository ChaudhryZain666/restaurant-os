import { useEffect, useState } from "react";
import { socket } from "../lib/socket";

export type SocketStatus = "connected" | "connecting" | "disconnected";

/** Reconnection itself is handled entirely by socket.io-client (automatic, exponential backoff)
 *  — this hook only surfaces the current state so the UI can say "reconnecting" instead of
 *  silently going stale. Reconnect/disconnect events live on the Manager (socket.io), not the
 *  socket instance itself, per socket.io-client v4's API shape. */
export function useSocketStatus(): SocketStatus {
  const [status, setStatus] = useState<SocketStatus>(socket.connected ? "connected" : "connecting");

  useEffect(() => {
    const onConnect = () => setStatus("connected");
    const onDisconnect = () => setStatus("disconnected");
    const onReconnectAttempt = () => setStatus("connecting");

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.io.on("reconnect_attempt", onReconnectAttempt);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.io.off("reconnect_attempt", onReconnectAttempt);
    };
  }, []);

  return status;
}
