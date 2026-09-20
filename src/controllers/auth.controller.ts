import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service';
import {
  registerSchema,
  verifyOtpSchema,
  resendOtpSchema,
  loginSchema,
} from '../validators/auth.validator';

export class AuthController {
  /**
   * POST /api/auth/register
   */
  public async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const validated = registerSchema.parse(req.body);
      const result = await authService.register(validated);
      res.status(201).json({
        success: true,
        data: result.user,
        message: result.message,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/auth/verify-otp
   */
  public async verifyOtp(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const validated = verifyOtpSchema.parse(req.body);
      const result = await authService.verifyOtp(validated);
      res.status(200).json({
        success: true,
        data: {
          token: result.token,
          user: result.user,
        },
        message: result.message,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/auth/resend-otp
   */
  public async resendOtp(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const validated = resendOtpSchema.parse(req.body);
      const result = await authService.resendOtp(validated);
      res.status(200).json({
        success: true,
        message: result.message,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/auth/login
   */
  public async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const validated = loginSchema.parse(req.body);
      const result = await authService.login(validated);
      res.status(200).json({
        success: true,
        data: {
          token: result.token,
          user: result.user,
        },
        message: result.message,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/auth/me
   */
  public async getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = await authService.getMe(req.user!.id);
      res.status(200).json({
        success: true,
        data: user,
      });
    } catch (err) {
      next(err);
    }
  }
}

export const authController = new AuthController();
