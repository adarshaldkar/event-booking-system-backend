import rateLimit from 'express-rate-limit';
import { AppError, ErrorCodes } from './error.middleware';

// Auth endpoints — strict limits to prevent OTP brute-force and account spam
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => {
    next(new AppError(429, ErrorCodes.TOO_MANY_REQUESTS, 'Too many requests. Please try again later.'));
  },
});

// OTP verify — tighter, since guessing 6 digits with 20 attempts is trivially easy
export const otpRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => {
    next(new AppError(429, ErrorCodes.TOO_MANY_REQUESTS, 'Too many OTP attempts. Please wait before retrying.'));
  },
});

// General API — loose enough not to interfere with k6 concurrency benchmarks
// NOTE: Do NOT apply this to booking endpoints during benchmark runs
export const generalRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 3000, // High capacity for benchmark testing
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => {
    next(new AppError(429, ErrorCodes.TOO_MANY_REQUESTS, 'Too many requests. Please try again later.'));
  },
});
