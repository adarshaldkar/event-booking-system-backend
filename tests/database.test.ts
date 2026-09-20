import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '../src/config/database';
import { Role } from '@prisma/client';

describe('Database & Seed Data Verification', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('should find seeded Organizer user with verified status', async () => {
    const organizer = await prisma.user.findUnique({
      where: { email: 'organizer@test.com' },
    });
    expect(organizer).not.toBeNull();
    expect(organizer?.role).toBe(Role.ORGANIZER);
    expect(organizer?.isVerified).toBe(true);
    expect(organizer?.fullName).toBe('Test Organizer');
  });

  it('should find seeded Customer users', async () => {
    const customers = await prisma.user.findMany({
      where: { role: Role.CUSTOMER },
    });
    expect(customers.length).toBeGreaterThanOrEqual(5);
  });

  it('should find seeded Flash Sale event with 100 capacity', async () => {
    const event = await prisma.event.findUnique({
      where: { id: 'seed-flash-sale-event-id' },
    });
    expect(event).not.toBeNull();
    expect(event?.title).toBe('Tech Summit 2026');
    expect(event?.totalCapacity).toBe(100);
    expect(event?.availableTickets).toBe(100);
    expect(Number(event?.ticketPrice)).toBe(49.99);
  });

  it('should enforce unique email constraint on User model', async () => {
    await expect(
      prisma.user.create({
        data: {
          email: 'organizer@test.com', // Duplicate
          passwordHash: 'dummy',
          fullName: 'Duplicate Organizer',
        },
      })
    ).rejects.toThrow();
  });
});
