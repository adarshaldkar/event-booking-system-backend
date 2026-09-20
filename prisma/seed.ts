import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const PASSWORD = 'Password123!';
const SALT_ROUNDS = 10;

async function main(): Promise<void> {
  console.log('🌱  Starting database seed...');

  const passwordHash = await bcrypt.hash(PASSWORD, SALT_ROUNDS);

  // ── 1. Organizer ─────────────────────────────────────────────────────
  const organizer = await prisma.user.upsert({
    where: { email: 'organizer@test.com' },
    update: {},
    create: {
      email: 'organizer@test.com',
      passwordHash,
      fullName: 'Test Organizer',
      role: Role.ORGANIZER,
      isVerified: true,
    },
  });
  console.log(`  ✅  Organizer: ${organizer.email}`);

  // ── 2. Customers ──────────────────────────────────────────────────────
  for (let i = 1; i <= 5; i++) {
    const customer = await prisma.user.upsert({
      where: { email: `customer${i}@test.com` },
      update: {},
      create: {
        email: `customer${i}@test.com`,
        passwordHash,
        fullName: `Test Customer ${i}`,
        role: Role.CUSTOMER,
        isVerified: true,
      },
    });
    console.log(`  ✅  Customer: ${customer.email}`);
  }

  // ── 3. Flash Sale Event (for concurrency tests) ───────────────────────
  const flashSaleDate = new Date();
  flashSaleDate.setDate(flashSaleDate.getDate() + 30); // 30 days from now

  const flashEvent = await prisma.event.upsert({
    where: { id: 'seed-flash-sale-event-id' },
    update: {},
    create: {
      id: 'seed-flash-sale-event-id',
      organizerId: organizer.id,
      title: 'Tech Summit 2026',
      description:
        'The biggest tech conference of the year. Limited to 100 seats — book fast!',
      category: 'Technology',
      location: 'Mumbai Convention Centre, Hall A',
      eventDate: flashSaleDate,
      totalCapacity: 100,
      availableTickets: 100,
      ticketPrice: 49.99,
    },
  });
  console.log(`  ✅  Flash Sale Event: "${flashEvent.title}" (100 tickets @ $${flashEvent.ticketPrice})`);

  // ── 4. Regular Event ──────────────────────────────────────────────────
  const workshopDate = new Date();
  workshopDate.setDate(workshopDate.getDate() + 14); // 2 weeks from now

  const workshopEvent = await prisma.event.upsert({
    where: { id: 'seed-workshop-event-id' },
    update: {},
    create: {
      id: 'seed-workshop-event-id',
      organizerId: organizer.id,
      title: 'DevOps & Cloud Workshop',
      description: 'Hands-on workshop covering Kubernetes, Docker, CI/CD pipelines, and cloud cost optimization.',
      category: 'Workshop',
      location: 'Online (Zoom link sent after booking)',
      eventDate: workshopDate,
      totalCapacity: 50,
      availableTickets: 50,
      ticketPrice: 19.99,
    },
  });
  console.log(`  ✅  Regular Event: "${workshopEvent.title}" (50 tickets @ $${workshopEvent.ticketPrice})`);

  console.log('\n🎉  Seed complete!\n');
  console.log('  Test Credentials (all passwords: Password123!)');
  console.log('  ─────────────────────────────────────────────');
  console.log('  Organizer  → organizer@test.com');
  console.log('  Customers  → customer1@test.com ... customer5@test.com');
}

main()
  .catch((err) => {
    console.error('❌  Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
