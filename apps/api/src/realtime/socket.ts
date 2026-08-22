import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { verifyAccessToken } from "../services/token.service.js";
import { env } from "../config/env.js";
import { logger } from "../common/logger.js";

/**
 * Authenticated connection + per-user room (also per-restaurant, when the token carries one).
 * Order lifecycle events (order.created, order.confirmed, order.preparing, ...) are emitted here
 * via registerOrderEventListeners (see apps/api/src/events/), which pushes an "order:event"
 * message to the relevant user:{id} and restaurant:{id} rooms.
 */
let ioInstance: SocketIOServer | null = null;

/** The live Socket.IO server instance, once createSocketServer has run — null before boot. */
export function getIO(): SocketIOServer | null {
  return ioInstance;
}

export function createSocketServer(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: { origin: [env.CLIENT_ORIGIN, env.ADMIN_ORIGIN], credentials: true },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error("Missing access token"));
    try {
      const payload = verifyAccessToken(token);
      socket.data.userId = payload.sub;
      socket.data.role = payload.role;
      socket.data.restaurantId = payload.restaurantId;
      next();
    } catch {
      next(new Error("Invalid or expired access token"));
    }
  });

  io.on("connection", (socket) => {
    const { userId, restaurantId, role } = socket.data;
    socket.join(`user:${userId}`);
    if (restaurantId) socket.join(`restaurant:${restaurantId}`);
    // Platform admins aren't restaurant-scoped, so they'd otherwise join no shared room at all —
    // this is how the platform-wide support dashboard receives live ticket updates regardless of
    // which platform_admin happens to be connected. See events/ticketEventListeners.ts.
    if (role === "platform_admin") socket.join("support:platform");

    logger.info("socket connected", { userId, restaurantId, socketId: socket.id });

    socket.on("disconnect", (reason) => {
      logger.info("socket disconnected", { userId, socketId: socket.id, reason });
    });
  });

  ioInstance = io;
  return io;
}
