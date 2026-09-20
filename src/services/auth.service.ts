import { prisma } from '../config/database';
import { hashPassword, comparePassword } from '../utils/password';
import { generateOtp, hashOtp, verifyOtpHash, getOtpExpiry, isOtpExpired, MAX_OTP_ATTEMPTS } from '../utils/otp';
import { signToken } from '../utils/jwt';
import { enqueueOtpEmail } from '../jobs/notificationQueue';
import { AppError, ErrorCodes } from '../middleware/error.middleware';
import { RegisterInput, VerifyOtpInput, ResendOtpInput, LoginInput } from '../validators/auth.validator';
import { logger } from '../utils/logger';

export class AuthService {
  /**
   * Register a new Customer or Organizer
   */
  public async register(input: RegisterInput) {
    const existing = await prisma.user.findUnique({
      where: { email: input.email },
    });

    if (existing) {
      throw new AppError(409, ErrorCodes.EMAIL_EXISTS, 'An account with this email address already exists.');
    }

    const passwordHash = await hashPassword(input.password);
    const plainOtp = generateOtp();
    const otpHash = hashOtp(plainOtp);
    const otpExpiresAt = getOtpExpiry();

    const user = await prisma.user.create({
      data: {
        email: input.email,
        passwordHash,
        fullName: input.fullName,
        role: input.role,
        isVerified: false,
        otpHash,
        otpExpiresAt,
        otpAttempts: 0,
      },
    });

    // Outbox Pattern: Create single NotificationLog in PENDING state
    let notificationLogId: string | undefined;
    try {
      const outboxLog = await prisma.notificationLog.create({
        data: {
          recipientEmail: user.email,
          notificationType: 'AUTH_OTP',
          deliveryStatus: 'PENDING',
          attempts: 0,
        },
      });
      notificationLogId = outboxLog.id;
    } catch (e: any) {
      logger.warn(`Failed to create outbox log for OTP: ${e.message}`);
    }

    // Enqueue non-blocking OTP email job in BullMQ
    enqueueOtpEmail({
      email: user.email,
      fullName: user.fullName,
      otp: plainOtp,
      notificationLogId,
    }).catch((err) => {
      logger.error(`Failed to enqueue OTP email for ${user.email}`, { error: err.message });
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        isVerified: user.isVerified,
      },
      message: 'Registration successful. A 6-digit verification code has been sent to your email.',
    };
  }

  /**
   * Verify OTP and activate account
   */
  public async verifyOtp(input: VerifyOtpInput) {
    const user = await prisma.user.findUnique({
      where: { email: input.email },
    });

    if (!user) {
      throw new AppError(400, ErrorCodes.INVALID_OTP, 'Invalid or expired verification code.');
    }

    if (user.isVerified) {
      throw new AppError(400, 'ALREADY_VERIFIED', 'Account is already verified. Please log in.');
    }

    // Check attempt limits
    if (user.otpAttempts >= MAX_OTP_ATTEMPTS) {
      throw new AppError(
        400,
        'MAX_OTP_ATTEMPTS_EXCEEDED',
        'Maximum OTP verification attempts exceeded. Please request a new code using the resend endpoint.'
      );
    }

    // Check expiry
    if (!user.otpExpiresAt || isOtpExpired(user.otpExpiresAt) || !user.otpHash) {
      throw new AppError(400, 'OTP_EXPIRED', 'Verification code has expired. Please request a new one.');
    }

    // Verify hash
    const isValid = verifyOtpHash(input.otp, user.otpHash);
    if (!isValid) {
      // Increment attempt counter
      await prisma.user.update({
        where: { id: user.id },
        data: { otpAttempts: { increment: 1 } },
      });
      const remainingAttempts = MAX_OTP_ATTEMPTS - (user.otpAttempts + 1);
      throw new AppError(
        400,
        ErrorCodes.INVALID_OTP,
        `Invalid verification code. ${remainingAttempts > 0 ? `${remainingAttempts} attempt(s) remaining.` : 'No attempts remaining, please request a new code.'}`
      );
    }

    // Mark user verified and clear OTP data
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        isVerified: true,
        otpHash: null,
        otpExpiresAt: null,
        otpAttempts: 0,
      },
    });

    const token = signToken({
      sub: updatedUser.id,
      email: updatedUser.email,
      role: updatedUser.role,
    });

    return {
      token,
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        fullName: updatedUser.fullName,
        role: updatedUser.role,
        isVerified: updatedUser.isVerified,
      },
      message: 'Account verified successfully.',
    };
  }

  /**
   * Resend OTP with fresh TTL and reset attempts
   */
  public async resendOtp(input: ResendOtpInput) {
    const user = await prisma.user.findUnique({
      where: { email: input.email },
    });

    if (!user) {
      throw new AppError(404, ErrorCodes.NOT_FOUND, 'No user found with this email address.');
    }

    if (user.isVerified) {
      throw new AppError(400, 'ALREADY_VERIFIED', 'Account is already verified. Please log in.');
    }

    const plainOtp = generateOtp();
    const otpHash = hashOtp(plainOtp);
    const otpExpiresAt = getOtpExpiry();

    await prisma.user.update({
      where: { id: user.id },
      data: {
        otpHash,
        otpExpiresAt,
        otpAttempts: 0,
      },
    });

    // Outbox Pattern: Create single NotificationLog in PENDING state
    let notificationLogId: string | undefined;
    try {
      const outboxLog = await prisma.notificationLog.create({
        data: {
          recipientEmail: user.email,
          notificationType: 'AUTH_OTP',
          deliveryStatus: 'PENDING',
          attempts: 0,
        },
      });
      notificationLogId = outboxLog.id;
    } catch (e: any) {
      logger.warn(`Failed to create outbox log for OTP: ${e.message}`);
    }

    // Enqueue non-blocking OTP email job in BullMQ
    enqueueOtpEmail({
      email: user.email,
      fullName: user.fullName,
      otp: plainOtp,
      notificationLogId,
    }).catch((err) => {
      logger.error(`Failed to enqueue OTP email for ${user.email}`, { error: err.message });
    });

    return {
      message: 'A fresh verification code has been sent to your email address.',
    };
  }

  /**
   * Login with email and password
   */
  public async login(input: LoginInput) {
    const user = await prisma.user.findUnique({
      where: { email: input.email },
    });

    if (!user) {
      throw new AppError(401, ErrorCodes.INVALID_CREDENTIALS, 'Invalid email or password.');
    }

    const passwordMatches = await comparePassword(input.password, user.passwordHash);
    if (!passwordMatches) {
      throw new AppError(401, ErrorCodes.INVALID_CREDENTIALS, 'Invalid email or password.');
    }

    if (!user.isVerified) {
      throw new AppError(
        403,
        ErrorCodes.ACCOUNT_UNVERIFIED,
        'Your email is not verified. Please verify using the OTP code sent to your email.'
      );
    }

    const token = signToken({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        isVerified: user.isVerified,
      },
      message: 'Login successful.',
    };
  }

  /**
   * Get current authenticated user profile
   */
  public async getMe(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isVerified: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new AppError(404, ErrorCodes.NOT_FOUND, 'User not found.');
    }

    return user;
  }
}

export const authService = new AuthService();
