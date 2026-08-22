import { useEffect, useState } from "react";
import { socket } from "../lib/socket";

export type SocketStatus = "connected" | "connecting" | "disconnected";

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
