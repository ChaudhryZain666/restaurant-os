import bcrypt from "bcryptjs";
import type { Request, Response } from "express";
import { z } from "zod";
import { User } from "../models/User.js";
import { LoyaltyAccount } from "../models/LoyaltyAccount.js";
import { ApiError } from "../utils/ApiError.js";
import {
  issueRefreshToken,
  isRefreshTokenActive,
  revokeRefreshToken,
  signAccessToken,
  verifyRefreshToken,
} from "../services/token.service.js";

const REFRESH_COOKIE = "refreshToken";

export const registerSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  phone: z.string().min(7).max(20).optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

export async function register(req: Request, res: Response) {
  const { name, email, password, phone } = req.body as z.infer<typeof registerSchema>;

  const existing = await User.findOne({ email });
  if (existing) throw ApiError.conflict("An account with this email already exists");

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({ name, email, passwordHash, phone });
  await LoyaltyAccount.create({ customerId: user._id });

  const accessToken = signAccessToken({ sub: user.id, role: user.role as "customer" });
  const refreshToken = await issueRefreshToken(user.id);
  setRefreshCookie(res, refreshToken);

  res.status(201).json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    accessToken,
  });
}

export async function login(req: Request, res: Response) {
  const { email, password } = req.body as z.infer<typeof loginSchema>;

  const user = await User.findOne({ email });
  if (!user) throw ApiError.unauthorized("Invalid email or password");

  const valid = await bcrypt.compare(password, user.passwordHash as string);
  if (!valid) throw ApiError.unauthorized("Invalid email or password");

  const accessToken = signAccessToken({ sub: user.id, role: user.role as "customer" | "staff" | "admin" });
  const refreshToken = await issueRefreshToken(user.id);
  setRefreshCookie(res, refreshToken);

  res.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    accessToken,
  });
}

export async function refresh(req: Request, res: Response) {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) throw ApiError.unauthorized("Missing refresh token");

  let payload;
  try {
    payload = verifyRefreshToken(token);
  } catch {
    throw ApiError.unauthorized("Invalid or expired refresh token");
  }

  const active = await isRefreshTokenActive(payload.sub, payload.jti);
  if (!active) throw ApiError.unauthorized("Refresh token has been revoked");

  const user = await User.findById(payload.sub);
  if (!user) throw ApiError.unauthorized("User no longer exists");

  await revokeRefreshToken(payload.sub, payload.jti);
  const newRefreshToken = await issueRefreshToken(user.id);
  setRefreshCookie(res, newRefreshToken);

  const accessToken = signAccessToken({ sub: user.id, role: user.role as "customer" | "staff" | "admin" });
  res.json({ accessToken });
}

export async function me(req: Request, res: Response) {
  const user = await User.findById(req.user!.id);
  if (!user) throw ApiError.unauthorized("User no longer exists");
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
}

export async function logout(req: Request, res: Response) {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (token) {
    try {
      const payload = verifyRefreshToken(token);
      await revokeRefreshToken(payload.sub, payload.jti);
    } catch {
      // token already invalid/expired — nothing to revoke
    }
  }
  res.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
  res.status(204).send();
}
