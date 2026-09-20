import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { prisma } from '../src/config/database';
import { signToken } from '../src/utils/jwt';
import { Role, EventStatus, BookingStatus } from '@prisma/client';

describe('Phase 3: High-Concurrency Flash Sale Benchmark Test', () => {
  let flashSaleEventId: string;
  const TOTAL_CAPACITY = 10;
  const CONCURRENT_REQUESTS = 50;
  const customerTokens: string[] = [];
  const customerIds: string[] = [];

  beforeAll(async () => {
    // 1. Create Organizer
    const org = await prisma.user.upsert({
      where: { email: 'flashsale_org@test.com' },
      update: {},
      create: {
        email: 'flashsale_org@test.com',
        passwordHash: 'dummy',
        fullName: 'Flash Sale Organizer',
        role: Role.ORGANIZER,
        isVerified: true,
      },
    });

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30);

    // 2. Create Event with EXACTLY 10 Tickets
    const event = await prisma.event.create({
      data: {
        organizerId: org.id,
        title: 'Ultra-Limited Flash Sale: 10 Tickets Available',
        description: 'Concurrency stress test event.',
        category: 'FlashSale',
        location: 'Silicon Valley Arena',
        eventDate: futureDate,
        totalCapacity: TOTAL_CAPACITY,
        availableTickets: TOTAL_CAPACITY,
        ticketPrice: 99.0,
        status: EventStatus.UPCOMING,
      },
    });
    flashSaleEventId = event.id;

    // 3. Create 50 distinct Customer tokens to simulate 50 distinct concurrent buyers
    for (let i = 1; i <= CONCURRENT_REQUESTS; i++) {
      const email = `flash_buyer_${i}_${Date.now()}@test.com`;
      const cust = await prisma.user.create({
        data: {
          email,
          passwordHash: 'dummy',
          fullName: `Buyer ${i}`,
          role: Role.CUSTOMER,
          isVerified: true,
        },
      });
      customerIds.push(cust.id);
      customerTokens.push(signToken({ sub: cust.id, email: cust.email, role: cust.role }));
    }
  });

  afterAll(async () => {
    await prisma.booking.deleteMany({
      where: { eventId: flashSaleEventId },
    });
    await prisma.event.deleteMany({
      where: { id: flashSaleEventId },
    });
    await prisma.user.deleteMany({
      where: { id: { in: customerIds } },
    });
    await prisma.$disconnect();
  });

  it('TC-CONC-01: 50 concurrent buyers competing for 10 tickets -> exactly 10 succeed, 40 rejected, 0 oversold', async () => {
    console.log(`\n🚀 Launching ${CONCURRENT_REQUESTS} parallel booking requests for ${TOTAL_CAPACITY} seats...`);

    // Fire all 50 requests simultaneously via Promise.all
    const responses = await Promise.all(
      customerTokens.map((token, index) =>
        request(app)
          .post('/api/bookings')
          .set('Authorization', `Bearer ${token}`)
          .set('Idempotency-Key', `flash-key-${index}-${Date.now()}`)
          .send({
            eventId: flashSaleEventId,
            quantity: 1,
          })
      )
    );

    // Group responses by status code
    const successfulResponses = responses.filter((r) => r.status === 201);
    const rejectedResponses = responses.filter((r) => r.status === 409);
    const otherResponses = responses.filter((r) => r.status !== 201 && r.status !== 409);

    console.log(`\n📊 Concurrency Benchmark Results:`);
    console.log(`  • Successful Bookings (201 Created)   : ${successfulResponses.length}`);
    console.log(`  • Rejected Bookings (409 Conflict)    : ${rejectedResponses.length}`);
    console.log(`  • Unexpected Responses                : ${otherResponses.length}`);

    // Assertions
    expect(otherResponses.length).toBe(0);
    expect(successfulResponses.length).toBe(TOTAL_CAPACITY); // Exactly 10
    expect(rejectedResponses.length).toBe(CONCURRENT_REQUESTS - TOTAL_CAPACITY); // Exactly 40

    // Database Invariant Verification
    const finalEvent = await prisma.event.findUnique({ where: { id: flashSaleEventId } });
    const confirmedBookings = await prisma.booking.findMany({
      where: { eventId: flashSaleEventId, status: BookingStatus.CONFIRMED },
    });
    const totalTicketsSold = confirmedBookings.reduce((sum, b) => sum + b.ticketCount, 0);

    console.log(`\n🔍 Database State Verification:`);
    console.log(`  • Final Available Tickets in DB       : ${finalEvent?.availableTickets}`);
    console.log(`  • Total Confirmed Bookings in DB      : ${confirmedBookings.length}`);
    console.log(`  • Total Tickets Sold                  : ${totalTicketsSold}`);
    console.log(`  • Oversold Tickets                    : ${Math.max(0, totalTicketsSold - TOTAL_CAPACITY)}`);

    expect(finalEvent?.availableTickets).toBe(0);
    expect(totalTicketsSold).toBe(TOTAL_CAPACITY);

    // Core Mathematical Invariant:
    // totalCapacity === availableTickets + totalTicketsSold
    expect(finalEvent?.totalCapacity).toBe(finalEvent!.availableTickets + totalTicketsSold);
  });
});
