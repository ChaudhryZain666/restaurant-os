import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { redis } from "../config/redis.js";
import { parseTtlSeconds } from "../utils/ttl.js";
import type { UserRole } from "@restaurant/types";

export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
  restaurantId?: string;
  /** Phase 18, additive — re-derived from the current User document at every sign/refresh (never
   *  copied from an old token), so a location grant change takes effect on next login/refresh. */
  businessId?: string;
  locationIds?: string[];
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string;
}

function refreshKey(userId: string, jti: string) {
  return `refresh:${userId}:${jti}`;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: parseTtlSeconds(env.ACCESS_TOKEN_TTL) });
}

export async function issueRefreshToken(userId: string): Promise<string> {
  const jti = randomUUID();
  const ttlSeconds = parseTtlSeconds(env.REFRESH_TOKEN_TTL);
  const token = jwt.sign({ sub: userId, jti }, env.JWT_REFRESH_SECRET, { expiresIn: ttlSeconds });
  await redis.set(refreshKey(userId, jti), "1", "EX", ttlSeconds);
  return token;
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as RefreshTokenPayload;
}

export async function isRefreshTokenActive(userId: string, jti: string): Promise<boolean> {
  const exists = await redis.get(refreshKey(userId, jti));
  return exists !== null;
}

export async function revokeRefreshToken(userId: string, jti: string): Promise<void> {
  await redis.del(refreshKey(userId, jti));
}

export async function revokeAllRefreshTokens(userId: string): Promise<void> {
  const keys = await redis.keys(refreshKey(userId, "*"));
  if (keys.length > 0) await redis.del(...keys);
}
