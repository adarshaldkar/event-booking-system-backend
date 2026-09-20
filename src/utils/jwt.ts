import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AppError, ErrorCodes } from '../middleware/error.middleware';

export interface JwtPayload {
  sub: string; // user id
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}

export function signToken(
  payloadOrUserId: { sub: string; email: string; role: string } | string,
  email?: string,
  role?: string
): string {
  let payload: { sub: string; email: string; role: string };

  if (typeof payloadOrUserId === 'object') {
    payload = payloadOrUserId;
  } else {
    payload = { sub: payloadOrUserId, email: email!, role: role! };
  }

  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

export function verifyToken(token: string): JwtPayload {
  try {
    return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new AppError(401, ErrorCodes.TOKEN_INVALID, 'Token has expired. Please log in again.');
    }
    throw new AppError(401, ErrorCodes.TOKEN_INVALID, 'Invalid token.');
  }
}
