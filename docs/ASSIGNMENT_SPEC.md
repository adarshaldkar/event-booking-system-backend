# Event Booking System — Project Specification & Action Plan

---

## 1. Overview & Objectives

- **Assessment Window:** 9/20/2026, 9:00:00 AM – 5:00:00 PM (8-hour sprint)
- **Objective:** Design, implement, benchmark, optimize, and deploy a high-concurrency Backend REST API for an **Event Booking System** with Role-Based Access Control (RBAC), asynchronous background worker queues with real external notifications, and stress-tested performance optimization.
- **Submission Form:** [https://forms.gle/ER387znmXfN4MvzdA](https://forms.gle/ER387znmXfN4MvzdA)

---

## 2. Core Functional Requirements

### 2.1 Role-Based Access Control (RBAC) & Authentication
- **User Roles:**
  1. `Event Organizer`: Create, update, view, and delete/cancel their own events; view ticket sales and attendee lists.
  2. `Customer`: Browse public active events, view event details/availability, book tickets, view their own bookings, cancel bookings.
- **Authentication Mechanism:**
  - Secure JWT authentication (`Authorization: Bearer <token>`)
  - Password hashing with `bcrypt`
  - Middleware for role validation (`verifyToken`, `requireRole(['ORGANIZER'])`, `requireRole(['CUSTOMER'])`)

### 2.2 Event Management (Organizers)
- `POST /api/events`: Create a new event (Title, Description, Category, Location/Online Link, Date & Time, Total Ticket Capacity, Available Tickets, Ticket Price).
- `GET /api/events`: List events (Public, supports pagination, filtering by category/date, search).
- `GET /api/events/:id`: Retrieve single event details + live ticket availability.
- `PUT /api/events/:id`: Update event details (Triggering Background Task 2 when date, location, or schedule changes).
- `DELETE /api/events/:id`: Cancel/Delete event.
- `GET /api/events/:id/attendees`: View list of customers who booked tickets for this event.

### 2.3 Ticket Booking Engine (Customers)
- `POST /api/bookings`: Book $N$ tickets for an event.
  - **Critical Concurrency Handling:** Must prevent overselling/race conditions when hundreds of users book the last few tickets concurrently.
  - Utilizes Atomic DB transactions (`SELECT ... FOR UPDATE` or atomic decrement with condition `available_tickets >= count`).
  - Idempotency support to prevent duplicate charge/booking on network retries.
- `GET /api/bookings/my`: List current customer's bookings.
- `GET /api/bookings/:id`: View booking details & QR/Booking reference code.
- `POST /api/bookings/:id/cancel`: Cancel booking and restore ticket inventory atomically.

---

## 3. Background Tasks & Async Processing

> **Mandatory Rule:** Console logs or print statements are **NOT** sufficient. Real email delivery via SMTP or email API (e.g. Resend, Nodemailer, SendGrid, Postmark) is required.

### Background Task 1: Booking Confirmation Email
- **Trigger:** Immediate upon successful ticket booking transaction.
- **Queue/Worker:** Enqueue job to Redis (BullMQ / Celery / custom worker).
- **Payload:** `{ bookingId, customerEmail, customerName, eventTitle, eventDate, ticketCount, totalAmount, bookingRef }`
- **Action:** Worker formats an HTML ticket confirmation email and delivers it to the customer via SMTP / Resend API.
- **Resilience:** Automatic retry with exponential backoff (up to 3 attempts) and failure logging.

### Background Task 2: Event Update Broadcast Notification
- **Trigger:** When an organizer updates critical details of an existing event (`PUT /api/events/:id`).
- **Queue/Worker:** Enqueue a broadcast job to background queue.
- **Action:**
  - Queries all distinct customers who have active bookings for that event.
  - Fans out email notifications (in batches to avoid rate limits) informing them of the update (e.g., date change, venue update).
- **Audit:** Records notification dispatch logs in database.

---

## 4. Performance Stress Testing & Optimization (The Core Differentiator)

### 4.1 Stress Test Scenario
- Simulate high-concurrency ticket booking flash sale (e.g., 100 tickets available, 500 to 2,000 concurrent virtual users competing simultaneously).
- Tool: `k6`, `autocannon`, or `artillery`.

### 4.2 Benchmark Stages (Mandatory for Video Demo)
1. **Stage 1 — Baseline / Naive Implementation:**
   - Standard read-then-write without atomic locks or indexing.
   - Synchronous email dispatch inside the HTTP request cycle.
   - **Breaking Point Analysis:** Measure dropped requests, race conditions (overselling), and high latency (>5s or timeouts) at $N$ concurrent users.
2. **Stage 2 — Architectural Optimizations:**
   - **Atomic Concurrency Control:** PostgreSQL `SELECT FOR UPDATE` or atomic conditional update `UPDATE events SET available = available - qty WHERE id = $1 AND available >= qty`.
   - **Asynchronous Decoupling:** Offloading email notifications to Redis-backed queue (`BullMQ`) so HTTP response returns in <30ms.
   - **Read Caching:** Redis caching for popular event listings with invalidation on update.
   - **Connection Pooling & DB Indexing:** Indexing `events(date, category)`, `bookings(user_id, event_id)`.
   - **Rate Limiting:** Protect endpoints against DDoS using Redis token bucket / sliding window limiter.
3. **Stage 3 — Optimized System Benchmark:**
   - Measure new throughput (RPS), p95/p99 response latency, and 0% race condition / oversell rate.
   - Quantify the **Delta / Improvement** (e.g., $10\times$ concurrency increase, latency reduced from 2500ms to 45ms).

---

## 5. Video Demo Requirements (Mandatory Checklist)

- **Recording Tool:** Loom or screen recorder + camera.
- **Duration:** 2 to 5 minutes (Sweet spot: 3–4 minutes).
- **Face & Voice:** Face must be visible (webcam bubble), speaking in clear English.
- **Mandatory 3-Part Structure:**
  1. **Show Initial Breaking Point:** Demonstrate the unoptimized setup breaking under concurrency (show terminal/k6 output with failed requests/overselling/high latency).
  2. **Explain the Optimization Strategy:** Explain how you solved race conditions, offloaded I/O with queues, added indexing, and tuned connection pooling.
  3. **Show the Optimized Benchmark & Live API Demo:** Run the stress test again demonstrating high throughput and 0 errors, followed by a live API call on the deployed cloud URL triggering a real email.

---

## 6. Submission Details & Form Breakdown

| Field | Detail / Strategy |
|---|---|
| **Email** | User's email |
| **Test ID** | Assigned test ID (e.g. 904 or provided ID) |
| **Did you use AI?** | `Yes` (with transparent explanation of architectural design and review) |
| **Approach Description** | Full breakdown of architecture, concurrency protection, queue system, benchmarks, and time management |
| **#1 Challenge** | Concurrency race condition resolution under flash-sale load & worker queue reliability |
| **Time Breakdown** | Architecture & DB Schema (45m), Core APIs & RBAC (90m), Async Queue & Real Email (60m), Stress Testing & Optimization (90m), Deployment & Cloud DB (45m), Demo Video & README (60m) |
| **Code Link** | Public GitHub repository URL |
| **Deployed Link** | Live Render / Railway / Vercel API URL |
| **Video Demo Link** | Loom video URL |
| **Career Info** | Resume, CTC, Notice Period, Years of Experience, Tech Stack, Roles, City |

---

## 7. Recommended Production Tech Stack

- **Runtime & Language:** Node.js (TypeScript / Express.js or Fastify)
- **Database:** PostgreSQL (via Prisma ORM / raw SQL for transaction control) or Supabase / Neon
- **In-Memory Cache & Queue:** Redis (Upstash / Redis Cloud) + BullMQ
- **Email Delivery:** Resend API / Nodemailer SMTP
- **Stress Testing:** `autocannon` / `k6` scripts
- **Deployment:** Render / Railway / Fly.io (Backend API + Worker process) + Supabase/Neon (PostgreSQL) + Upstash (Redis)
- **API Documentation:** Swagger / OpenAPI (`/api-docs`) + Postman Collection

---

## 8. Step-by-Step Implementation Roadmap

- [ ] **Phase 1: Project Setup & Database Schema**
  - TypeScript, Express, Prisma / PostgreSQL, Docker compose for local dev.
  - Models: `User`, `Event`, `Booking`, `NotificationLog`.
- [ ] **Phase 2: Auth & Role-Based Access Control**
  - JWT register/login for Organizers and Customers.
  - Protected routes & middleware.
- [ ] **Phase 3: Event & Concurrency-Safe Booking Engine**
  - Event CRUD with capacity validation.
  - Booking endpoint with ACID transaction & atomic inventory decrement.
- [ ] **Phase 4: Real Asynchronous Notification Queue**
  - Redis + BullMQ worker service.
  - Booking confirmation email job.
  - Event update broadcast notification job.
- [ ] **Phase 5: Performance Benchmarking & Stress Testing Scripts**
  - `stress-test.js` script with `autocannon` / `k6`.
  - Baseline vs Optimized benchmark data recording.
- [ ] **Phase 6: Cloud Deployment & Public Access**
  - Live deployment of API, Database, and Worker.
- [ ] **Phase 7: Comprehensive README.md & Postman Collection**
  - Architectural decisions, setup guide, stress test metrics, and API docs.
- [ ] **Phase 8: Demo Recording & Submission Prep**
  - Loom demo recording meeting all mandatory requirements.
