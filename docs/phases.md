# Project Execution Roadmap & Implementation Phases
## Event Booking System Backend API (8-Hour Engineering Assessment)

> **Document Purpose:** Step-by-step milestone roadmap detailing the 7 implementation phases, hourly time budgets, exact deliverables, automated test checkpoints, and acceptance criteria.  
> **Reference Document:** [System Brain & Architecture Decision Record (ADR)](file:///c:/Users/shrut/Desktop/castro/brain.md)

---

## Master Phase Summary

```
┌────────────────────────────────────────────────────────────────────────┐
│                   THE 7 PHASES OVER 8-HOUR TIMELINE                    │
├────────────────────────────────────────────────────────────────────────┤
│  Phase 1: Foundation, PostgreSQL Schema & Seeding (Hour 1: 09:00-10:00)│
│  Phase 2: Auth, RBAC & Email OTP Verification (Hour 2: 10:00-11:00)    │
│  Phase 3: Event Management & Atomic Booking Engine (Hour 3: 11:00-12:00│
│  Phase 4: BullMQ Queue, Real Email & Dynamic QR (Hour 4: 12:00-13:00)  │
│  Phase 5: Automated Tests & k6 Benchmarking (Hour 5: 13:00-14:00)      │
│  Phase 6: Caching, Swagger Docs & Cloud Deployment (Hours 6-7: 14:00-16:00) │
│  Phase 7: Final README, Loom Video & Submission (Hour 8: 16:00-17:00)  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Project Foundation, PostgreSQL Schema & Seeding
**Time Window:** Hour 1 (09:00 – 10:00)  
**Primary Goal:** Establish TypeScript/Express foundation, PostgreSQL database with Prisma ORM, strict constraints, and an automated seed script.

### 1.1 Tasks & Deliverables
- [ ] Initialize Node.js TypeScript project (`tsconfig.json`, `package.json`, ESLint, Prettier).
- [ ] Setup structured directory layout:
  ```
  src/
  ├── config/          # Environment variables & constants (Zod-validated)
  ├── controllers/     # HTTP route controllers
  ├── middleware/      # Auth, RBAC, error handling, rate limiting
  ├── models/          # Prisma database client
  ├── queues/          # BullMQ queue definitions & producers
  ├── routes/          # Express API route declarations
  ├── services/        # Business logic & atomic database operations
  ├── utils/           # JWT, hashing, QR generation, logger
  ├── workers/         # BullMQ consumer processes
  └── index.ts         # Express server entry point
  ```
- [ ] Create `.env.example` with complete configuration keys.
- [ ] Configure Prisma ORM with the 4 locked models:
  - `User` (id, email, passwordHash, fullName, role, isVerified, otpCode, otpExpiresAt)
  - `Event` (id, organizerId, title, description, category, location, eventDate, totalCapacity, availableTickets, ticketPrice Decimal, status)
  - `Booking` (id, bookingReference, idempotencyKey, customerId, eventId, ticketCount, totalAmount Decimal, status)
  - `NotificationLog` (id, eventId, bookingId, recipientEmail, notificationType, deliveryStatus, attempts, providerMessageId, errorMessage, sentAt)
- [ ] Add PostgreSQL check constraints (`available_tickets >= 0`, `ticket_price >= 0`, `total_capacity > 0`).
- [ ] Apply initial database migration (`npx prisma migrate dev --name init`).
- [ ] Create automated seed script `prisma/seed.ts` (`npm run db:seed`):
  - 1 Organizer (`organizer@test.com`)
  - 5 Verified Customers (`customer1@test.com` through `customer5@test.com`)
  - 1 Flash Sale Event (100 capacity, 100 available, $49.99)
  - 1 Regular Event (50 capacity, 50 available, $19.99)

### 1.2 Verification Checkpoint
```bash
npx prisma migrate dev
npm run db:seed
```
* **Success Criteria:** Database tables exist, check constraints are active, and seed data is populated without errors.

---

## Phase 2: Authentication, RBAC & Email OTP Verification
**Time Window:** Hour 2 (10:00 – 11:00)  
**Primary Goal:** Implement secure JWT authentication, role-based access control, resource ownership checks, and email OTP account activation.

### 2.1 Tasks & Deliverables
- [ ] Password hashing utility with `bcryptjs` (salt rounds: 10).
- [ ] JWT utility (`signToken`, `verifyToken`, 7-day expiration).
- [ ] Request validation middleware using Zod schemas for all auth payloads.
- [ ] Security middlewares:
  - `authenticateToken`: Validates Bearer JWT and attaches user to `req.user`.
  - `requireRole(['ORGANIZER', 'CUSTOMER'])`: Enforces role-based permissions.
  - `requireOwnership`: Ensures organizers only mutate their own events.
- [ ] Auth API endpoints:
  - `POST /api/auth/register` — Registers user, hashes password, sets `isVerified: false`, generates 6-digit crypto OTP (10-min TTL), enqueues `JOB_AUTH_OTP`.
  - `POST /api/auth/verify-otp` — Compares OTP, checks expiration, marks `isVerified: true`.
  - `POST /api/auth/login` — Validates credentials and `isVerified` status; returns JWT + role.
  - `GET /api/auth/me` — Returns current authenticated user profile.

### 2.2 Verification Checkpoint
```bash
npm test tests/integration/auth.test.ts
```
* **Success Criteria:** 
  - Unverified users cannot log in.
  - Invalid OTPs are rejected with `400 Bad Request`.
  - Valid OTPs activate the user account.
  - Correct JWT and role payload returned on login.

---

## Phase 3: Event Management & Atomic Concurrency Booking Engine
**Time Window:** Hour 3 (11:00 – 12:00)  
**Primary Goal:** Build full Event CRUD and the concurrency-safe atomic ticket booking engine with zero overselling guarantees.

### 3.1 Tasks & Deliverables
- [ ] Event Management Endpoints (`/api/events`):
  - `POST /api/events` — `[ORGANIZER]` Create new event with capacity and pricing.
  - `GET /api/events` — Public listing with pagination (`page`, `limit`), search (`q`), category filtering (`category`), and date range filtering.
  - `GET /api/events/:id` — Public single event details.
  - `PUT /api/events/:id` — `[ORGANIZER - Owner]` Update event details. Compares changes to detect critical updates (`eventDate`, `location`, `title`).
  - `DELETE /api/events/:id` — `[ORGANIZER - Owner]` Soft-cancel event (`status = CANCELLED`).
  - `GET /api/events/:id/attendees` — `[ORGANIZER - Owner]` View all confirmed attendees and sales metrics.
- [ ] **The Core Atomic Booking Engine (`POST /api/bookings`):**
  - Input validation: `1 <= ticketCount <= 10`, event not in the past (`eventDate > now()`).
  - `Idempotency-Key` header support (checks existing booking before execution).
  - Single-query atomic check-and-decrement in PostgreSQL transaction:
    ```sql
    UPDATE "Event"
    SET "availableTickets" = "availableTickets" - $requestedCount,
        "updatedAt" = NOW()
    WHERE "id" = $eventId 
      AND "availableTickets" >= $requestedCount
      AND "status" = 'UPCOMING'
    RETURNING *;
    ```
  - If 0 rows updated: Throw `409 Conflict` (Sold Out) or `422 Unprocessable Entity` (Insufficient Remaining Tickets).
  - Create `Booking` record with `CONFIRMED` status and unique `bookingReference`.
  - Create `NotificationLog` with `PENDING` status.
  - Enqueue `JOB_BOOKING_CONFIRMATION` to BullMQ.
  - Return HTTP `201 Created` with booking receipt.
- [ ] Customer Booking Management:
  - `GET /api/bookings/my` — `[CUSTOMER]` List authenticated user's bookings.
  - `GET /api/bookings/:id` — `[CUSTOMER - Owner]` Return booking details + dynamic Base64 QR code.
  - `POST /api/bookings/:id/cancel` — `[CUSTOMER - Owner]` Atomic cancellation and inventory refund (`availableTickets = availableTickets + N`). Rejects duplicate cancels with `400 Bad Request`.

### 3.2 Verification Checkpoint
```bash
npm test tests/integration/bookings.test.ts
npm test tests/concurrency/atomic-booking.test.ts
```
* **Success Criteria:** 50 concurrent requests for 10 tickets result in exactly 10 confirmed bookings, 40 rejections, and exactly 0 available tickets.

---

## Phase 4: BullMQ Job Queue, Real Email & Dynamic QR Engine
**Time Window:** Hour 4 (12:00 – 13:00)  
**Primary Goal:** Implement real transactional email delivery for all background tasks with BullMQ, Redis, Resend/SMTP, and dynamic QR generation.

### 4.1 Tasks & Deliverables
- [ ] Redis connection & BullMQ queue setup (`emailQueue`).
- [ ] Dedicated worker process (`src/workers/emailWorker.ts`) configured with:
  - Concurrency limit: 5 workers.
  - Exponential backoff retry strategy (3 attempts, initial delay: 2s).
  - Failure handler: on 3rd failure, mark `NotificationLog` as `FAILED` with `errorMessage`.
- [ ] Email Service Integration:
  - Support for Resend API and Nodemailer SMTP via environment config.
  - Verification check on startup to ensure credentials are valid.
- [ ] Dynamic QR Code Generator:
  - Utility using `qrcode` library to generate Base64 PNG data URLs from cryptographically signed booking reference payloads.
- [ ] **Background Task 1: Booking Confirmation Email (`JOB_BOOKING_CONFIRMATION`)**
  - Triggered on successful booking.
  - Renders responsive HTML template with event title, date, venue, ticket count, total amount, and embedded QR code.
  - Deterministic job ID (`confirm-${bookingId}`) to guarantee deduplication.
- [ ] **Background Task 2: Event Update Broadcast Email (`JOB_EVENT_UPDATE_BROADCAST`)**
  - Triggered on critical event update.
  - Fetches all unique confirmed attendee emails for the event.
  - Batches and sends notification emails highlighting modified fields.
- [ ] **Background Task 3: Auth OTP Email (`JOB_AUTH_OTP`)**
  - Sends 6-digit registration activation code with 10-minute expiry warning.
- [ ] Delivery Audit & Logging:
  - Worker updates `NotificationLog` table (`SENT` with `sentAt` and `providerMessageId`, or `FAILED` with `errorMessage`).
- [ ] Resend confirmation endpoint:
  - `POST /api/bookings/:id/resend-confirmation` — `[CUSTOMER - Owner]` Re-enqueues confirmation email.

### 4.2 Verification Checkpoint
```bash
npm run worker
# Trigger booking from API -> Inspect real email inbox
```
* **Success Criteria:** Booking ticket delivers a styled HTML email with a scannable QR code to a real inbox within seconds; `NotificationLog` records `SENT`.

---

## Phase 5: Automated Testing Suite & k6 Concurrency Benchmarking
**Time Window:** Hour 5 (13:00 – 14:00)  
**Primary Goal:** Build full automated test suite, apply optimizations, execute k6 stress tests, and record the real Before vs. After performance delta.

### 5.1 Tasks & Deliverables
- [ ] Build comprehensive automated test suite (`npm test` via Vitest/Supertest):
  - `tests/unit/validation.test.ts` (Zod schemas, QR code generation).
  - `tests/integration/auth.test.ts` (Registration -> OTP -> Login, unverified rejection, expired OTP rejection).
  - `tests/integration/rbac.test.ts` (Customer creating event -> 403, Organizer editing other's event -> 403, Organizer accessing another's attendee list -> 403).
  - `tests/integration/events.test.ts` (CRUD, soft cancellation, filtering, search, pagination limit <= 100).
  - `tests/integration/bookings.test.ts` (Valid booking, 10/10 tickets booked, 11th rejected with 409, requesting 11 when 10 remain -> 422, past event -> 400, cancelled event -> 400, ticketCount = 0 -> 400, ticketCount > 10 -> 400).
  - `tests/integration/cancellation.test.ts` (Atomic inventory restoration, double cancel rejection -> 400, cancel someone else's booking -> 403).
  - `tests/integration/idempotency.test.ts` (Same Idempotency-Key returns cached booking without double charging/decrementing; different Idempotency-Key creates separate booking).
  - `tests/concurrency/atomic-booking.test.ts` (50 concurrent requests competing for 10 tickets -> exactly 10 booked, 40 rejected with 409/422, zero overbooking).
- [ ] Performance Optimizations:
  - PostgreSQL connection pool tuning (`connection_limit=30`).
  - Compound database indexing (`eventId, status`, `organizerId, eventDate`).
  - Redis read caching for `GET /api/events` (60s TTL, invalidated on event creation/update).
- [ ] k6 Load Testing & Benchmarking:
  - `k6/baseline-test.js` (Simulates unoptimized synchronous flow with 200 VUs).
  - `k6/flash-sale-test.js` (Simulates 500 concurrent VUs competing for 100 tickets).
  - `k6/breaking-point-test.js` (Step ladder: 50 -> 100 -> 250 -> 500 -> 1000 -> 2000 VUs).
  - Execute both baseline and optimized tests, capture actual CLI output JSON files, and populate the Performance Delta Table with measured metrics.

### 5.2 Verification Checkpoint
```bash
npm test
k6 run k6/flash-sale-test.js
```
* **Success Criteria:** 
  - All automated tests (`npm test`) pass with 100% success.
  - Zero oversold tickets under 500 concurrent VUs (`totalCapacity = availableTickets + confirmedBookings`).
  - Zero unexpected HTTP 500 server crashes.
  - Real, measured p50/p95/p99/RPS numbers recorded for README.

---

## Phase 6: Observability, Swagger Docs & Cloud Deployment
**Time Window:** Hours 6 & 7 (14:00 – 16:00)  
**Primary Goal:** Harden observability, generate interactive API documentation, and deploy the full stack to cloud infrastructure.

### 6.1 Tasks & Deliverables
- [ ] Observability & Reliability:
  - `GET /health` endpoint reporting PostgreSQL connection, Redis connection, and BullMQ queue status.
  - Graceful shutdown handlers (`SIGTERM`, `SIGINT`) closing Express, Prisma, Redis, and BullMQ worker cleanly.
- [ ] API Documentation:
  - Interactive Swagger / OpenAPI 3.0 UI at `/api-docs`.
  - Exported Postman collection at `postman/event-booking.postman_collection.json` with pre-configured auth tokens.
- [ ] Cloud Infrastructure Setup & Deployment:
  - **Database:** Managed PostgreSQL cluster on Neon / Supabase.
  - **Redis:** Managed Redis on Upstash.
  - **Web Service (API):** Express API deployed on Render / Railway.
  - **Worker Service:** Background BullMQ worker deployed on Render / Railway.
  - Configure production environment variables on cloud dashboard.
  - Run remote database migrations and seed script.

### 6.2 Verification Checkpoint
```bash
curl https://your-deployed-api.onrender.com/health
# Response: {"status":"healthy","database":"connected","redis":"connected","queue":"ready"}
```
* **Success Criteria:** Live cloud API responds to `/health` and `/api-docs`; creating a booking on cloud URL sends a real email.

---

## Phase 7: Final README, Loom Video Demo & Submission
**Time Window:** Hour 8 (16:00 – 17:00)  
**Primary Goal:** Finalize comprehensive documentation with actual measured benchmarks, record evaluation Loom video, and submit Google Form.

### 7.1 Tasks & Deliverables
- [ ] Finalize `README.md` containing:
  - Project Overview & Key Features.
  - High-level Architecture Diagram (Mermaid).
  - Architecture Decision Records (ADRs) with rationale for all choices.
  - Mathematical Invariant Proof for zero overbooking.
  - **Performance Delta Benchmark Table containing actual measured k6 data** (Before vs. After Optimization).
  - Step-by-step local setup instructions (`.env.example`, migrations, seed).
  - Complete API reference and Swagger documentation link.
  - Cloud deployment URLs (API & Health Check).
- [ ] Record 2–5 Minute Loom Video Demo:
  - Face visible on camera throughout.
  - Explain architecture, concurrency handling, and async queue design.
  - Live walkthrough: Organizer creates event -> Customer registers & verifies OTP -> Books tickets.
  - Show real received HTML confirmation email with QR code in real inbox.
  - Show event update broadcast trigger.
  - Run live k6 stress test on camera demonstrating 0 overselling.
  - Present live cloud deployment URL.
- [ ] Submit Google Form:
  - GitHub Repository URL (Public).
  - Live Cloud API URL.
  - Loom Video URL.

### 7.2 Final Verification Checkpoint
* **Success Criteria:** All 3 submission links tested and active; form submitted before the 5:00 PM deadline.

---

## Execution Progress Tracker

| Phase | Description | Scheduled Time | Status |
|---|---|---|---|
| **Phase 1** | Foundation, PostgreSQL Schema & Seeding | Hour 1 (09:00 – 10:00) | ⏳ Ready |
| **Phase 2** | Auth, RBAC & Email OTP Verification | Hour 2 (10:00 – 11:00) | ⏳ Pending |
| **Phase 3** | Event Management & Atomic Booking Engine | Hour 3 (11:00 – 12:00) | ⏳ Pending |
| **Phase 4** | BullMQ Queue, Real Email & Dynamic QR | Hour 4 (12:00 – 13:00) | ⏳ Pending |
| **Phase 5** | Automated Tests & k6 Benchmarks | Hour 5 (13:00 – 14:00) | ⏳ Pending |
| **Phase 6** | Caching, Swagger Docs & Cloud Deployment | Hours 6-7 (14:00 – 16:00) | ⏳ Pending |
| **Phase 7** | README, Loom Video & Form Submission | Hour 8 (16:00 – 17:00) | ⏳ Pending |

