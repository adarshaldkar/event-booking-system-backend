import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { prisma } from '../src/config/database';
import { hashOtp } from '../src/utils/otp';

describe('Phase 2: Authentication & Authorization API', () => {
  const testUserEmail = `test_${Date.now()}@example.com`;
  const testPassword = 'Password123!';
  let authToken: string;

  afterAll(async () => {
    // Cleanup created test users safely
    await prisma.notificationLog.deleteMany({
      where: {
        OR: [
          { recipientEmail: { startsWith: 'test_' } },
          { recipientEmail: { startsWith: 'resend_' } },
          { recipientEmail: { startsWith: 'unverified_' } },
        ],
      },
    });
    await prisma.user.deleteMany({
      where: {
        OR: [
          { email: { startsWith: 'test_' } },
          { email: { startsWith: 'resend_' } },
          { email: { startsWith: 'unverified_' } },
        ],
      },
    });
    await prisma.$disconnect();
  });

  // ── 1. Registration Tests ──────────────────────────────────────────
  describe('POST /api/auth/register', () => {
    it('TC-AUTH-01: should register a new customer in unverified status', async () => {
      const res = await request(app).post('/api/auth/register').send({
        email: testUserEmail,
        password: testPassword,
        fullName: 'Test Automation User',
        role: 'CUSTOMER',
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe(testUserEmail);
      expect(res.body.data.isVerified).toBe(false);
      expect(res.body.data.passwordHash).toBeUndefined(); // Never leak hash

      // Verify in DB that otpHash is stored (not plain text)
      const dbUser = await prisma.user.findUnique({
        where: { email: testUserEmail },
      });
      expect(dbUser).not.toBeNull();
      expect(dbUser?.otpHash).toBeDefined();
      expect(dbUser?.otpHash?.length).toBe(64); // SHA-256 hex length
      expect(dbUser?.otpAttempts).toBe(0);
    });

    it('TC-AUTH-02: should reject duplicate email with 409 Conflict', async () => {
      const res = await request(app).post('/api/auth/register').send({
        email: testUserEmail,
        password: testPassword,
        fullName: 'Duplicate User',
      });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('EMAIL_EXISTS');
    });

    it('TC-AUTH-03: should reject weak password with 400 Validation Error', async () => {
      const res = await request(app).post('/api/auth/register').send({
        email: 'weakpass@example.com',
        password: 'weak',
        fullName: 'Weak User',
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ── 2. OTP Verification Tests ───────────────────────────────────────
  describe('POST /api/auth/verify-otp', () => {
    it('TC-AUTH-04: should reject incorrect OTP and increment attempt counter', async () => {
      const res = await request(app).post('/api/auth/verify-otp').send({
        email: testUserEmail,
        otp: '000000',
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_OTP');

      // Check attempt counter in DB
      const user = await prisma.user.findUnique({ where: { email: testUserEmail } });
      expect(user?.otpAttempts).toBe(1);
    });

    it('TC-AUTH-05: should verify with correct OTP, set isVerified: true and return JWT', async () => {
      // Set a known OTP hash for testing
      const knownOtp = '654321';
      await prisma.user.update({
        where: { email: testUserEmail },
        data: {
          otpHash: hashOtp(knownOtp),
          otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      });

      const res = await request(app).post('/api/auth/verify-otp').send({
        email: testUserEmail,
        otp: knownOtp,
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.token).toBeDefined();
      expect(res.body.data.user.isVerified).toBe(true);

      // Verify in DB that otpHash is cleared
      const user = await prisma.user.findUnique({ where: { email: testUserEmail } });
      expect(user?.isVerified).toBe(true);
      expect(user?.otpHash).toBeNull();
      expect(user?.otpAttempts).toBe(0);
    });
  });

  // ── 3. Resend OTP Tests ─────────────────────────────────────────────
  describe('POST /api/auth/resend-otp', () => {
    it('TC-AUTH-06: should resend fresh OTP for an unverified account', async () => {
      const resendUserEmail = `resend_${Date.now()}@example.com`;
      await prisma.user.create({
        data: {
          email: resendUserEmail,
          passwordHash: 'dummy',
          fullName: 'Resend User',
          isVerified: false,
          otpHash: hashOtp('111111'),
          otpExpiresAt: new Date(Date.now() - 1000), // expired
          otpAttempts: 3,
        },
      });

      const res = await request(app).post('/api/auth/resend-otp').send({
        email: resendUserEmail,
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const user = await prisma.user.findUnique({ where: { email: resendUserEmail } });
      expect(user?.otpAttempts).toBe(0);
      expect(user?.otpExpiresAt!.getTime()).toBeGreaterThan(Date.now());
    });
  });

  // ── 4. Login Tests ──────────────────────────────────────────────────
  describe('POST /api/auth/login', () => {
    it('TC-AUTH-07: should log in seeded verified organizer and return JWT', async () => {
      const res = await request(app).post('/api/auth/login').send({
        email: 'organizer@test.com',
        password: 'Password123!',
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.token).toBeDefined();
      expect(res.body.data.user.role).toBe('ORGANIZER');
      authToken = res.body.data.token;
    });

    it('TC-AUTH-08: should reject login with invalid password (401)', async () => {
      const res = await request(app).post('/api/auth/login').send({
        email: 'organizer@test.com',
        password: 'WrongPassword!',
      });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('TC-AUTH-09: should reject login if account is unverified (403)', async () => {
      const unverifiedEmail = `unverified_${Date.now()}@example.com`;
      await prisma.user.create({
        data: {
          email: unverifiedEmail,
          passwordHash: await import('../src/utils/password').then((m) => m.hashPassword(testPassword)),
          fullName: 'Unverified User',
          isVerified: false,
        },
      });

      const res = await request(app).post('/api/auth/login').send({
        email: unverifiedEmail,
        password: testPassword,
      });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ACCOUNT_UNVERIFIED');
    });
  });

  // ── 5. Protected Profile (/me) Tests ────────────────────────────────
  describe('GET /api/auth/me', () => {
    it('TC-AUTH-10: should return profile for authenticated user', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe('organizer@test.com');
      expect(res.body.data.role).toBe('ORGANIZER');
    });

    it('TC-AUTH-11: should reject request without token (401)', async () => {
      const res = await request(app).get('/api/auth/me');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('TOKEN_MISSING');
    });
  });
});
