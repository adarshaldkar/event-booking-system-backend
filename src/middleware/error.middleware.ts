import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;
  public readonly details?: any;

  constructor(statusCode: number, code: string, message: string, details?: any) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

// Known application error codes
export const ErrorCodes = {
  // Auth
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_UNVERIFIED: 'ACCOUNT_UNVERIFIED',
  INVALID_OTP: 'INVALID_OTP',
  OTP_EXPIRED: 'OTP_EXPIRED',
  MAX_OTP_ATTEMPTS_EXCEEDED: 'MAX_OTP_ATTEMPTS_EXCEEDED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  TOKEN_MISSING: 'TOKEN_MISSING',
  EMAIL_EXISTS: 'EMAIL_EXISTS',
  ALREADY_VERIFIED: 'ALREADY_VERIFIED',

  // RBAC
  FORBIDDEN: 'FORBIDDEN',
  NOT_OWNER: 'NOT_OWNER',

  // Events
  EVENT_NOT_FOUND: 'EVENT_NOT_FOUND',
  EVENT_CANCELLED: 'EVENT_CANCELLED',
  EVENT_ALREADY_STARTED: 'EVENT_ALREADY_STARTED',

  // Bookings
  SOLD_OUT: 'SOLD_OUT',
  INSUFFICIENT_TICKETS: 'INSUFFICIENT_TICKETS',
  BOOKING_NOT_FOUND: 'BOOKING_NOT_FOUND',
  ALREADY_CANCELLED: 'ALREADY_CANCELLED',
  DUPLICATE_BOOKING: 'DUPLICATE_BOOKING',
  PAST_EVENT: 'PAST_EVENT',
  INVALID_TICKET_COUNT: 'INVALID_TICKET_COUNT',

  // Generic
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
} as const;

// Global error-handling middleware — always last in Express middleware chain
export function errorHandler(
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // 1. Operational (expected) AppError
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    });
    return;
  }

  // 1b. Malformed JSON parse error from body-parser
  if (err.type === 'entity.parse.failed' || (err instanceof SyntaxError && 'body' in err)) {
    res.status(400).json({
      success: false,
      error: {
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Malformed JSON payload in request body.',
      },
    });
    return;
  }

  // 2. Zod validation errors
  if (err instanceof ZodError) {
    const details = err.errors.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    }));
    res.status(400).json({
      success: false,
      error: {
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Validation failed for the request payload.',
        details,
      },
    });
    return;
  }

  // 3. Prisma unique constraint violation (P2002)
  if (err.code === 'P2002') {
    res.status(409).json({
      success: false,
      error: {
        code: ErrorCodes.EMAIL_EXISTS,
        message: 'A resource with this unique value already exists.',
      },
    });
    return;
  }

  // 4. JWT errors
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    res.status(401).json({
      success: false,
      error: {
        code: ErrorCodes.TOKEN_INVALID,
        message: 'Invalid or expired authentication token.',
      },
    });
    return;
  }

  // 5. Unknown / internal errors
  console.error('💥 Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: {
      code: ErrorCodes.INTERNAL_ERROR,
      message: 'An unexpected error occurred. Please try again later.',
    },
  });
}

// 404 handler
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: {
      code: ErrorCodes.NOT_FOUND,
      message: `Route ${req.method} ${req.path} not found.`,
    },
  });
}
