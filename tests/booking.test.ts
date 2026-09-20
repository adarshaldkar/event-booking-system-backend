import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { prisma } from '../src/config/database';
import { signToken } from '../src/utils/jwt';
import { Role, BookingStatus, EventStatus } from '@prisma/client';

describe('Phase 3: Booking Engine, Idempotency & Cancellation API', () => {
  let customerToken: string;
  let otherCustomerToken: string;
  let customerId: string;
  let otherCustomerId: string;
  let testEventId: string;
  let smallEventId: string;
  let pastEventId: string;
  let activeBookingId: string;

  beforeAll(async () => {
    // 1. Setup primary customer
    const cust1 = await prisma.user.upsert({
      where: { email: 'phase3_booking_cust1@test.com' },
      update: {},
      create: {
        email: 'phase3_booking_cust1@test.com',
        passwordHash: 'dummy',
        fullName: 'Primary Customer',
        role: Role.CUSTOMER,
        isVerified: true,
      },
    });
    customerId = cust1.id;
    customerToken = signToken({ sub: cust1.id, email: cust1.email, role: cust1.role });

    // 2. Setup secondary customer
    const cust2 = await prisma.user.upsert({
      where: { email: 'phase3_booking_cust2@test.com' },
      update: {},
      create: {
        email: 'phase3_booking_cust2@test.com',
        passwordHash: 'dummy',
        fullName: 'Secondary Customer',
        role: Role.CUSTOMER,
        isVerified: true,
      },
    });
    otherCustomerId = cust2.id;
    otherCustomerToken = signToken({ sub: cust2.id, email: cust2.email, role: cust2.role });

    // 3. Organizer for events
    const org = await prisma.user.upsert({
      where: { email: 'phase3_booking_org@test.com' },
      update: {},
      create: {
        email: 'phase3_booking_org@test.com',
        passwordHash: 'dummy',
        fullName: 'Event Host Organizer',
        role: Role.ORGANIZER,
        isVerified: true,
      },
    });

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 60);

    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 10);

    // 4. Test Event (50 capacity)
    const event1 = await prisma.event.create({
      data: {
        organizerId: org.id,
        title: 'Cloud Concurrency Workshop',
        description: 'Deep dive into distributed systems transactions.',
        category: 'Tech',
        location: 'Hall B, Main Campus',
        eventDate: futureDate,
        totalCapacity: 50,
        availableTickets: 50,
        ticketPrice: 25.0,
        status: EventStatus.UPCOMING,
      },
    });
    testEventId = event1.id;

    // 5. Small Event (only 2 tickets left)
    const event2 = await prisma.event.create({
      data: {
        organizerId: org.id,
        title: 'VIP Masterclass',
        description: 'Exclusive 2-seat masterclass.',
        category: 'Education',
        location: 'Room 101',
        eventDate: futureDate,
        totalCapacity: 5,
        availableTickets: 2, // Only 2 remaining
        ticketPrice: 100.0,
        status: EventStatus.UPCOMING,
      },
    });
    smallEventId = event2.id;

    // 6. Past Event (for cancellation prevention test)
    const event3 = await prisma.event.create({
      data: {
        organizerId: org.id,
        title: 'Past Completed Summit',
        description: 'Past event test.',
        category: 'Archive',
        location: 'Online',
        eventDate: pastDate,
        totalCapacity: 10,
        availableTickets: 10,
        ticketPrice: 10.0,
        status: EventStatus.UPCOMING,
      },
    });
    pastEventId = event3.id;
  });

  afterAll(async () => {
    await prisma.booking.deleteMany({
      where: { customerId: { in: [customerId, otherCustomerId] } },
    });
    await prisma.event.deleteMany({
      where: { id: { in: [testEventId, smallEventId, pastEventId] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [customerId, otherCustomerId] } },
    });
    await prisma.$disconnect();
  });

  // ── 1. Booking Creation Tests ───────────────────────────────────────
  describe('POST /api/bookings', () => {
    it('TC-BOOK-01 & TC-BOOK-02: Successful booking returns 201 and decrements inventory', async () => {
      const res = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          eventId: testEventId,
          quantity: 2,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.ticketCount).toBe(2);
      expect(Number(res.body.data.totalAmount)).toBe(50.0);
      expect(res.body.data.bookingReference).toBeDefined();

      activeBookingId = res.body.data.id;

      // Verify DB inventory decreased from 50 to 48
      const dbEvent = await prisma.event.findUnique({ where: { id: testEventId } });
      expect(dbEvent?.availableTickets).toBe(48);
    });

    it('TC-BOOK-03: Insufficient tickets returns 409 Conflict (INSUFFICIENT_TICKETS)', async () => {
      // Event has only 2 available tickets, requesting 4
      const res = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          eventId: smallEventId,
          quantity: 4,
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INSUFFICIENT_TICKETS');
    });

    it('TC-BOOK-04: Sold-out event returns 409 Conflict (SOLD_OUT)', async () => {
      // Book the remaining 2 tickets
      await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ eventId: smallEventId, quantity: 2 });

      // Now event is 0 tickets available
      const res = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ eventId: smallEventId, quantity: 1 });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('SOLD_OUT');
    });

    it('TC-BOOK-05: Invalid ticket quantity (0 or >10) rejected with 400 Validation Error', async () => {
      const res = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          eventId: testEventId,
          quantity: 0, // Invalid
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ── 2. Idempotency Key Tests ────────────────────────────────────────
  describe('Idempotency-Key Support', () => {
    const testIdempotencyKey = `idemp-key-${Date.now()}`;

    it('TC-BOOK-06: Idempotency key replay returns existing booking (200 OK) without double decrement', async () => {
      // 1st request with Idempotency-Key
      const res1 = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${customerToken}`)
        .set('Idempotency-Key', testIdempotencyKey)
        .send({
          eventId: testEventId,
          quantity: 3,
        });

      expect(res1.status).toBe(201);
      expect(res1.body.isReplayed).toBe(false);
      const bookingId = res1.body.data.id;

      // Check DB tickets: was 48, now 45
      const eventAfter1 = await prisma.event.findUnique({ where: { id: testEventId } });
      expect(eventAfter1?.availableTickets).toBe(45);

      // 2nd request (Replay with same Idempotency-Key)
      const res2 = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${customerToken}`)
        .set('Idempotency-Key', testIdempotencyKey)
        .send({
          eventId: testEventId,
          quantity: 3,
        });

      expect(res2.status).toBe(200);
      expect(res2.body.isReplayed).toBe(true);
      expect(res2.body.data.id).toBe(bookingId);

      // Check DB tickets: MUST REMAIN 45 (No double decrement!)
      const eventAfter2 = await prisma.event.findUnique({ where: { id: testEventId } });
      expect(eventAfter2?.availableTickets).toBe(45);
    });

    it('TC-BOOK-07: Concurrent requests with identical Idempotency-Key safely resolve to one booking', async () => {
      const concurrentKey = `idemp-concurrent-${Date.now()}`;

      const [resA, resB] = await Promise.all([
        request(app)
          .post('/api/bookings')
          .set('Authorization', `Bearer ${customerToken}`)
          .set('Idempotency-Key', concurrentKey)
          .send({ eventId: testEventId, quantity: 1 }),
        request(app)
          .post('/api/bookings')
          .set('Authorization', `Bearer ${customerToken}`)
          .set('Idempotency-Key', concurrentKey)
          .send({ eventId: testEventId, quantity: 1 }),
      ]);

      // One should be 201 (created), the other should be 200 (replayed) or both successful with same booking ID
      expect([200, 201]).toContain(resA.status);
      expect([200, 201]).toContain(resB.status);
      expect(resA.body.data.id).toBe(resB.body.data.id);
    });
  });

  // ── 3. Booking History & Ownership Tests ─────────────────────────────
  describe('GET /api/bookings', () => {
    it('TC-BOOK-08: Customer can view their own booking history', async () => {
      const res = await request(app)
        .get('/api/bookings')
        .set('Authorization', `Bearer ${customerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('TC-BOOK-09: Customer can view single booking details by ID', async () => {
      const res = await request(app)
        .get(`/api/bookings/${activeBookingId}`)
        .set('Authorization', `Bearer ${customerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(activeBookingId);
    });

    it('TC-BOOK-10: Customer cannot access another customer booking (403 Forbidden)', async () => {
      const res = await request(app)
        .get(`/api/bookings/${activeBookingId}`)
        .set('Authorization', `Bearer ${otherCustomerToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  // ── 4. Cancellation & Inventory Restocking Tests ────────────────────
  describe('POST /api/bookings/:id/cancel', () => {
    it('TC-CANCEL-04: Customer cannot cancel another customer booking (403 Forbidden)', async () => {
      const res = await request(app)
        .post(`/api/bookings/${activeBookingId}/cancel`)
        .set('Authorization', `Bearer ${otherCustomerToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('TC-CANCEL-01 & TC-CANCEL-02: Customer cancels booking and inventory is restored accurately', async () => {
      const eventBefore = await prisma.event.findUnique({ where: { id: testEventId } });
      const availableBefore = eventBefore?.availableTickets || 0;

      const res = await request(app)
        .post(`/api/bookings/${activeBookingId}/cancel`)
        .set('Authorization', `Bearer ${customerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe(BookingStatus.CANCELLED);
      expect(res.body.data.restockedTickets).toBe(2);

      // Verify inventory increased by exactly 2 tickets in PostgreSQL
      const eventAfter = await prisma.event.findUnique({ where: { id: testEventId } });
      expect(eventAfter?.availableTickets).toBe(availableBefore + 2);
    });

    it('TC-CANCEL-03: Already cancelled booking cannot be cancelled again (400 Bad Request)', async () => {
      const res = await request(app)
        .post(`/api/bookings/${activeBookingId}/cancel`)
        .set('Authorization', `Bearer ${customerToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ALREADY_CANCELLED');
    });

    it('TC-CANCEL-05: Concurrent cancellation attempts only restock inventory once', async () => {
      // Create a fresh booking with 2 tickets
      const freshBookingRes = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ eventId: testEventId, quantity: 2 });

      const freshBookingId = freshBookingRes.body.data.id;
      const eventBefore = await prisma.event.findUnique({ where: { id: testEventId } });
      const availableBefore = eventBefore?.availableTickets || 0;

      // Send two concurrent cancellation requests simultaneously
      const [resA, resB] = await Promise.all([
        request(app)
          .post(`/api/bookings/${freshBookingId}/cancel`)
          .set('Authorization', `Bearer ${customerToken}`),
        request(app)
          .post(`/api/bookings/${freshBookingId}/cancel`)
          .set('Authorization', `Bearer ${customerToken}`),
      ]);

      const successCount = [resA, resB].filter((r) => r.status === 200).length;
      const failCount = [resA, resB].filter((r) => r.status === 400).length;

      expect(successCount).toBe(1);
      expect(failCount).toBe(1);

      // Inventory must only be restocked once (+2 tickets, NOT +4)
      const eventAfter = await prisma.event.findUnique({ where: { id: testEventId } });
      expect(eventAfter?.availableTickets).toBe(availableBefore + 2);
    });
  });
});
