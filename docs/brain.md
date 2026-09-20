# System Brain & Architecture Decision Record (ADR)
## Comprehensive Summary of All Design Discussions, Analyses, and Decisions

> **Project:** Event Booking System Backend API  
> **Target:** 8-Hour Backend Engineering Assessment (9:00 AM – 5:00 PM)  
> **Evaluation Focus:** Correctness under extreme concurrency (zero overselling), async processing reliability (real emails via job queues), RBAC security, API performance delta (before vs. after optimization), and production readiness.

---

## Table of Contents
1. [Core Assessment Requirements & Evaluation Criteria](#1-core-assessment-requirements--evaluation-criteria)
2. [Reference Repositories Analysis & Takeaways](#2-reference-repositories-analysis--takeaways)
3. [Deep Architectural Evaluation (58-Point Critique & Locked Decisions)](#3-deep-architectural-evaluation-58-point-critique--locked-decisions)
4. [The Concurrency Problem & Final Mathematical Proof](#4-the-concurrency-problem--final-mathematical-proof)
5. [Async Job Queue & Real Email Reliability Architecture](#5-async-job-queue--real-email-reliability-architecture)
6. [Security, Auth & Email OTP Verification Architecture](#6-security-auth--email-otp-verification-architecture)
7. [QR Code & Digital E-Ticket Generation Architecture](#7-qr-code--digital-e-ticket-generation-architecture)
8. [What We Explicitly Excluded (Strict Scope Boundary)](#8-what-we-explicitly-excluded-strict-scope-boundary)
9. [Locked Production Tech Stack](#9-locked-production-tech-stack)
10. [Final Locked Database Schema (PostgreSQL + Prisma)](#10-final-locked-database-schema-postgresql--prisma)
11. [Locked REST API Endpoints Specification](#11-locked-rest-api-endpoints-specification)
12. [Performance Optimization, Benchmarking & k6 Breaking-Point Strategy](#12-performance-optimization-benchmarking--k6-breaking-point-strategy)
13. [Automated Unit & Integration Test Suite](#13-automated-unit--integration-test-suite)
14. [Deployment Architecture (Cloud Topology)](#14-deployment-architecture-cloud-topology)
15. [Environment Variables, Seeding & API Documentation](#15-environment-variables-seeding--api-documentation)
16. [8-Hour Execution Time Budget](#16-8-hour-execution-time-budget)
17. [Loom Video & Final Submission Checklist](#17-loom-video--final-submission-checklist)

---

## 1. Core Assessment Requirements & Evaluation Criteria

### 1.1 Problem Statement
Build production-grade backend APIs for an **Event Booking System** supporting two distinct personas:
- **Event Organizers:** Create, manage, update, cancel, and monitor events, attendee lists, and ticket sales.
- **Customers:** Browse upcoming events, filter/search events, and book tickets under extreme concurrency with absolute inventory safety.

### 1.2 Mandatory Background Tasks (Async Queues)
- **Task 1: Booking Confirmation Email**
  - Triggered immediately when a customer successfully books tickets.
  - Must send a **REAL** email via SMTP / Transactional API (Resend / Nodemailer). A simple `console.log` or print statement is strictly rejected.
- **Task 2: Event Update Broadcast Email**
  - Triggered when an organizer updates critical event details (date/time, venue/location, title).
  - Must asynchronously notify **all customers** who hold active confirmed bookings for that specific event.

### 1.3 Performance & Stress Testing Requirement
- Demonstrate API performance under high load (stress test / concurrency test).
- Identify system bottlenecks and breaking points through a structured load ladder (50 → 100 → 250 → 500 → 1,000 → 2,000 VUs).
- Apply optimizations (atomic queries, connection pool sizing, compound indexing, Redis read caching).
- Document and record a clear **Performance Delta (Before vs. After Optimization)**.

### 1.4 Submission Artifacts
1. **GitHub Repository:** Clean code, complete `.env.example`, automated seed script (`npm run db:seed`), Postman collection, Swagger/OpenAPI docs (`/api-docs`), and a detailed `README.md` explaining all design choices and benchmarking results.
2. **Live Deployed API & Worker:** Deployed on cloud platform (Render / Railway / Supabase / Upstash).
3. **Loom Video Demo:** 2–5 minutes, English, face visible on camera, explaining architecture, live booking flow, real inbox email reception, and k6 stress test performance delta.
4. **Google Form Submission:** [https://forms.gle/ER387znmXfN4MvzdA](https://forms.gle/ER387znmXfN4MvzdA)

---

## 2. Reference Repositories Analysis & Takeaways

We evaluated three external sources to benchmark real-world implementations against our assessment constraints:

### 2.1 Reference 1: `Eventora-MERN` (ShivaMani02)
- **Strengths:** Clean MERN architecture, JWT + bcrypt auth, RBAC, Email OTP verification during account registration, seat capacity validation, Nodemailer integration.
- **Weaknesses / Architectural Gaps:** Built on MongoDB without replica-set transaction sessions, vulnerable to race conditions under high concurrent requests (checks capacity in JS application memory before updating), lacks dedicated background queue (sends emails synchronously in request-response cycle).
- **Adopted Elements:** Role-based middleware structure, Registration Email OTP pattern, rich event metadata schema.

### 2.2 Reference 2: `BookMyScreen / bms` (amritmaurya1504 & Eraser.io Architecture)
- **Strengths:** Movie ticketing system with seat locking, Redis caching, Razorpay payment integration, Socket.io real-time seat status, Redis-backed seat hold timers (5–10 mins).
- **Weaknesses / Scope Bloat:** Built around cinema seat grids (Row A, Seat 12), which introduces massive scope bloat (payments, webhooks, websockets) not required for general aggregate ticket event booking.
- **Adopted Elements:** Separation of API and Worker processes, deterministic Redis key design, clean schema separation.

### 2.3 Reference 3: BookMyShow (Real-World Platform Analysis)
- **Insight on Seat Locking:** BookMyShow uses temporary seat locking (holding seats for 5–10 minutes) because users must spend time entering payment information.
- **Assessment Translation:** In our 8-hour assessment, there is no payment gateway step. The booking is instant. Therefore, **atomic aggregate inventory decrements** (`availableTickets = availableTickets - N WHERE availableTickets >= N`) provide 100% ACID safety without the complex distributed lock overhead of seat holding.

---

## 3. Deep Architectural Evaluation (58-Point Critique & Locked Decisions)

During our technical evaluator review, several critical architectural ambiguities and design choices were rigorously audited and locked:

### 🔴 Critical Corrections (Must-Fix Decisions)
1. **Eliminate Database Ambiguity:** Dropped MongoDB entirely. Locked exclusively on **PostgreSQL (via Prisma ORM)** to utilize strict relational ACID constraints, row-level check constraints, and atomic conditional updates.
2. **Deterministic Concurrency Approach:** Rejected application-level locks and raw distributed locks in favor of **PostgreSQL atomic conditional updates** (Single-query check-and-decrement), which avoids deadlock risk, eliminates thread blocking, and guarantees zero overbooking.
3. **Money Representation:** Replaced JavaScript `Float` with **Prisma `Decimal(10, 2)` / PostgreSQL `NUMERIC(10,2)`** to prevent floating-point rounding errors in ticket prices and totals.
4. **Idempotency Protection:** Added a unique `idempotencyKey` field to the `Booking` table to prevent duplicate charges/bookings on client network retries.
5. **Database-Level Integrity Constraints:** Added explicit DB constraints (`available_tickets >= 0`, `total_capacity > 0`, `ticket_price >= 0`) as a defense-in-depth safety net.
6. **Organizer Resource Ownership:** Enforced strict check (`event.organizerId === req.user.id`) in middleware/controllers to prevent Organizer A from mutating Organizer B's events.
7. **No Hallucinated Benchmarks:** All performance figures in reports/README must be generated from real local and cloud k6 runs, never pre-written estimates.
8. **Dual-Process Deployment:** Ensured the background worker runs as a distinct process (or concurrent runtime) alongside Express, avoiding blocked event loops.

### 🟡 Operational & Reliability Hardening
9. **BullMQ Job Deduplication:** Deterministic job IDs (e.g., `booking-confirm-${bookingId}`) to guarantee no customer receives duplicate confirmation emails.
10. **Benchmark Error Classification:** Explicitly separate HTTP 500 errors (actual bugs) from HTTP 409 `SOLD_OUT` / 422 `INSUFFICIENT_SEATS` (correct business logic behavior) in k6 stress tests.
11. **Cache Consistency:** Avoid caching `availableTickets` in Redis for booking validation. The booking transaction must always decrement PostgreSQL directly. Redis is reserved for read-heavy listing caches (`GET /api/events`).
12. **Cancellation Idempotency:** Cancelling an already cancelled booking returns HTTP 400 `ALREADY_CANCELLED`, preventing inventory inflation attacks.
13. **Soft Deletion of Events:** Events are marked `status = 'CANCELLED'`, preserving relational audit history for existing bookings.
14. **Smart Event Update Broadcasts:** Worker enqueues broadcast emails only when critical fields change (`eventDate`, `location`, `title`), sends exclusively to unique confirmed attendees (`status = CONFIRMED`), and ignores cancelled bookings.
15. **Notification Audit Trail & Enqueue Fallback:** Maintained a dedicated `NotificationLog` table. If Redis/BullMQ enqueue fails post-transaction, `NotificationLog` remains `PENDING` and logs the alert without crashing the client's HTTP response.
16. **Health Checks & Graceful Shutdown:** Implemented `GET /health` and `SIGTERM`/`SIGINT` handlers closing Express, Prisma pool, Redis client, and BullMQ worker cleanly.
17. **Relational Deletion Safeguard:** Set `onDelete: Restrict` on critical relations (`User` -> `Booking`, `Event` -> `Booking`) to prevent cascading deletion from wiping out historical financial/booking audit trails.
18. **Two-Role RBAC Purity:** Cleanly limited roles to `CUSTOMER` and `ORGANIZER`. Removed unnecessary `/api/admin/metrics` endpoint; event metrics are served directly to the event owner at `/api/events/:id/attendees`.
19. **Global Error-Handling Middleware:** Centralized Express error handler returning standard JSON format `{ "success": false, "error": { "code": "SOLD_OUT", "message": "..." } }`, preventing raw database stack traces from leaking to clients.
20. **Security & Sanitization Standards:**
    - Never expose `passwordHash`, `otpCode`, or `otpExpiresAt` in API responses.
    - Automatic email normalization (`email.toLowerCase().trim()`).
    - Crypto-secure 6-digit OTP generation with 10-minute expiry and attempt limits.
    - Pagination limit ceiling (`limit <= 100`, default: `20`).
    - Strict environment validation on startup via Zod (ensuring `JWT_SECRET` has min 32 chars).
    - Rate limiting via `express-rate-limit` on auth endpoints (`/register`, `/verify-otp`, `/login`).

---

## 4. The Concurrency Problem & Final Mathematical Proof

### 4.1 The Race Condition Threat
Under standard naive logic:
```ts
// ❌ NAIVE IMPLEMENTATION (RACE CONDITION VULNERABLE)
const event = await prisma.event.findUnique({ where: { id } });
if (event.availableTickets >= requestedCount) {
  // Concurrently, 50 requests reach this line at the exact same millisecond!
  await prisma.event.update({
    where: { id },
    data: { availableTickets: event.availableTickets - requestedCount }
  });
  await prisma.booking.create(...);
}
```
If 10 tickets remain and 50 concurrent requests each ask for 1 ticket:
- Without concurrency protection: All 50 read `availableTickets = 10`.
- All 50 proceed to create bookings.
- Result: **50 bookings created for 10 tickets (Overbooking disaster, -40 inventory).**

### 4.2 The Solution: Atomic Conditional Decrement
We execute the check and decrement in a single atomic SQL operation within an interactive transaction:
```sql
UPDATE "Event"
SET "availableTickets" = "availableTickets" - $requestedCount,
    "updatedAt" = NOW()
WHERE "id" = $eventId 
  AND "availableTickets" >= $requestedCount
  AND "status" = 'UPCOMING'
RETURNING *;
```
If the rows affected is `0`, the event is either sold out, has insufficient remaining tickets, or is not in `UPCOMING` status. The transaction immediately rolls back and returns HTTP 409 `SOLD_OUT` or 422 `INSUFFICIENT_TICKETS`.

### 4.3 Mathematical Proof of Correctness
At all points in time $t$, the system enforces the strict invariant:
$$\text{totalCapacity} = \text{availableTickets}_t + \sum_{b \in \text{ConfirmedBookings}} b.\text{ticketCount}$$

With DB Check Constraint:
$$\text{availableTickets} \ge 0$$
$$\text{Overbooking Probability} = 0.000\%$$

---

## 5. Async Job Queue & Real Email Reliability Architecture

```
[Customer Client] ──(POST /api/bookings)──► [Express API]
                                                 │
                                                 ├── 1. Atomic DB Transaction (Prisma + PG)
                                                 │      - Decrement availableTickets
                                                 │      - Create Booking (CONFIRMED)
                                                 │      - Create NotificationLog (PENDING)
                                                 │
                                                 ├── 2. BullMQ Enqueue (Redis)
                                                 │      Job: 'SEND_BOOKING_CONFIRMATION'
                                                 │      JobId: `confirm-${bookingId}`
                                                 │
                                                 └── 3. HTTP 201 Created (Instant Response)
                                                        (Client does NOT wait for SMTP!)

[Redis Queue: emailQueue]
         │
         ▼
[BullMQ Worker Process]
         │
         ├── Fetch Job ──► Generate HTML Template + Dynamic QR Code
         │                 (Event title, QR reference, ticket count, venue, date)
         │
         ├── Send via Resend API / SMTP (Nodemailer)
         │      ├── Success ──► Update NotificationLog -> SENT, sentAt = NOW()
         │      └── Failure ──► Exponential Backoff Retry (3 attempts)
         │                      If 3 fails ──► NotificationLog -> FAILED, log error
```

### 5.1 Unified Queue Job Definitions
1. **`JOB_AUTH_OTP`**: Sends 6-digit registration activation code (TTL: 10 mins).
2. **`JOB_BOOKING_CONFIRMATION`**: Sends rich HTML receipt with booking reference, ticket count, event location, date, and embedded QR code.
3. **`JOB_EVENT_UPDATE_BROADCAST`**: Broadcasts event modifications in batches to all unique confirmed attendee emails.

---

## 6. Security, Auth & Email OTP Verification Architecture

### 6.1 RBAC Model
- **`CUSTOMER`**: Can register, verify OTP, login, view public events, search/filter, book tickets, view personal booking history, cancel personal bookings, view digital e-tickets with QR codes.
- **`ORGANIZER`**: All customer privileges + create new events, update own events, cancel own events, view attendee list and real-time sales metrics for own events.

### 6.2 Clarification: Email OTP Verification vs. 2FA
- **Feature Identity:** We explicitly term this **Email OTP Verification / Account Activation**.
- **Flow:**
  1. `POST /api/auth/register` creates user with `isVerified: false` and generates a crypto-secure 6-digit OTP stored with a 10-minute expiry.
  2. Enqueues `JOB_AUTH_OTP` to BullMQ.
  3. User receives email with OTP and calls `POST /api/auth/verify-otp`.
  4. On successful match, user is marked `isVerified: true` and can login.
- **Booking Checkout Strategy:** Booking does **NOT** require an OTP on checkout. Requiring an OTP during high-load concurrency testing would throttle the benchmark to third-party email delivery latency rather than testing true database concurrency throughput.

---

## 7. QR Code & Digital E-Ticket Generation Architecture

### 7.1 Dynamic On-Demand Generation (Zero DB Bloat)
Rather than storing binary image blobs in PostgreSQL:
1. Every booking is assigned a unique, cryptographically random `bookingReference` (e.g., `BK-8F3A-99D2`).
2. When the customer accesses `GET /api/bookings/:id` or receives their confirmation email:
   - The backend dynamically generates a QR Code data URL (Base64 PNG) using the standard `qrcode` library encoding a secure verification payload:
   ```json
   {
     "ref": "BK-8F3A-99D2",
     "eventId": "evt_123",
     "tickets": 2,
     "holder": "John Doe",
     "sig": "hmac_sha256_hash"
   }
   ```
3. The QR Code data URL is embedded directly into the HTML email template and returned in the API response for mobile/client display.

---

## 8. What We Explicitly Excluded (Strict Scope Boundary)

To ensure 100% completion and excellence within the 8-hour window, the following non-essential items are strictly out of scope:

| Excluded Feature | Rationale |
|---|---|
| **Payment Gateway (Stripe/Razorpay)** | Not requested in spec. Adds webhook complexity and third-party dependencies that slow down API evaluation. |
| **Cinema Seat Grid Selection (A1, A2)** | Assessment specifies aggregate event ticket booking, not theater seat mapping. |
| **Socket.io / WebSockets** | HTTP polling or REST is cleaner and more standard for backend API benchmarking. |
| **Frontend React/Next.js App** | Assessment is strictly backend APIs + documentation + video. UI brings zero extra points and burns 3+ hours. |
| **Complex Multi-Tier Ticket Pricing (VIP/General)** | Handled simply by single ticket price per event or creating multiple event tiers. |

---

## 9. Locked Production Tech Stack

| Layer | Technology | Justification |
|---|---|---|
| **Language & Runtime** | Node.js v18+ LTS + TypeScript 5.x | Type safety, high async I/O throughput. |
| **Framework** | Express.js | Standard, lightweight, predictable middleware chain. |
| **Database** | PostgreSQL 16+ (Neon / Supabase) | ACID compliance, strict constraints, row-level locking. |
| **ORM & Migrations** | Prisma ORM | Type-safe queries, automatic migration generation. |
| **Cache & Job Broker** | Redis (Upstash / Local Redis) | High-speed memory store for BullMQ queue. |
| **Job Queue** | BullMQ | Robust Redis-backed queue with retries and dead-letter handling. |
| **Email Service** | Resend API / Nodemailer SMTP | Real transactional email delivery. |
| **QR Generation** | `qrcode` package | Lightweight, dynamic Base64 QR code generation. |
| **Validation** | Zod | Runtime schema validation for request payloads. |
| **Security** | Helmet, CORS, bcryptjs, jsonwebtoken, express-rate-limit | Standard enterprise security defaults. |
| **Unit/Integration Tests** | Vitest / Jest + Supertest | Fast, reliable test runner for API and concurrency testing. |
| **Load Testing** | k6 (Grafana) | High-performance CLI stress-testing with JSON reports. |
| **API Documentation** | Swagger-UI-Express + OpenAPI 3.0 | Interactive `/api-docs` endpoint. |

---

## 10. Final Locked Database Schema (PostgreSQL + Prisma)

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

enum Role {
  CUSTOMER
  ORGANIZER
}

enum EventStatus {
  UPCOMING
  ONGOING
  COMPLETED
  CANCELLED
}

enum BookingStatus {
  CONFIRMED
  CANCELLED
}

enum NotificationStatus {
  PENDING
  SENT
  FAILED
}

enum NotificationType {
  AUTH_OTP
  BOOKING_CONFIRMATION
  EVENT_UPDATE_BROADCAST
}

model User {
  id            String    @id @default(uuid())
  email         String    @unique
  passwordHash  String
  fullName      String
  role          Role      @default(CUSTOMER)
  isVerified    Boolean   @default(false)
  otpCode       String?
  otpExpiresAt  DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  events        Event[]   @relation("OrganizerEvents")
  bookings      Booking[]

  @@index([email])
}

model Event {
  id               String            @id @default(uuid())
  organizerId      String
  organizer        User              @relation("OrganizerEvents", fields: [organizerId], references: [id], onDelete: Restrict)
  title            String
  description      String
  category         String
  location         String
  onlineLink       String?
  eventDate        DateTime
  totalCapacity    Int
  availableTickets Int
  ticketPrice      Decimal           @db.Decimal(10, 2)
  status           EventStatus       @default(UPCOMING)
  createdAt        DateTime          @default(now())
  updatedAt        DateTime          @updatedAt

  bookings         Booking[]
  notifications    NotificationLog[]

  @@index([organizerId])
  @@index([eventDate])
  @@index([category])
  @@index([status])
}

model Booking {
  id               String            @id @default(uuid())
  bookingReference String            @unique @default(cuid())
  idempotencyKey   String?           @unique
  customerId       String
  customer         User              @relation(fields: [customerId], references: [id], onDelete: Restrict)
  eventId          String
  event            Event             @relation(fields: [eventId], references: [id], onDelete: Restrict)
  ticketCount      Int
  totalAmount      Decimal           @db.Decimal(10, 2)
  status           BookingStatus     @default(CONFIRMED)
  createdAt        DateTime          @default(now())
  updatedAt        DateTime          @updatedAt

  notifications    NotificationLog[]

  @@index([customerId])
  @@index([eventId])
  @@index([status])
}

model NotificationLog {
  id                 String             @id @default(uuid())
  eventId            String?
  event              Event?             @relation(fields: [eventId], references: [id], onDelete: SetNull)
  bookingId          String?
  booking            Booking?           @relation(fields: [bookingId], references: [id], onDelete: SetNull)
  recipientEmail     String
  notificationType   NotificationType
  deliveryStatus     NotificationStatus @default(PENDING)
  attempts           Int                @default(0)
  providerMessageId  String?
  errorMessage       String?
  createdAt          DateTime           @default(now())
  sentAt             DateTime?

  @@index([recipientEmail])
  @@index([deliveryStatus])
  @@index([notificationType])
}
```

---

## 11. Locked REST API Endpoints Specification

### 11.1 Authentication (`/api/auth`)
- `POST /api/auth/register` — Register new Customer or Organizer (generates & enqueues Email OTP).
- `POST /api/auth/verify-otp` — Verify 6-digit OTP and activate account (`isVerified: true`).
- `POST /api/auth/login` — Authenticate verified user and return JWT token + user profile.
- `GET /api/auth/me` — Return current authenticated user profile.

### 11.2 Events (`/api/events`)
- `GET /api/events` — Public listing of upcoming events (cached in Redis, searchable, filtered by category/date, paginated).
- `GET /api/events/:id` — Public event details by ID.
- `POST /api/events` — `[ORGANIZER]` Create a new event (`ticketPrice >= 0`, `totalCapacity > 0`).
- `PUT /api/events/:id` — `[ORGANIZER - Owner]` Update event details (triggers broadcast if `eventDate`, `location`, or `title` changes).
- `DELETE /api/events/:id` — `[ORGANIZER - Owner]` Soft-cancel event (`status = CANCELLED`).
- `GET /api/events/:id/attendees` — `[ORGANIZER - Owner]` View all confirmed attendees and sales metrics for own event.

### 11.3 Bookings (`/api/bookings`)
- `POST /api/bookings` — `[CUSTOMER]` Concurrency-safe atomic ticket booking (validates `1 <= ticketCount <= 10`, `eventDate > now()`, supports `Idempotency-Key` header).
- `GET /api/bookings/my` — `[CUSTOMER]` List authenticated customer's booking history.
- `GET /api/bookings/:id` — `[CUSTOMER - Owner]` Get single booking receipt details with dynamically rendered Base64 QR code.
- `POST /api/bookings/:id/cancel` — `[CUSTOMER - Owner]` Cancel booking and refund inventory atomically. Reject if already cancelled (HTTP 400).
- `POST /api/bookings/:id/resend-confirmation` — `[CUSTOMER - Owner]` Re-enqueue confirmation email to BullMQ.

### 11.4 System & Observability (`/api/system`)
- `GET /health` — Health check endpoint reporting PostgreSQL connection, Redis connection, and BullMQ queue statuses.
- `GET /api-docs` — Swagger/OpenAPI interactive API documentation.

---

## 12. Performance Optimization, Benchmarking & k6 Breaking-Point Strategy

### 12.1 The Two-Stage Benchmark Protocol (Proving Performance Delta)

To satisfy the explicit assessment requirement for a **Before vs. After Optimization Delta**, we define two distinct testing profiles:

#### Stage A: Baseline Profile (Unoptimized)
- **Architecture:** Naive `findUnique` -> JS memory check -> `update`. Synchronous Nodemailer email dispatch inside the HTTP request loop. No Redis cache. Default connection pool (5).
- **Execution:** Run 30-second k6 burst with 200 VUs.
- **Observed Characteristics:** High p95 latency (>2500ms due to SMTP wait), frequent connection pool exhaustion, high 5xx error rate, severe overbooking race conditions.

#### Stage B: Optimized Profile (Production Architecture)
- **Architecture:** Single-query atomic decrement in PostgreSQL, asynchronous BullMQ job dispatch, Redis caching for event listings, tuned connection pool (`connection_limit=30`), compound DB indexing.
- **Execution:** Run exact same 30-second k6 burst with 200 VUs, and then scale up to 500 VUs.
- **Observed Characteristics:** Sub-50ms p95 latency, 0 overbooking, 0 500 errors, clean 409 `SOLD_OUT` handling.

#### Performance Delta Measurement Template (To be populated with actual k6 run results)
| Metric | Baseline (Unoptimized) | Optimized (Production) | Delta / Improvement |
|---|---|---|---|
| **Requests / Second (RPS)** | *[Measured req/s]* | *[Measured req/s]* | *[Calculated %]* |
| **p50 Latency** | *[Measured ms]* | *[Measured ms]* | *[Calculated %]* |
| **p95 Latency** | *[Measured ms]* | *[Measured ms]* | *[Calculated %]* |
| **p99 Latency** | *[Measured ms]* | *[Measured ms]* | *[Calculated %]* |
| **HTTP 5xx Server Errors** | *[Measured %]* | *[Target: 0.00%]* | *[Calculated %]* |
| **Overbooked Tickets** | *[Measured count]* | *[Target: 0 (Invariant holds)]* | *[100% Correctness]* |

---

### 12.2 Breaking-Point Test Ladder
We test the API across a structured VU ladder to identify the precise hardware/system saturation point:
```
VU Ladder: 50 VUs ──► 100 VUs ──► 250 VUs ──► 500 VUs ──► 1,000 VUs ──► 2,000 VUs
```
- **Tracking:** RPS, p95 response time, active PostgreSQL connections, CPU utilization, Redis queue lag.
- **Breaking Point Definition:** The concurrency level where p95 exceeds 1,000ms or connection timeouts begin.

---

## 13. Automated Unit & Integration Test Suite

We maintain an automated test suite (`npm test`) covering critical business logic, security constraints, and concurrency guarantees:

```
tests/
├── unit/
│   ├── validation.test.ts        # Zod schema validation (email formats, ticket counts, price decimals)
│   └── qr.test.ts                # QR payload formatting and signature generation
├── integration/
│   ├── auth.test.ts              # Registration -> OTP generation -> Verification -> Login flow
│   ├── rbac.test.ts              # Customer creating event (403), Organizer modifying other's event (403)
│   ├── events.test.ts            # Event CRUD, soft cancellation, filtering, Redis cache invalidation
│   ├── bookings.test.ts          # Valid booking, insufficient tickets (422), past event rejection (400)
│   ├── cancellation.test.ts      # Atomic inventory restoration, double-cancellation rejection (400)
│   └── idempotency.test.ts       # Retried request with same Idempotency-Key returns cached response
└── concurrency/
    └── atomic-booking.test.ts    # 50 concurrent requests for 10 tickets -> exactly 10 booked, 40 rejected
```

---

## 14. Deployment Architecture (Cloud Topology)

```
                       ┌────────────────────────────┐
                       │       Client Requests      │
                       └─────────────┬──────────────┘
                                     │
                                     ▼
                       ┌────────────────────────────┐
                       │   Render / Railway (Web)   │
                       │   Express API (Port 4000)  │
                       └──────┬──────────────┬──────┘
                              │              │
         ┌────────────────────┘              └────────────────────┐
         ▼                                                        ▼
┌────────────────────────────┐                         ┌────────────────────────────┐
│   Neon / Supabase Cloud    │                         │    Upstash Redis Cloud     │
│   PostgreSQL 16 Database   │                         │    Cache & BullMQ Broker   │
└────────┬───────────────────┘                         └──────────┬─────────────────┘
         │                                                        │
         │             ┌────────────────────────────┐             │
         └────────────►│  Render / Railway (Worker) │◄────────────┘
                       │   BullMQ Worker Process    │
                       └─────────────┬──────────────┘
                                     │
                                     ▼
                       ┌────────────────────────────┐
                       │  Resend / Nodemailer SMTP  │
                       │   Real Transactional Email │
                       └────────────────────────────┘
```

---

## 15. Environment Variables, Seeding & API Documentation

### 15.1 `.env.example` Template
```env
# Server
NODE_ENV=development
PORT=4000

# Database
DATABASE_URL="postgresql://postgres:password@localhost:5432/event_booking_db?schema=public"

# Redis & Queue
REDIS_URL="redis://localhost:6379"

# Security
JWT_SECRET="super-secret-jwt-key-change-in-production-min-32-chars"
JWT_EXPIRES_IN="7d"

# Email Delivery (Resend / SMTP)
EMAIL_PROVIDER="resend" # or "smtp"
RESEND_API_KEY="re_123456789"
SMTP_HOST="smtp.gmail.com"
SMTP_PORT=587
SMTP_USER="notifications@eventsystem.com"
SMTP_PASS="app-specific-password"
EMAIL_FROM="Eventora System <onboarding@resend.dev>"
```

### 15.2 Database Seed Script (`npm run db:seed`)
The seed script idempotently generates:
- **1 Organizer:** `organizer@test.com` / `Password123!`
- **5 Customers:** `customer1@test.com` through `customer5@test.com` / `Password123!` (all pre-verified)
- **1 Flash Sale Event:** "Tech Summit 2026", 100 total capacity, 100 available tickets, $49.99 ticket price.
- **1 Regular Event:** "DevOps Workshop", 50 total capacity, 50 available tickets, $19.99 ticket price.

### 15.3 API Documentation & Postman
- Interactive documentation hosted at `/api-docs` via Swagger/OpenAPI 3.0.
- Exported Postman collection saved at `postman/event-booking-api.postman_collection.json` with pre-configured authentication scripts and variable chaining.

---

## 16. 8-Hour Execution Time Budget

```
┌─────────────────────────┬──────────────────────────────────────────────────────┐
│ Time Window             │ Objective & Deliverables                             │
├─────────────────────────┼──────────────────────────────────────────────────────┤
│ Hour 1 (09:00 - 10:00)  │ Environment Setup, Prisma Schema, Migration, Seed    │
│ Hour 2 (10:00 - 11:00)  │ Auth Module, JWT, RBAC Middleware, OTP Queue Worker  │
│ Hour 3 (11:00 - 12:00)  │ Event CRUD + Atomic Concurrency Booking Engine Core  │
│ Hour 4 (12:00 - 13:00)  │ BullMQ Worker, HTML Templates, Real Email & QR Code  │
│ Hour 5 (13:00 - 14:00)  │ Automated Test Suite + k6 Load Testing & Benchmarks  │
│ Hour 6 (14:00 - 15:00)  │ Redis Caching, Health Check, Swagger Docs & Hardening│
│ Hour 7 (15:00 - 16:00)  │ Cloud Deployment (API + Worker + DB + Redis)         │
│ Hour 8 (16:00 - 17:00)  │ README Finalization, Loom Video Recording & Form Sub │
└─────────────────────────┴──────────────────────────────────────────────────────┘
```

---

## 17. Loom Video & Final Submission Checklist

### 17.1 Loom Video Structure (2–5 Minutes)
1. **Introduction & Architecture (45s):** Face visible on camera. Introduce project, tech stack (Node/TS, PostgreSQL, Prisma, BullMQ, Redis, Resend), and the atomic concurrency architecture.
2. **Live Walkthrough & Real Email Delivery (90s):**
   - Register organizer -> Create event.
   - Register customer -> Receive real OTP -> Verify account -> Login.
   - Book tickets -> Open real email inbox on screen showing the HTML confirmation email with embedded dynamic QR code.
3. **Async Event Update Broadcast (45s):**
   - Organizer updates event date/venue -> BullMQ worker immediately processes and broadcasts emails to all confirmed attendees.
4. **Concurrency & k6 Stress Test Demo (60s):**
   - Run k6 flash-sale test live on screen (500 concurrent VUs for 100 tickets).
   - Show 0 overbooked tickets in PostgreSQL database.
   - Present the Performance Delta table (Before vs. After Optimization).
5. **Conclusion & Cloud Links (15s):**
   - Show live deployment running on cloud URL.

### 17.2 Final Submission Form Items
- [ ] GitHub Repository URL (Public, well-structured)
- [ ] Live Deployed API URL (Render / Railway)
- [ ] Loom Video URL (Publicly accessible, face visible)
- [ ] Comprehensive `README.md` with complete ADRs, Architecture Diagrams, and Before/After Benchmark Deltas
