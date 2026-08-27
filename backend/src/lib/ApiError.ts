/**
 * Typed application error. Thrown from services/controllers and translated
 * by the error-handling middleware into the standard
 * `{ success: false, error: { code, message } }` response contract —
 * never a raw stack trace.
 */
export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  static badRequest(code: string, message: string, details?: unknown): ApiError {
    return new ApiError(400, code, message, details);
  }
  static unauthorized(code: string, message = 'Unauthorized'): ApiError {
    return new ApiError(401, code, message);
  }
  static forbidden(code: string, message = 'Forbidden'): ApiError {
    return new ApiError(403, code, message);
  }
  static notFound(code: string, message = 'Not found'): ApiError {
    return new ApiError(404, code, message);
  }
  static conflict(code: string, message: string): ApiError {
    return new ApiError(409, code, message);
  }
  static tooManyRequests(code: string, message = 'Too many requests'): ApiError {
    return new ApiError(429, code, message);
  }
  static internal(code: string, message = 'Internal server error'): ApiError {
    return new ApiError(500, code, message);
  }
  static serviceUnavailable(code: string, message: string): ApiError {
    return new ApiError(503, code, message);
  }
}
