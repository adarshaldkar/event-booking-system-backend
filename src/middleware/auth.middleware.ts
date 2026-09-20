import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt';
import { prisma } from '../config/database';
import { AppError, ErrorCodes } from './error.middleware';
import { Role } from '@prisma/client';

// Extends Express Request to carry the authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: Role;
        isVerified: boolean;
      };
    }
  }
}

/**
 * Authentication middleware — verifies Bearer JWT token and attaches user to req.user
 */
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError(401, ErrorCodes.TOKEN_MISSING, 'Authentication token is required. Please provide a Bearer token.');
    }

    const token = authHeader.split(' ')[1];
    const payload = verifyToken(token);

    // Verify user in database
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true, isVerified: true },
    });

    if (!user) {
      throw new AppError(401, ErrorCodes.TOKEN_INVALID, 'User account associated with this token no longer exists.');
    }

    if (!user.isVerified) {
      throw new AppError(403, ErrorCodes.ACCOUNT_UNVERIFIED, 'User account is not verified.');
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

// Alias for backwards-compatibility
export const authenticateToken = authenticate;

/**
 * RBAC middleware — checks if authenticated user has one of allowed roles
 */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new AppError(401, ErrorCodes.TOKEN_MISSING, 'Authentication required.'));
    }
    if (!roles.includes(req.user.role)) {
      return next(
        new AppError(
          403,
          ErrorCodes.FORBIDDEN,
          `Access denied. Requires one of the following roles: ${roles.join(', ')}.`
        )
      );
    }
    next();
  };
}
