import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { prisma } from '../src/config/database';
import { redis } from '../src/config/redis';
import { cacheService } from '../src/utils/cache';
import { signToken } from '../src/utils/jwt';
import { Role, EventStatus } from '@prisma/client';

describe('Phase 4: Redis Read-Through Caching & Invalidation', () => {
  let organizerToken: string;
  let customerToken: string;
  let cachedEventId: string;

  beforeAll(async () => {
    // 1. Organizer
    const org = await prisma.user.upsert({
      where: { email: 'cache_org@test.com' },
      update: {},
      create: {
        email: 'cache_org@test.com',
        passwordHash: 'dummy',
        fullName: 'Cache Test Organizer',
        role: Role.ORGANIZER,
        isVerified: true,
      },
    });
    organizerToken = signToken({ sub: org.id, email: org.email, role: org.role });

    // 2. Customer
    const cust = await prisma.user.upsert({
      where: { email: 'cache_cust@test.com' },
      update: {},
      create: {
        email: 'cache_cust@test.com',
        passwordHash: 'dummy',
        fullName: 'Cache Test Customer',
        role: Role.CUSTOMER,
        isVerified: true,
      },
    });
    customerToken = signToken({ sub: cust.id, email: cust.email, role: cust.role });

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 45);

    // 3. Create test event
    const event = await prisma.event.create({
      data: {
        organizerId: org.id,
        title: 'Redis Caching Deep Dive Event',
        description: 'Testing TTLs and non-blocking SCAN invalidations.',
        category: 'Tech',
        location: 'Hall C',
        eventDate: futureDate,
        totalCapacity: 50,
        availableTickets: 50,
        ticketPrice: 30.0,
        status: EventStatus.UPCOMING,
      },
    });
    cachedEventId = event.id;
  });

  afterAll(async () => {
    await prisma.booking.deleteMany({ where: { eventId: cachedEventId } });
    await prisma.event.deleteMany({ where: { id: cachedEventId } });
    await prisma.$disconnect();
  });

  it('TC-CACHE-01 & TC-CACHE-02: First request caches response; second request serves from Redis cache (Cache Hit)', async () => {
    const detailKey = `events:detail:${cachedEventId}`;

    // Ensure cache is clear before test
    await redis.del(detailKey);

    // 1st request -> Cache Miss -> sets Redis key
    const res1 = await request(app).get(`/api/events/${cachedEventId}`);
    expect(res1.status).toBe(200);

    // Verify key now exists in Redis
    const cachedData = await cacheService.get<any>(detailKey);
    expect(cachedData).not.toBeNull();
    expect(cachedData?.id).toBe(cachedEventId);
    expect(cachedData?.title).toBe('Redis Caching Deep Dive Event');

    // 2nd request -> Cache Hit
    const res2 = await request(app).get(`/api/events/${cachedEventId}`);
    expect(res2.status).toBe(200);
    expect(res2.body.data.id).toBe(cachedEventId);
  });

  it('TC-CACHE-03: Updating an event invalidates the Redis detail cache', async () => {
    const detailKey = `events:detail:${cachedEventId}`;

    // Prime the cache
    await request(app).get(`/api/events/${cachedEventId}`);
    const cachedBefore = await redis.get(detailKey);
    expect(cachedBefore).not.toBeNull();

    // Update event
    const updateRes = await request(app)
      .put(`/api/events/${cachedEventId}`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ title: 'Updated Redis Caching Event Title' });

    expect(updateRes.status).toBe(200);

    // Verify detailKey was invalidated/deleted from Redis
    const cachedAfter = await redis.get(detailKey);
    expect(cachedAfter).toBeNull();
  });

  it('TC-CACHE-04: Booking a ticket invalidates the event detail cache so remaining seats update immediately', async () => {
    const detailKey = `events:detail:${cachedEventId}`;

    // Prime the cache
    await request(app).get(`/api/events/${cachedEventId}`);
    expect(await redis.get(detailKey)).not.toBeNull();

    // Book 1 ticket
    const bookRes = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ eventId: cachedEventId, quantity: 1 });

    expect(bookRes.status).toBe(201);

    // Cache MUST be invalidated so subsequent GET reads fresh decremented inventory
    expect(await redis.get(detailKey)).toBeNull();

    // Next GET returns updated availableTickets (49)
    const freshGet = await request(app).get(`/api/events/${cachedEventId}`);
    expect(freshGet.body.data.availableTickets).toBe(49);
  });

  it('TC-CACHE-06: Non-blocking SCAN invalidation removes all matching list cache keys', async () => {
    // Populate several list cache keys
    await cacheService.set('events:list:dummy1', { test: 1 }, 60);
    await cacheService.set('events:list:dummy2', { test: 2 }, 60);
    await cacheService.set('events:list:dummy3', { test: 3 }, 60);

    // Trigger non-blocking invalidation
    await cacheService.invalidateEventCache();

    expect(await cacheService.get('events:list:dummy1')).toBeNull();
    expect(await cacheService.get('events:list:dummy2')).toBeNull();
    expect(await cacheService.get('events:list:dummy3')).toBeNull();
  });
});
