import { Router } from 'express';
import { authController } from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';
import { authRateLimit } from '../middleware/rateLimit.middleware';

const router = Router();

// Strict rate limit on authentication endpoints
router.use(authRateLimit);

// Public Auth Endpoints
router.post('/register', (req, res, next) => authController.register(req, res, next));
router.post('/verify-otp', (req, res, next) => authController.verifyOtp(req, res, next));
router.post('/resend-otp', (req, res, next) => authController.resendOtp(req, res, next));
router.post('/login', (req, res, next) => authController.login(req, res, next));

// Protected Auth Endpoints
router.get('/me', authenticate, (req, res, next) => authController.getMe(req, res, next));

export default router;
