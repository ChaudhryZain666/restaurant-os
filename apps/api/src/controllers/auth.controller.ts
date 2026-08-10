import bcrypt from "bcryptjs";
import type { Request, Response } from "express";
import type { HydratedDocument } from "mongoose";
import type { LoginInput, RegisterInput } from "@restaurant/validation";
import { User, type UserDoc } from "../models/User.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import {
  issueRefreshToken,
  isRefreshTokenActive,
  revokeRefreshToken,
  signAccessToken,
  verifyRefreshToken,
} from "../services/token.service.js";

const REFRESH_COOKIE = "refreshToken";

function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/v1/auth",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

function toPublicUser(user: HydratedDocument<UserDoc>) {
  return {
    id: user.id as string,
    name: user.name,
    email: user.email,
    role: user.role,
    restaurantId: user.restaurantId?.toString(),
  };
}

async function issueSession(res: Response, user: HydratedDocument<UserDoc>) {
  const accessToken = signAccessToken({
    sub: user.id as string,
    role: user.role,
    restaurantId: user.restaurantId?.toString(),
  });
  const refreshToken = await issueRefreshToken(user.id);
  setRefreshCookie(res, refreshToken);
  return accessToken;
}

export async function register(req: Request, res: Response) {
  const { name, email, password, phone } = req.body as RegisterInput;

  const existing = await User.findOne({ email });
  if (existing) throw ApiError.conflict("An account with this email already exists");

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({ name, email, passwordHash, phone });

  const accessToken = await issueSession(res, user);
  sendSuccess(res, { user: toPublicUser(user), accessToken }, 201);
}

export async function login(req: Request, res: Response) {
  const { email, password } = req.body as LoginInput;

  const user = await User.findOne({ email });
  if (!user) throw ApiError.unauthorized("Invalid email or password");

  const valid = await bcrypt.compare(password, user.passwordHash as string);
  if (!valid) throw ApiError.unauthorized("Invalid email or password");

  const accessToken = await issueSession(res, user);
  sendSuccess(res, { user: toPublicUser(user), accessToken });
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
  const accessToken = await issueSession(res, user);
  sendSuccess(res, { accessToken });
}

export async function me(req: Request, res: Response) {
  const user = await User.findById(req.user!.id);
  if (!user) throw ApiError.unauthorized("User no longer exists");
  sendSuccess(res, { user: toPublicUser(user) });
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
  res.clearCookie(REFRESH_COOKIE, { path: "/api/v1/auth" });
  res.status(204).send();
}
