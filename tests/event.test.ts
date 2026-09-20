import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { prisma } from '../src/config/database';
import { signToken } from '../src/utils/jwt';
import { Role, EventStatus } from '@prisma/client';

describe('Phase 3: Event Management & Ownership API', () => {
  let organizerToken: string;
  let otherOrganizerToken: string;
  let customerToken: string;
  let organizerId: string;
  let otherOrganizerId: string;
  let customerId: string;
  let createdEventId: string;

  beforeAll(async () => {
    // 1. Setup Organizer
    const org = await prisma.user.upsert({
      where: { email: 'phase3_org@test.com' },
      update: {},
      create: {
        email: 'phase3_org@test.com',
        passwordHash: 'dummy',
        fullName: 'Phase3 Organizer',
        role: Role.ORGANIZER,
        isVerified: true,
      },
    });
    organizerId = org.id;
    organizerToken = signToken({ sub: org.id, email: org.email, role: org.role });

    // 2. Setup Other Organizer
    const otherOrg = await prisma.user.upsert({
      where: { email: 'phase3_other_org@test.com' },
      update: {},
      create: {
        email: 'phase3_other_org@test.com',
        passwordHash: 'dummy',
        fullName: 'Other Organizer',
        role: Role.ORGANIZER,
        isVerified: true,
      },
    });
    otherOrganizerId = otherOrg.id;
    otherOrganizerToken = signToken({ sub: otherOrg.id, email: otherOrg.email, role: otherOrg.role });

    // 3. Setup Customer
    const cust = await prisma.user.upsert({
      where: { email: 'phase3_cust@test.com' },
      update: {},
      create: {
        email: 'phase3_cust@test.com',
        passwordHash: 'dummy',
        fullName: 'Phase3 Customer',
        role: Role.CUSTOMER,
        isVerified: true,
      },
    });
    customerId = cust.id;
    customerToken = signToken({ sub: cust.id, email: cust.email, role: cust.role });
  });

  afterAll(async () => {
    await prisma.event.deleteMany({
      where: { organizerId: { in: [organizerId, otherOrganizerId] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [organizerId, otherOrganizerId, customerId] } },
    });
    await prisma.$disconnect();
  });

  // ── 1. Event Creation Tests ─────────────────────────────────────────
  describe('POST /api/events', () => {
    it('TC-EVENT-01: Organizer creates event (initializes availableTickets = totalCapacity)', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 45);

      const res = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          title: 'Global AI & Cloud Summit 2026',
          description: 'A 3-day deep dive into scalable AI models, distributed databases, and high-concurrency systems.',
          category: 'Technology',
          location: 'San Jose Convention Center',
          eventDate: futureDate.toISOString(),
          totalCapacity: 500,
          ticketPrice: 199.99,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.title).toBe('Global AI & Cloud Summit 2026');
      expect(res.body.data.totalCapacity).toBe(500);
      expect(res.body.data.availableTickets).toBe(500); // Initialized from totalCapacity
      expect(Number(res.body.data.ticketPrice)).toBe(199.99);
      expect(res.body.data.status).toBe(EventStatus.UPCOMING);

      createdEventId = res.body.data.id;
    });

    it('TC-EVENT-02: Customer cannot create event (403 Forbidden)', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 30);

      const res = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          title: 'Customer Hackathon',
          description: 'Unauthorized event creation attempt.',
          category: 'Tech',
          location: 'Online',
          eventDate: futureDate.toISOString(),
          totalCapacity: 100,
          ticketPrice: 10.0,
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('TC-EVENT-10: Invalid capacity (<= 0) rejected with 400 Validation Error', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 30);

      const res = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          title: 'Invalid Capacity Event',
          description: 'Testing non-positive capacity.',
          category: 'Tech',
          location: 'Online',
          eventDate: futureDate.toISOString(),
          totalCapacity: 0, // Invalid
          ticketPrice: 10.0,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('TC-EVENT-11: Negative ticket price rejected with 400 Validation Error', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 30);

      const res = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          title: 'Negative Price Event',
          description: 'Testing negative price.',
          category: 'Tech',
          location: 'Online',
          eventDate: futureDate.toISOString(),
          totalCapacity: 50,
          ticketPrice: -25.0, // Invalid
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('TC-EVENT-12: Past event date rejected with 400 Validation Error', async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 10);

      const res = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          title: 'Past Event',
          description: 'Testing past date rejection.',
          category: 'Tech',
          location: 'Online',
          eventDate: pastDate.toISOString(), // Past date
          totalCapacity: 50,
          ticketPrice: 15.0,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ── 2. Event Discovery & Listing Tests ──────────────────────────────
  describe('GET /api/events', () => {
    it('TC-EVENT-03: Public event listing returns upcoming events with pagination', async () => {
      const res = await request(app).get('/api/events');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.pagination).toBeDefined();
      expect(res.body.pagination.page).toBe(1);
    });

    it('TC-EVENT-04: Event search and category filter work correctly', async () => {
      const res = await request(app).get('/api/events?category=Technology&search=Summit');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0].category).toBe('Technology');
    });

    it('TC-EVENT-05: Event pagination (page & limit)', async () => {
      const res = await request(app).get('/api/events?page=1&limit=2');

      expect(res.status).toBe(200);
      expect(res.body.pagination.limit).toBe(2);
      expect(res.body.data.length).toBeLessThanOrEqual(2);
    });

    it('TC-EVENT-06: Public/Organizer can view event details by ID', async () => {
      const res = await request(app).get(`/api/events/${createdEventId}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(createdEventId);
      expect(res.body.data.organizer.email).toBe('phase3_org@test.com');
    });
  });

  // ── 3. Ownership & Update/Cancel Tests ───────────────────────────────
  describe('PUT & DELETE /api/events/:id', () => {
    it('TC-EVENT-07: Organizer cannot update another organizer event (403 Not Owner)', async () => {
      const res = await request(app)
        .put(`/api/events/${createdEventId}`)
        .set('Authorization', `Bearer ${otherOrganizerToken}`)
        .send({
          title: 'Hacked Title Attempt',
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_OWNER');
    });

    it('TC-EVENT-08: Organizer cannot cancel another organizer event (403 Not Owner)', async () => {
      const res = await request(app)
        .delete(`/api/events/${createdEventId}`)
        .set('Authorization', `Bearer ${otherOrganizerToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_OWNER');
    });

    it('TC-EVENT-09: Event deletion uses soft CANCELLED status', async () => {
      const res = await request(app)
        .delete(`/api/events/${createdEventId}`)
        .set('Authorization', `Bearer ${organizerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe(EventStatus.CANCELLED);

      // Verify row still exists in database with CANCELLED status
      const dbEvent = await prisma.event.findUnique({ where: { id: createdEventId } });
      expect(dbEvent).not.toBeNull();
      expect(dbEvent?.status).toBe(EventStatus.CANCELLED);
    });
  });
});
