import type { NextFunction, Request, Response } from "express";
import { roleHasPermission, type Permission } from "@restaurant/types";
import { ApiError } from "../utils/ApiError.js";

/** Requires the authenticated user's role to grant ALL of the given permissions. */
export function requirePermission(...permissions: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(ApiError.unauthorized());
    const hasAll = permissions.every((p) => roleHasPermission(req.user!.role, p));
    if (!hasAll) return next(ApiError.forbidden());
    next();
  };
}
