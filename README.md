# 🎟️ High-Concurrency Event Booking System Backend

[![Node.js](https://img.shields.io/badge/Node.js-v20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Express](https://img.shields.io/badge/Express-4.21-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Prisma](https://img.shields.io/badge/Prisma-5.20-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io/)
[![Redis](https://img.shields.io/badge/Redis-Upstash-DC382D?logo=redis&logoColor=white)](https://upstash.com/)
[![BullMQ](https://img.shields.io/badge/BullMQ-Worker_Queues-FF4F64)](https://bullmq.io/)
[![Tests](https://img.shields.io/badge/Tests-62%20Passing%20(100%25)-brightgreen)](docs/testcases.md)
[![Zero Overselling](https://img.shields.io/badge/Overselling-0%20Tickets-success)](docs/testcase5.md)
[![Architecture Board](https://img.shields.io/badge/Eraser.io-Architecture_Diagram-purple?logo=diagrams.net&logoColor=white)](https://app.eraser.io/workspace/K03ts7PmbjI2eR0HlIE6?origin=share)

An enterprise-grade, high-concurrency event ticketing and booking backend built with **Node.js, Express, TypeScript, PostgreSQL, Prisma, Redis, BullMQ, and Resend**.

Engineered to handle flash-sale traffic bursts with atomic PostgreSQL conditional decrements to prevent overselling, database-backed customer-scoped idempotency deduplication, cryptographic HMAC-signed QR code e-tickets, asynchronous fault-tolerant email notification queues with transactional outbox reconciliation, and Redis read-through caching.

---

## 📑 Table of Contents

- [Architectural Overview & Eraser.io Diagrams](#-architectural-overview)
- [System Architecture Diagram](#-system-architecture-diagram)
- [Booking Engine & Concurrency Design](#-booking-engine--concurrency-design)
- [Database Entity Relationship Diagram (ERD)](#-database-entity-relationship-diagram-erd)
- [Core Technical Decisions & Tradeoffs](#-core-technical-decisions--tradeoffs)
- [Empirical Benchmark Results (Phase 5)](#-empirical-benchmark-results-phase-5)
- [Concurrency Constraints & Optimization Delta Report](docs/CONCURRENCY_OPTIMIZATION_REPORT.md)
- [Quickstart Guide (5-Minute Setup)](#-quickstart-guide-5-minute-setup)
- [Environment Variables Reference](#-environment-variables-reference)
- [REST API Endpoints Catalog](#-rest-api-endpoints-catalog)
- [Automated Testing & Benchmarking](#-automated-testing--benchmarking)
- [Swagger OpenAPI & Postman Collection](#-swagger-openapi--postman-collection)
- [5-Minute Video Demonstration Script](#-5-minute-video-demonstration-script)

---

## 🏛️ Architectural Overview

> 📐 **Live Interactive Architecture Board:** [Open in Eraser.io](https://app.eraser.io/workspace/K03ts7PmbjI2eR0HlIE6?origin=share)  
> *Features full interactive system topology, middleware request lifecycle flowchart, and ACID booking sequence diagrams.*

```text
                                 ┌────────────────────────────────────────────────────────┐
                                 │                   Client Layer                         │
                                 │       (Web, Mobile, Postman, k6 Virtual Users)         │
                                 └──────────────────────────┬─────────────────────────────┘
                                                            │
                                                     HTTP / JSON / JWT
                                                            │
                                                            ▼
                                 ┌────────────────────────────────────────────────────────┐
                                 │            Express 4.x Application Layer              │
                                 │  - Helmet Security & CORS Preflights                   │
                                 │  - Zod Input Parsing & Schema Validation               │
                                 │  - JWT Bearer Authentication & RBAC Middleware         │
                                 │  - Centralized Error & Rate Limit Middleware           │
                                 └──────────────┬─────────────────────────┬───────────────┘
                                                │                         │
                        ┌───────────────────────┴──────┐           ┌──────┴───────────────────────┐
                        │   Read Cache / Queue Bus     │           │   ACID Transaction Layer     │
                        ▼                              ▼           ▼                              ▼
             ┌─────────────────────┐       ┌─────────────────────┐      ┌─────────────────────────────┐
             │ Upstash Redis Cache │       │   BullMQ Producer   │      │      PostgreSQL Database    │
             │ - Event Lists Cache │       │ - AUTH_OTP          │      │ - Atomic Conditional Update │
             │ - Detail Read Cache │       │ - BOOKING_CONFIRM   │      │ - Idempotency-Key Index     │
             │ - Non-blocking SCAN │       │ - EVENT_BROADCAST   │      │ - Strict Foreign Key Rels   │
             └─────────────────────┘       └──────────┬──────────┘      └─────────────────────────────┘
                                                      │
                                                      ▼
                                           ┌─────────────────────┐
                                           │ BullMQ Worker Node  │
                                           │ - Concurrency: 5    │
                                           │ - Exponential Retry │
                                           │ - HMAC QR Generator │
                                           └──────────┬──────────┘
                                                      │
                                                      ▼
                                           ┌─────────────────────┐
                                           │  Resend Email API   │
                                           │ - Real SMTP / TLS   │
                                           │ - HTML & QR E-Ticket│
                                           └─────────────────────┘
```

---

## 🔄 Concurrency & Booking Engine Design

### 1. Zero-Overselling Atomic PostgreSQL Conditional Decrement
Instead of naive "read-modify-write" patterns that cause race conditions, ticket inventory decrements are executed atomically at the database engine level inside an ACID transaction:

```sql
UPDATE events
SET "availableTickets" = "availableTickets" - $quantity
WHERE id = $eventId
  AND "availableTickets" >= $quantity
  AND status = 'UPCOMING'
RETURNING *;
```

If multiple concurrent requests arrive with only 1 ticket remaining:
- The first transaction successfully updates the row and receives the updated record.
- Subsequent concurrent transactions find 0 matching rows (`availableTickets >= quantity` evaluates to `FALSE`) and immediately receive a `409 Conflict (SOLD_OUT / INSUFFICIENT_TICKETS)` without dirty reads or deadlocks.

### 2. Database-Backed Idempotency-Key Deduplication
To prevent duplicate charges or double-booking during network retries or client double-clicks:
1. The client supplies an `Idempotency-Key: <unique-uuid>` header.
2. If a booking with this key already exists:
   - The server verifies customer ownership and payload consistency.
   - The server returns `200 OK` with the existing booking record (`isReplayed: true`).
   - **Zero inventory decrement occurs.**
3. If two concurrent requests arrive with the identical `Idempotency-Key`:
   - PostgreSQL unique constraints (`@@unique([idempotencyKey])`) enforce that only one transaction creates the record while the other rolls back cleanly.

```mermaid
sequenceDiagram
    autonumber
    actor Customer
    participant API as Express API
    participant DB as PostgreSQL (ACID)
    participant Redis as Redis Cache
    participant Queue as BullMQ
    participant Worker as Email Worker
    participant Resend as Resend API

    Customer->>API: POST /api/bookings (eventId, qty, Idempotency-Key)
    API->>DB: Check existing Idempotency-Key
    alt Key exists (Replay)
        DB-->>API: Return existing Booking
        API-->>Customer: 200 OK (isReplayed: true)
    else New Transaction
        API->>DB: UPDATE events SET availableTickets = availableTickets - qty WHERE availableTickets >= qty
        alt Insufficient Tickets
            DB-->>API: 0 rows updated
            API-->>Customer: 409 Conflict (SOLD_OUT)
        else Tickets Available
            DB-->>API: Updated Event Row
            API->>DB: INSERT INTO bookings (CONFIRMED)
            API->>Redis: Invalidate cache (events:detail & events:list:*)
            API->>Queue: Enqueue BOOKING_CONFIRMATION job
            API-->>Customer: 201 Created (Booking Data)
            
            Queue->>Worker: Process Job (HMAC-signed QR + Email)
            Worker->>Resend: Send E-Ticket with QR Attachment
            Worker->>DB: UPDATE notification_logs SET deliveryStatus = 'SENT'
        end
    end
```

---

## 🗄️ Database Entity Relationship Diagram (ERD)

```mermaid
erDiagram
    User ||--o{ Event : "organizes"
    User ||--o{ Booking : "makes"
    Event ||--o{ Booking : "contains"
    Event ||--o{ NotificationLog : "triggers"
    Booking ||--o{ NotificationLog : "generates"

    User {
        string id PK "UUID"
        string email UK "Unique index"
        string passwordHash "bcrypt (salt=10)"
        string fullName
        enum role "CUSTOMER | ORGANIZER"
        boolean isVerified "Default false"
        string otpHash "SHA-256 OTP hash"
        datetime otpExpiresAt "UTC Timestamp"
        int otpAttempts "Max 5"
        datetime createdAt
        datetime updatedAt
    }

    Event {
        string id PK "UUID"
        string organizerId FK "references User(id)"
        string title
        string description
        string category
        string location
        string onlineLink "Optional"
        datetime eventDate "UTC Timestamp"
        int totalCapacity "CHECK > 0"
        int availableTickets "CHECK >= 0"
        decimal ticketPrice "NUMERIC(10,2)"
        enum status "UPCOMING | ONGOING | COMPLETED | CANCELLED"
        datetime createdAt
        datetime updatedAt
    }

    Booking {
        string id PK "UUID"
        string bookingReference UK "cuid (e-ticket ref)"
        string idempotencyKey UK "Unique index for retries"
        string customerId FK "references User(id)"
        string eventId FK "references Event(id)"
        int ticketCount "1 to 10"
        decimal totalAmount "NUMERIC(10,2)"
        enum status "CONFIRMED | CANCELLED"
        datetime createdAt
        datetime updatedAt
    }

    NotificationLog {
        string id PK "UUID"
        string eventId FK "Nullable"
        string bookingId FK "Nullable"
        string recipientEmail
        enum notificationType "AUTH_OTP | BOOKING_CONFIRMATION | EVENT_UPDATE_BROADCAST"
        enum deliveryStatus "PENDING | SENT | FAILED"
        int attempts "Exponential backoff up to 3"
        string providerMessageId "From Resend"
        string errorMessage "Captured on failure"
        datetime createdAt
        datetime sentAt
    }
```

---

## 💡 Core Technical Decisions & Tradeoffs

| Architecture Area | Chosen Approach | Alternative Considered | Engineering Rationale |
|---|---|---|---|
| **Inventory Concurrency** | **PostgreSQL Atomic Conditional Updates** | Redis `DECRBY` / Distributed Locks | Zero drift between cache and persistent storage; eliminates multi-phase commit overhead; ACID compliant with row-level locks. |
| **Idempotency** | **Database Unique Constraints on `idempotencyKey`** | In-memory Redis TTL keys | Ensures permanent historical replay guarantees; prevents double-billing across transaction rollbacks. |
| **Email Processing** | **Decoupled BullMQ Worker Process** | In-band synchronous SMTP | Prevents third-party email network latency from blocking HTTP responses; provides automated exponential backoff retries with outbox tracking. |
| **E-Ticket Authenticity** | **HMAC-SHA256 Cryptographic QR Signature** | Plaintext booking IDs | Prevents ticket forging/tampering; enables offline verification by venue scanners. |
| **Caching Layer** | **Redis Read-Through with Non-blocking `SCAN`** | Full database queries on every read | Substantially reduces database read pressure on hot query paths; uses non-blocking `SCAN` iteration to avoid Redis event-loop freezing. |
| **Password Security** | **bcrypt (salt rounds = 10)** | SHA-256 / MD5 | Adaptive work factor prevents GPU-accelerated rainbow table cracking. |
| **OTP Storage** | **SHA-256 Hashed OTP + 5-Attempt Limit** | Plaintext in database | Prevents database leak exploits; brute-force protection locks OTP after 5 consecutive failed attempts. |

---

## 📊 Empirical Benchmark Results (Phase 5)

> 📑 **Detailed Evaluation Report:** For in-depth analysis of naive LLM breaking points, architectural mitigations, and before-vs-after delta metrics, see the **[Concurrency Constraints & Optimization Delta Report](docs/CONCURRENCY_OPTIMIZATION_REPORT.md)**.

All benchmarks executed against live PostgreSQL 16 and Upstash Redis instances (`npm run benchmark`):

### 1. Flash Sale Concurrency (500 Concurrent Virtual Buyers $\rightarrow$ 100 Tickets)

#### A. Correctness & Invariant Verification (Zero Overselling)
- **Total Concurrent Buyers**: 500 VUs dispatched simultaneously
- **Total Available Inventory**: 100 Tickets
- **201 Created (Successful Bookings)**: **100**
- **409 Conflict (Sold Out / Insufficient)**: **400**
- **Server 5xx Errors**: **0**
- **Oversold Tickets**: **0 (Zero Overselling Verified)**
- **Database Invariant Check**:
  $$\text{totalCapacity} = \text{availableTickets} + \sum(\text{confirmedTickets}) \implies 100 = 0 + 100 \quad \text{✅ PASSED}$$

#### B. Performance & Latency Profile (500-VU Burst)
- **Throughput**: **121.19 req/sec**
- **Latency Distribution**:
  - $p_{50}$ (Median): `3148.43 ms`
  - $p_{95}$: `3660.38 ms`
  - $p_{99}$: `4125.12 ms`
- *Observation*: The atomic conditional update strictly prevented any data inconsistency, while tail latency increased as 500 simultaneous requests queued through the single-instance database connection pool.

### 2. Controlled Read Caching (`GET /api/events`)

> **Methodology**: Measured using the **Native TypeScript Benchmark Runner** (`npm run benchmark`), executing 100 sequential requests per condition against remote TLS-connected PostgreSQL and Upstash Redis. (For high-VU concurrent load testing, execute `k6 run benchmarks/read-cache.js`).

- **Direct PostgreSQL (Cache Miss)**: 1.14 RPS ($p_{50}: 608.9\text{ms}, p_{95}: 718.2\text{ms}$)
- **Redis Read-Through (Warm Hit)**: 3.39 RPS ($p_{50}: 305.4\text{ms}, p_{95}: 388.4\text{ms}$)
- **Measured Throughput Gain**: **+197%**
- **$p_{95}$ Latency Reduction**: **46% faster (718ms $\rightarrow$ 388ms)**

### 3. Concurrency Scaling & Latency Threshold Profile
- **Target Latency Threshold**: $p_{95} \le 500\text{ms}$
- **Concurrency Progression**:
  - **25 VUs**: 47.90 RPS ($p_{95}: 487.95\text{ms}$ — *within threshold*)
  - **50 VUs**: 77.35 RPS ($p_{95}: 602.23\text{ms}$ — *first stage crossing 500ms threshold*)
  - **100 VUs**: 126.26 RPS ($p_{95}: 723.54\text{ms}$)
  - **200 VUs**: 202.55 RPS ($p_{95}: 870.87\text{ms}$)
  - **300 VUs**: 281.41 RPS ($p_{95}: 866.87\text{ms}$)
- **Observed Error Rate**: **0% across all load stages**
- **Observed Bottleneck**: Latency increased substantially as concurrency increased. The benchmark establishes saturation behavior under multi-VU load, while the system degraded gracefully through request queuing rather than dropped connections.

---

## 🚀 Quickstart Guide (5-Minute Setup)

### Prerequisites
- **Node.js**: `v20.0.0` or higher
- **PostgreSQL**: `14+` (Local or Docker)
- **Redis**: `v6+` (Local or Upstash Redis URL)

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/adarshaldkar/event-booking-system-backend.git
cd event-booking-system-backend
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env` and fill in your credentials:
```bash
cp .env.example .env
```

### 3. Initialize Database & Seed Demo Data
```bash
# Push schema to PostgreSQL
npm run prisma:push

# Generate Prisma Client
npm run prisma:generate

# Seed initial Organizers, Customers, and Events
npm run db:seed
```

### 4. Start the Application & Background Worker

**Terminal 1 (Express API Server)**:
```bash
npm run dev
# Server starts on http://localhost:4000
# Swagger UI available at http://localhost:4000/docs/
```

**Terminal 2 (BullMQ Background Worker)**:
```bash
npm run dev:worker
# Worker connects to BullMQ and processes email/QR queues with concurrency 5
```

---

## 🛠️ Running Individual Services & Tools Cheatsheet

| Task / Service | Command | Description |
|---|---|---|
| **Express API Server Only** | `npm run dev` | Runs the API server with hot-reloading on `http://localhost:4000`. |
| **BullMQ Email Worker Only** | `npm run dev:worker` | Runs only the background worker processing email & QR queues. |
| **Prisma Studio (Visual DB GUI)** | `npx prisma studio` | Opens an interactive web GUI at `http://localhost:5555` to view and edit tables. |
| **High-Concurrency Benchmark** | `npm run benchmark` | Runs the 500-buyer flash sale concurrency test & cache comparison. |
| **Complete Automated Test Suite** | `npm test` | Runs all 62 Vitest unit, integration, and concurrency tests. |
| **Single Test Suite (e.g. Concurrency)** | `npx vitest tests/concurrency.test.ts` | Runs only the 50-buyer flash sale zero-overselling test. |
| **Single Test Suite (e.g. Auth & OTP)** | `npx vitest tests/auth.test.ts` | Runs only authentication, OTP hashing, and JWT tests. |
| **Single Test Suite (e.g. Bookings)** | `npx vitest tests/booking.test.ts` | Runs only booking, cancellation, and idempotency tests. |
| **Single Test Suite (e.g. Redis Cache)** | `npx vitest tests/cache.test.ts` | Runs only Redis read-through caching & invalidation tests. |
| **Single Test Suite (e.g. BullMQ Queue)** | `npx vitest tests/queue.test.ts` | Runs only BullMQ worker retry and notification log tests. |
| **Re-seed Initial Data** | `npm run db:seed` | Re-populates baseline Organizers, Customers, and Events. |
| **Compile Production Bundle** | `npm run build` | Compiles TypeScript into `dist/` (0 compilation errors). |
| **Start Production API Server** | `npm run start` | Runs compiled production API (`dist/index.js`). |
| **Start Production Worker Node** | `npm run start:worker` | Runs compiled production worker (`dist/workers/emailWorker.js`). |

---

## ☁️ Cloud Deployment Guide (Render / Railway)

### 1. Database (Cloud PostgreSQL)
- Create a free cloud PostgreSQL database on **[Neon.tech](https://neon.tech)**, **Supabase**, or **Render PostgreSQL**.
- Copy the connection string to `DATABASE_URL` (e.g. `postgresql://user:pass@ep-xyz.neon.tech/neondb?sslmode=require`).

### 2. Redis & BullMQ Bus
- Redis is already cloud-hosted on **Upstash Redis** (`rediss://default:...@enabled-bullfrog-287416.upstash.io:6379`). No local Redis configuration needed.

### 3. Deploy Web API on Render
- **Type**: Web Service (Node.js)
- **Build Command**: `npm install && npm run build && npx prisma db push && npm run db:seed`
- **Start Command**: `npm run start`

### 4. Deploy Background Worker on Render (Optional Separate Service)
- **Type**: Background Worker
- **Build Command**: `npm install && npm run build`
- **Start Command**: `npm run start:worker`

---

## 🔐 Environment Variables Reference

| Variable | Description | Example / Default |
|---|---|---|
| `PORT` | API Server Port | `4000` |
| `NODE_ENV` | Runtime Environment | `development` / `production` |
| `DATABASE_URL` | PostgreSQL Connection String | `postgresql://postgres:pass@localhost:5432/event_booking_db` |
| `REDIS_URL` | Redis Connection String | `redis://localhost:6379` or `rediss://default:...@upstash.io:6379` |
| `JWT_SECRET` | Secret key for signing JWT tokens | `super-secret-jwt-key-minimum-32-chars` |
| `JWT_EXPIRES_IN` | Access token expiration duration | `7d` |
| `QR_SIGNING_SECRET`| Secret key for HMAC-SHA256 QR signatures | `super-secret-qr-hmac-key-for-anti-forgery` |
| `RESEND_API_KEY` | Resend API key for real transactional email | `re_xxxxxxxxxxxx` |
| `EMAIL_FROM` | Sender address for outgoing emails | `EventHub <onboarding@resend.dev>` |
| `CACHE_ENABLED` | Global toggle for Redis read caching | `true` |
| `CACHE_TTL_SECONDS`| Cache expiration time in seconds | `300` |

---

## 📡 REST API Endpoints Catalog

### Authentication (`/api/auth`)
- `POST /api/auth/register` — Register a new account (`CUSTOMER` or `ORGANIZER`) and trigger OTP email.
- `POST /api/auth/verify-otp` — Verify 6-digit OTP, activate account, and receive JWT token.
- `POST /api/auth/resend-otp` — Request a fresh OTP with renewed TTL and reset attempts.
- `POST /api/auth/login` — Authenticate verified user and return JWT token.
- `GET /api/auth/me` — Retrieve current authenticated user profile (`Bearer <token>`).

### Event Management (`/api/events`)
- `POST /api/events` — Create a new event (**Organizer Only**).
- `GET /api/events` — Public event listing with search, category filtering, pagination, and Redis caching.
- `GET /api/events/:id` — Public event detail by ID with Redis read-through caching.
- `PUT /api/events/:id` — Update event details (**Organizer Owner Only**; triggers attendee broadcast on critical changes).
- `DELETE /api/events/:id` — Cancel event (**Organizer Owner Only**; soft-cancels event).

### Booking Engine (`/api/bookings`)
- `POST /api/bookings` — Book tickets (**Customer Only**; supports `Idempotency-Key` and atomic concurrency).
- `GET /api/bookings` — List customer's booking history (**Customer Only**).
- `GET /api/bookings/:id` — View specific booking details (**Customer Owner Only**).
- `POST /api/bookings/:id/cancel` — Cancel booking and restore ticket inventory (**Customer Owner Only**).

### Health & Documentation
- `GET /health` — Service health check with live PostgreSQL & Redis ping status.
- `GET /docs` — Interactive Swagger OpenAPI 3.0 UI.
- `GET /api-docs.json` — Raw OpenAPI 3.0 JSON specification.

---

## 🧪 Automated Testing & Benchmarking

### 1. Run Complete Automated Test Suite (Vitest)
Runs all 62 unit, integration, RBAC, HMAC, BullMQ, and concurrency tests:
```bash
npm test
```

### 2. Run High-Concurrency Benchmark Suite
Simulates 500 concurrent virtual buyers competing for 100 tickets, measures Redis caching deltas, and profiles saturation:
```bash
npm run benchmark
```

### 3. Run k6 Concurrency Benchmarks
```bash
# Flash sale test (500 VUs competing for 100 tickets)
k6 run benchmarks/flash-sale.js

# Read caching throughput test
k6 run benchmarks/read-cache.js

# Progressive breaking point stress test
k6 run benchmarks/breaking-point.js
```

---

## 📖 Swagger OpenAPI & Postman Collection

- **Interactive Swagger UI**: Navigate to `http://localhost:4000/docs/` when the server is running.
- **Postman Collection v2.1**: Import [`docs/Event_Booking_System.postman_collection.json`](docs/Event_Booking_System.postman_collection.json) directly into Postman. Includes pre-configured environment variables, request bodies, and auth tokens.

---

## 🎥 5-Minute Video Demonstration Script

| Timestamp | Section | Key Demonstration Points |
|---|---|---|
| **0:00 – 0:40** | **Architecture Overview** | Walk through Express, PostgreSQL, Upstash Redis, BullMQ Worker, and Resend integration. |
| **0:40 – 1:20** | **Authentication & RBAC** | Demonstrate registration, hashed OTP verification, JWT generation, and Role enforcement (`ORGANIZER` vs `CUSTOMER`). |
| **1:20 – 2:20** | **Atomic Booking Engine** | Showcase `POST /api/bookings`, `Idempotency-Key` replay deduplication, and atomic ticket decrement. |
| **2:20 – 3:20** | **Asynchronous Queue & QR** | Demonstrate BullMQ worker processing, HMAC-signed QR e-ticket generation, and real Resend email delivery. |
| **3:20 – 4:10** | **Broadcast & Redis Caching** | Show event critical field updates notifying attendees, and demonstrate Redis cache hits vs misses on `GET /api/events`. |
| **4:10 – 5:00** | **Live Concurrency Benchmark** | Run `npm run benchmark` live to prove 500 concurrent buyers $\rightarrow$ exactly 100 tickets sold and **0 oversold**. |

---

## 👨‍💻 Author & License

Developed for the **Cactro High-Concurrency Backend Engineering Assessment**.  
Licensed under the **MIT License**.
