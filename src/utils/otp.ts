import crypto from 'crypto';

const OTP_LENGTH = 6;
const OTP_TTL_MINUTES = 10;
const MAX_OTP_ATTEMPTS = 5;

/** Generate a cryptographically secure 6-digit numeric OTP */
export function generateOtp(): string {
  // Generates integer between 100000 and 999999
  const otpNumber = crypto.randomInt(100000, 1000000);
  return otpNumber.toString();
}

/** Hash the plain OTP using SHA-256 before storing in PostgreSQL */
export function hashOtp(otp: string): string {
  return crypto.createHash('sha256').update(otp).digest('hex');
}

/** Verify plain OTP against stored SHA-256 hash */
export function verifyOtpHash(plainOtp: string, storedHash: string): boolean {
  const incomingHash = hashOtp(plainOtp);
  // Constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(incomingHash, 'hex'),
      Buffer.from(storedHash, 'hex')
    );
  } catch {
    return false;
  }
}

/** Returns the expiry datetime (10 minutes from now) */
export function getOtpExpiry(): Date {
  const expiry = new Date();
  expiry.setMinutes(expiry.getMinutes() + OTP_TTL_MINUTES);
  return expiry;
}

/** Check if an OTP has expired */
export function isOtpExpired(expiresAt: Date): boolean {
  return new Date() > expiresAt;
}

export { MAX_OTP_ATTEMPTS };
