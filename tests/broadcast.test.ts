import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { prisma } from '../src/config/database';
import { signToken } from '../src/utils/jwt';
import { Role, EventStatus, BookingStatus } from '@prisma/client';

describe('Phase 4: Event Update Broadcast & Attendee Notification Filtering', () => {
  let organizerToken: string;
  let organizerId: string;
  let broadcastEventId: string;
  let confirmedCustomerId: string;
  let cancelledCustomerId: string;

  beforeAll(async () => {
    // 1. Organizer
    const org = await prisma.user.upsert({
      where: { email: 'broadcast_org@test.com' },
      update: {},
      create: {
        email: 'broadcast_org@test.com',
        passwordHash: 'dummy',
        fullName: 'Broadcast Organizer',
        role: Role.ORGANIZER,
        isVerified: true,
      },
    });
    organizerId = org.id;
    organizerToken = signToken({ sub: org.id, email: org.email, role: org.role });

    // 2. Confirmed Attendee
    const cust1 = await prisma.user.create({
      data: {
        email: `confirmed_attendee_${Date.now()}@test.com`,
        passwordHash: 'dummy',
        fullName: 'Confirmed Attendee',
        role: Role.CUSTOMER,
        isVerified: true,
      },
    });
    confirmedCustomerId = cust1.id;

    // 3. Cancelled Attendee
    const cust2 = await prisma.user.create({
      data: {
        email: `cancelled_attendee_${Date.now()}@test.com`,
        passwordHash: 'dummy',
        fullName: 'Cancelled Attendee',
        role: Role.CUSTOMER,
        isVerified: true,
      },
    });
    cancelledCustomerId = cust2.id;

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30);

    // 4. Create Event
    const event = await prisma.event.create({
      data: {
        organizerId: org.id,
        title: 'Original Developer Conference 2026',
        description: 'Original description of the conference.',
        category: 'Technology',
        location: 'Original Venue Hall A',
        eventDate: futureDate,
        totalCapacity: 100,
        availableTickets: 98,
        ticketPrice: 50.0,
        status: EventStatus.UPCOMING,
      },
    });
    broadcastEventId = event.id;

    // 5. Create 1 CONFIRMED booking
    await prisma.booking.create({
      data: {
        customerId: confirmedCustomerId,
        eventId: broadcastEventId,
        ticketCount: 1,
        totalAmount: 50.0,
        status: BookingStatus.CONFIRMED,
      },
    });

    // 6. Create 1 CANCELLED booking
    await prisma.booking.create({
      data: {
        customerId: cancelledCustomerId,
        eventId: broadcastEventId,
        ticketCount: 1,
        totalAmount: 50.0,
        status: BookingStatus.CANCELLED,
      },
    });
  });

  afterAll(async () => {
    await prisma.booking.deleteMany({ where: { eventId: broadcastEventId } });
    await prisma.event.deleteMany({ where: { id: broadcastEventId } });
    await prisma.user.deleteMany({ where: { id: { in: [confirmedCustomerId, cancelledCustomerId] } } });
    await prisma.$disconnect();
  });

  it('TC-BROADCAST-02: Non-critical field update (description only) does NOT trigger broadcast jobs', async () => {
    const res = await request(app)
      .put(`/api/events/${broadcastEventId}`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({
        description: 'Updated description only — no title, date, or venue changed.',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('TC-BROADCAST-01, TC-BROADCAST-03 & TC-BROADCAST-04: Critical field update (location changed) broadcasts ONLY to CONFIRMED attendees', async () => {
    const res = await request(app)
      .put(`/api/events/${broadcastEventId}`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({
        location: 'New Relocated Grand Ballroom, Floor 3',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.location).toBe('New Relocated Grand Ballroom, Floor 3');

    // Verify in DB that only CONFIRMED bookings exist for this broadcast
    const confirmedCount = await prisma.booking.count({
      where: { eventId: broadcastEventId, status: BookingStatus.CONFIRMED },
    });
    const cancelledCount = await prisma.booking.count({
      where: { eventId: broadcastEventId, status: BookingStatus.CANCELLED },
    });

    expect(confirmedCount).toBe(1);
    expect(cancelledCount).toBe(1);
  });
});
