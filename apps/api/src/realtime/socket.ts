import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { verifyAccessToken } from "../services/token.service.js";
import { canAccessRestaurant } from "../middleware/tenant.js";
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
      socket.data.businessId = payload.businessId;
      socket.data.locationIds = payload.locationIds;
      // Phase 26 — copied so an agency member's requested location can resolve to a real
      // restaurant:{id} room via canAccessRestaurant's agency branch below.
      socket.data.agencyMemberships = payload.agencyMemberships;
      // Phase 19 — a client-supplied locationId (the admin's currently active location; see
      // apps/admin/src/lib/socket.ts) is NEVER trusted on its own, same as any URL param: it only
      // ever takes effect if canAccessRestaurant confirms this specific token's user actually has
      // access to it, using the exact same check every real restaurant-scoped route already
      // enforces (middleware/tenant.ts). If it's absent, or the check fails, this falls back to
      // the token's own baked-in restaurantId exactly as before Phase 19 — never a hard failure
      // just because a stale/unset locationId was sent.
      const requestedLocationId = socket.handshake.auth?.locationId as string | undefined;
      socket.data.roomRestaurantId = payload.restaurantId;
      if (requestedLocationId && requestedLocationId !== payload.restaurantId) {
        canAccessRestaurant(
          {
            id: payload.sub,
            role: payload.role,
            restaurantId: payload.restaurantId,
            businessId: payload.businessId,
            locationIds: payload.locationIds,
            agencyMemberships: payload.agencyMemberships,
          },
          requestedLocationId
        )
          .then((allowed) => {
            if (allowed) socket.data.roomRestaurantId = requestedLocationId;
            next();
          })
          .catch(() => next());
        return;
      }
      next();
    } catch {
      next(new Error("Invalid or expired access token"));
    }
  });

  io.on("connection", (socket) => {
    const { userId, roomRestaurantId, role } = socket.data;
    socket.join(`user:${userId}`);
    if (roomRestaurantId) socket.join(`restaurant:${roomRestaurantId}`);
    // Platform admins aren't restaurant-scoped, so they'd otherwise join no shared room at all —
    // this is how the platform-wide support dashboard receives live ticket updates regardless of
    // which platform_admin happens to be connected. See events/ticketEventListeners.ts.
    if (role === "platform_admin") socket.join("support:platform");

    logger.info("socket connected", { userId, restaurantId: roomRestaurantId, socketId: socket.id });

    socket.on("disconnect", (reason) => {
      logger.info("socket disconnected", { userId, socketId: socket.id, reason });
    });
  });

  ioInstance = io;
  return io;
}
