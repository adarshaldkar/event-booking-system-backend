# Phase 6: Observability, Interactive Documentation & Production Deployment Readiness

## 1. Overview & Architecture

Phase 6 focuses on production hardening, runtime observability, standardized documentation, and separate process architecture:
- **Comprehensive Observability**: Deep health check endpoint (`GET /health`) actively probing PostgreSQL, Redis, and BullMQ queue connectivity.
- **Interactive Documentation**: OpenAPI 3.0 specification served with Swagger UI at `GET /docs` and raw JSON at `GET /api-docs.json`.
- **Reliable Graceful Shutdown**: Ordered teardown sequence draining active in-flight HTTP requests, closing BullMQ queue connections, disconnecting Prisma, and quitting Redis cleanly within a hard 10-second deadline.
- **Separated Runtime Processes**: Express API (`npm run start`) and BullMQ Background Worker (`npm run start:worker`) run as distinct processes sharing the same PostgreSQL and Redis instances.

---

## 2. Deliverables & Technical Specifications

### 2.1 Health Check Endpoint (`GET /health`)

#### Behavioral Rules:
1. **Critical Dependencies (PostgreSQL or Redis DOWN)** $\rightarrow$ Responds with **`503 Service Unavailable`**.
2. **Worker Queue Degraded/Unavailable** $\rightarrow$ API responds with **`200 OK`** (`status: "degraded"`, `workerQueue: "unavailable"`).
   - *Rationale*: A transient worker outage does not invalidate the authoritative PostgreSQL booking engine. Bookings continue to commit safely while notification logs record `PENDING`.
3. **All Systems Healthy** $\rightarrow$ Responds with **`200 OK`** (`status: "healthy"`).

#### Sample Response:
```json
{
  "success": true,
  "status": "healthy",
  "timestamp": "2026-09-20T15:23:00.000Z",
  "uptime": 184.22,
  "services": {
    "database": {
      "status": "connected",
      "responseTimeMs": 8.42
    },
    "redis": {
      "status": "connected",
      "responseTimeMs": 3.15
    },
    "workerQueue": {
      "status": "ready"
    }
  }
}
```

---

### 2.2 Interactive API Documentation & Postman Collection

- **Swagger UI**: Accessible at `http://localhost:4000/docs/`.
- **Raw OpenAPI 3.0 Specification**: Served at `http://localhost:4000/api-docs.json`.
- **Postman Collection v2.1**: Maintained at [`docs/Event_Booking_System.postman_collection.json`](file:///c:/Users/shrut/Desktop/castro/docs/Event_Booking_System.postman_collection.json) covering all endpoints, variables, and authentication tokens.

---

### 2.3 Ordered Graceful Shutdown Lifecycle

```text
SIGTERM / SIGINT Signal Received
               ↓
1. Stop accepting NEW inbound connections (server.close())
               ↓
2. Wait for active in-flight HTTP requests to finish
               ↓
3. Close BullMQ queue & worker connections (notificationQueue.close() / emailWorker.close())
               ↓
4. Disconnect Prisma PostgreSQL connection pool (prisma.$disconnect())
               ↓
5. Quit Redis connection (redis.quit())
               ↓
6. Exit process cleanly (code 0)
   [Hard 10-Second Timeout Fallback]
```

---

### 2.4 Multi-Process Cloud Architecture

```text
                                  ┌─────────────────────────────┐
                                  │      Cloud Load Balancer    │
                                  │      (HTTPS / TLS Edge)     │
                                  └──────────────┬──────────────┘
                                                 │
                                                 ▼
                        ┌─────────────────────────────────────────────────┐
                        │             Service 1: Express Web API          │
                        │             - Port 4000 / Entry Point           │
                        │             - Auth, RBAC, Event CRUD, Bookings  │
                        │             - Swagger UI & Health Probes        │
                        └──────────────┬───────────────────┬──────────────┘
                                       │                   │
                                       │                   │
             ┌─────────────────────────┴────┐         ┌────┴──────────────────────────┐
             │ Shared Cloud Infrastructure  │         │ Service 2: BullMQ Worker      │
             │                              │         │                               │
             │ 1. Managed PostgreSQL 16     │         │ Background Worker Node        │
             │    - ACID Transactions       │         │ - Consumes notification-queue │
             │    - Row-Level Locking       │         │ - Concurrency: 5              │
             │    - SSL Connection Pooling  │         │ - Exponential Retry Backoff   │
             │                              │         │                               │
             │ 2. Upstash Redis (TLS)       │         └──────────────┬────────────────┘
             │    - Read-Through Caching    │                        │
             │    - BullMQ Message Bus      │                        ▼
             └──────────────────────────────┘                 ┌──────────────┐
                                                              │  Resend API  │
                                                              └──────────────┘
```

#### Shared Responsibilities Delineation:
- **Shared Service Utilities**: `qr.service.ts` generates signed HMAC-SHA256 QR code data URLs on demand.
- **Worker Responsibilities**: Asynchronous background email delivery (`AUTH_OTP`, `BOOKING_CONFIRMATION` with attached QR e-ticket, and `EVENT_UPDATE_BROADCAST`).

---

### 2.5 Fail-Fast Environment Validation

At startup, `src/config/env.ts` parses and validates all required variables using a strict Zod schema before any service initializes:
- `DATABASE_URL`
- `REDIS_URL`
- `JWT_SECRET` (Minimum 32 characters)
- `QR_SIGNING_SECRET` (Minimum 16 characters)
- `RESEND_API_KEY`
- `EMAIL_FROM`

Missing or malformed variables halt the process immediately with descriptive validation errors.

---

## 3. Production Deployment Commands

```bash
# 1. Compile TypeScript bundle
npm run build

# 2. Run Database Migrations
npm run prisma:push

# 3. Seed Initial Verification Accounts
npm run db:seed

# 4. Start Production Web API (Process 1)
npm run start

# 5. Start Production BullMQ Worker (Process 2)
npm run start:worker
```

---

## 4. Phase 6 Acceptance & Verification Checklist

- [x] `/health` checks live PostgreSQL connectivity with response time.
- [x] `/health` checks live Redis connectivity with response time.
- [x] `/health` reports worker/queue status appropriately.
- [x] Returns `503 Service Unavailable` when critical dependencies (PostgreSQL/Redis) fail.
- [x] Swagger UI served at `/docs/`.
- [x] Raw OpenAPI 3.0 JSON served at `/api-docs.json`.
- [x] Postman Collection v2.1 validated and exported.
- [x] `npm run build` succeeds with **0 TypeScript errors**.
- [x] Production API starts successfully (`npm run start`).
- [x] Production Worker starts successfully (`npm run start:worker`).
- [x] API and Worker run as separate runtime processes communicating over shared Redis/PostgreSQL.
- [x] Graceful shutdown sequence handles `SIGINT` / `SIGTERM` with 10-second hard fallback.
- [x] Fail-fast environment variable validation via Zod.
- [x] **All 62 automated tests pass** (`npm test`).
