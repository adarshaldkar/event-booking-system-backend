# Phase 5: Performance Benchmarking, k6 Concurrency Tests & Production Readiness

## 1. Overview & Objectives

Phase 5 is the final benchmarking, empirical measurement, and documentation phase:
- **High-Concurrency Flash Sale Correctness**: Tests 500 pre-authenticated concurrent virtual users sending **exactly 500 discrete booking iterations** against a 100-ticket inventory to empirically verify zero overselling ($100 \text{ successes}, 400 \text{ expected } 409\text{s}$).
- **Before vs After Redis Caching Measurement**: Measures actual throughput (RPS) and latency distributions ($p_{50}, p_{95}, p_{99}$) on `GET /api/events` comparing direct PostgreSQL reads vs Redis read-through caching.
- **Breaking-Point Stress Analysis**: Incrementally ramps up traffic (100 -> 2,000+ VUs) to discover the system saturation threshold, identify the primary bottleneck (Database connection pool, CPU, or I/O), and observe recovery duration.
- **Production Deliverables**: Clean root `README.md`, Postman Collection, interactive Swagger UI, and structured Loom video demonstration.

---

## 2. Benchmark Scenarios & Execution Protocol

### Benchmark 1: Flash Sale Concurrency Correctness (`benchmarks/flash-sale.js`)
- **Protocol**: Pre-seed 500 verified customer accounts with pre-generated JWT tokens.
- **Executor Configuration**:
  ```javascript
  export const options = {
    scenarios: {
      flash_sale: {
        executor: 'shared-iterations',
        vus: 500,
        iterations: 500,
        maxDuration: '60s',
      },
    },
  };
  ```
- **Target Endpoint**: `POST /api/bookings`
- **Verification Criteria**:
  - `http_req_status_201` = Exactly **100**
  - `http_req_status_409` = Exactly **400** (Expected business inventory conflicts)
  - `http_req_failed` (5xx server errors) = **0%**
  - Database Invariant Verification:
    $$\text{totalCapacity} = \text{availableTickets} + \sum(\text{confirmedTickets})$$
    $$100 = 0 + 100$$
  - **Overselling**: **0 tickets**

---

### Benchmark 2: Controlled Before vs After Redis Caching (`benchmarks/read-cache.js`)
- **Protocol**: Measure identical load profiles (200 VUs for 60s) under two controlled environments using the `CACHE_ENABLED` toggle.
- **Metrics Recorded (Empirical Measurement)**:
  - **Baseline (PostgreSQL Direct, `CACHE_ENABLED=false`)**:
    - Requests / Second (RPS): `[MEASURED_VALUE]`
    - $p_{50}$ Latency: `[MEASURED_VALUE]`
    - $p_{95}$ Latency: `[MEASURED_VALUE]`
    - $p_{99}$ Latency: `[MEASURED_VALUE]`
  - **Optimized (Redis Read-Through, `CACHE_ENABLED=true`)**:
    - Requests / Second (RPS): `[MEASURED_VALUE]`
    - $p_{50}$ Latency: `[MEASURED_VALUE]`
    - $p_{95}$ Latency: `[MEASURED_VALUE]`
    - $p_{99}$ Latency: `[MEASURED_VALUE]`
  - **Measured Delta**: Calculated percentage improvements in throughput and latency.

---

### Benchmark 3: Breaking-Point Analysis (`benchmarks/breaking-point.js`)
- **Definition of Breaking Point**: The first sustained load stage where $p_{95}$ latency exceeds 500ms or infrastructure-level errors/timeouts occur.
- **Ramp-Up Profile**:
  - Stage 1: 0 to 200 VUs over 30s
  - Stage 2: 200 to 500 VUs over 45s
  - Stage 3: 500 to 1,000 VUs over 60s
  - Stage 4: 1,000 to 2,000+ VUs over 60s
  - Stage 5: Ramp down to 0 VUs over 30s
- **Metrics & Observations Captured**:
  - Saturation RPS and VU threshold.
  - Bottleneck root cause analysis (Database connection pool vs Event loop saturation vs Network I/O).
  - Recovery duration: Time (seconds) required for $p_{95}$ latency to return below threshold after traffic subsides.

---

## 3. Production Documentation & Deliverables

### 1. Root `README.md`
Structured for technical evaluators:
- High-level overview & core architectural patterns
- Tech stack choices and engineering tradeoffs (PostgreSQL vs Redis, BullMQ vs Kafka)
- 5-minute setup instructions
- Environment variables reference
- API endpoints catalog
- Automated test instructions (`npm test`)
- Benchmark reproduction guide

### 2. Postman Collection v2.1
- [docs/Event_Booking_System.postman_collection.json](file:///c:/Users/shrut/Desktop/castro/docs/Event_Booking_System.postman_collection.json)

### 3. Interactive Swagger Documentation
- OpenAPI 3.0 specification served at `http://localhost:4000/docs/`.

### 4. Loom Demonstration Script (5-Minute Plan)
- **0:00–0:40**: System Architecture (Express, PostgreSQL, Redis, BullMQ, Worker, Resend).
- **0:40–1:20**: Authentication, Hashed OTP email delivery, and RBAC (`CUSTOMER` vs `ORGANIZER`).
- **1:20–2:20**: Atomic Booking Engine (PostgreSQL conditional updates, zero overselling, Idempotency-Key).
- **2:20–3:20**: Asynchronous Background Processing (BullMQ worker, real Resend email, HMAC-signed QR code e-ticket).
- **3:20–4:10**: Batched Event Update Broadcast & Redis Read-Through Caching.
- **4:10–5:00**: Live Benchmark Evidence (Actual k6 metrics, zero overselling proof, invariant validation).
