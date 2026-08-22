import type { NextFunction, Request, Response } from "express";
import type { ZodTypeAny } from "zod";
import { ApiError } from "../utils/ApiError.js";

export function validateBody(schema: ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return next(ApiError.badRequest("Validation failed", result.error.flatten().fieldErrors));
    }
    req.body = result.data;
    next();
  };
}

export function validateQuery(schema: ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return next(ApiError.badRequest("Validation failed", result.error.flatten().fieldErrors));
    }
    // req.query is normally read-only in newer Express/Node typings — reassigning the parsed
    // (trimmed/typed) value the same way validateBody reassigns req.body keeps downstream
    // handlers reading a single, already-validated shape rather than the raw query object.
    Object.assign(req.query, result.data);
    next();
  };
}

export function validateParams(schema: ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      return next(ApiError.badRequest("Validation failed", result.error.flatten().fieldErrors));
    }
    next();
  };
}
