import { ErrorCode } from "../common/errorCodes.js";

export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;
  public readonly details?: unknown;

  constructor(statusCode: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, ApiError);
  }

  static badRequest(message: string, details?: unknown) {
    return new ApiError(400, ErrorCode.VALIDATION_ERROR, message, details);
  }
  static unauthorized(message = "Unauthorized") {
    return new ApiError(401, ErrorCode.UNAUTHORIZED, message);
  }
  static forbidden(message = "Forbidden") {
    return new ApiError(403, ErrorCode.FORBIDDEN, message);
  }
  static notFound(message = "Not found") {
    return new ApiError(404, ErrorCode.NOT_FOUND, message);
  }
  static conflict(message: string) {
    return new ApiError(409, ErrorCode.CONFLICT, message);
  }
  static tooManyRequests(message: string) {
    return new ApiError(429, ErrorCode.RATE_LIMITED, message);
  }
  static serviceUnavailable(message: string) {
    return new ApiError(503, ErrorCode.INTERNAL_ERROR, message);
  }
}
