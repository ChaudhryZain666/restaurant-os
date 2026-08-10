import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { verifyAccessToken } from "../services/token.service.js";
import { env } from "../config/env.js";
import { logger } from "../common/logger.js";

/**
 * Foundation only: authenticated connection + per-user room, no business events yet.
 * Real events (order.created, order.confirmed, order.preparing, order.ready,
 * order.out_for_delivery, order.delivered, order.cancelled) get emitted from the
 * relevant service once the order engine is actually built.
 */
export function createSocketServer(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: { origin: env.CLIENT_ORIGIN, credentials: true },
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
    const { userId, restaurantId } = socket.data;
    socket.join(`user:${userId}`);
    if (restaurantId) socket.join(`restaurant:${restaurantId}`);

    logger.info("socket connected", { userId, restaurantId, socketId: socket.id });

    socket.on("disconnect", (reason) => {
      logger.info("socket disconnected", { userId, socketId: socket.id, reason });
    });
  });

  return io;
}
