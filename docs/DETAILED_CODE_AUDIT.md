# Event Booking System Backend — Detailed Code Audit

**Audit target:** `event-booking-system-backend.zip`  
**Audit date:** 20 September 2026  
**Scope:** Full repository supplied in the ZIP: application source, Prisma schema/seed, routes/controllers/services/middleware, BullMQ worker/queue, Redis cache, tests, k6/native benchmarks, Swagger, Postman collection, Docker configuration, README and phase documentation.

## Executive verdict

**Architecture quality: Strong. Submission readiness: NOT YET FINAL.**

The project demonstrates the right core architecture for the assessment: PostgreSQL is the inventory source of truth, booking inventory is decremented with an atomic conditional SQL update, booking creation is transactional, RBAC/ownership are enforced, Redis is used as a cache rather than the booking authority, BullMQ decouples email delivery, QR payloads are HMAC-signed, and the project contains a substantial automated test suite.

However, the ZIP contains several **real implementation/documentation gaps** that should be fixed before final submission. The most important are:

1. **Global idempotency keys are not scoped to the customer and are not bound to the original request payload.** A reused key can return another customer's booking and a different event/quantity can silently replay the old booking.
2. **Past events can still be booked after their `eventDate` passes if their status remains `UPCOMING`.** The booking SQL checks status but not `eventDate > NOW()`.
3. **Email enqueue failures are swallowed, with no outbox/reconciliation mechanism in the supplied code.** A committed booking can therefore lose its confirmation email permanently.
4. **Email delivery has a simulated fallback.** If neither Resend nor SMTP is configured, the code returns a fake `simulated-msg-*` success instead of failing. This conflicts with the assessment's requirement for real email delivery.
5. **`NotificationLog` is created separately for every retry attempt rather than maintaining one notification record across attempts.** Earlier attempt records can remain `PENDING` while the third record becomes `FAILED`.
6. **The ZIP contains an empty `prisma/migrations` directory even though the schema/docs claim database-level CHECK constraints are enforced through migrations.** The supplied artifact therefore does not contain those migrations, and the actual database constraints cannot be verified from the ZIP.
7. **The QR signing implementation uses `JWT_SECRET`, while README/Phase 6 document a separate `QR_SIGNING_SECRET`.** `QR_SIGNING_SECRET` is not validated or used by the supplied code.
8. **The k6 benchmark scripts are not directly reproducible as documented without environment variables, and the read-cache/breaking-point k6 thresholds do not match the empirical native-runner results or the stated benchmark methodology.**
9. **Swagger documentation is incomplete/mismatched with the actual API**, especially health response structure, resend OTP, booking detail, and several request/response schemas.
10. **The README contains several claims stronger than the evidence in the ZIP**, including "sub-millisecond idempotency", ">95%" DB read-pressure reduction, "mathematically guaranteed" system-wide zero overselling, and a 300–800 ms email latency claim without corresponding measured evidence.

These are fixable. The core booking/concurrency design is still the strongest part of the project.

---

# 1. Severity scale

| Severity | Meaning |
|---|---|
| **CRITICAL** | Security/correctness issue that can invalidate a core assessment requirement or expose another user's data. Fix before submission. |
| **HIGH** | Significant correctness, reliability, deployment, or requirement mismatch. Fix before final submission. |
| **MEDIUM** | Important robustness/documentation/performance issue. Fix if time permits; preferably before submission. |
| **LOW** | Quality/cleanup issue with limited runtime impact. |
| **INFO** | Positive design observation or non-blocking note. |

---

# 2. Repository-level assessment

## 2.1 Structure — PASS

The repository is logically separated:

```text
src/
  config/
  controllers/
  jobs/
  middleware/
  routes/
  services/
  utils/
  validators/
  workers/
prisma/
benchmarks/
tests/
docs/
```

This is a good separation for an 8-hour backend assessment. Business logic is predominantly in services rather than controllers.

## 2.2 Technology choice — PASS

The implementation uses:

- Node.js / TypeScript
- Express
- PostgreSQL
- Prisma
- Redis / ioredis
- BullMQ
- Resend and Nodemailer
- bcryptjs
- JWT
- Zod
- QRCode
- Helmet
- express-rate-limit
- Vitest / Supertest
- k6 scripts

This matches the intended assessment architecture closely.

## 2.3 No frontend overbuild — PASS

The repository stays focused on the requested backend/API, which is appropriate for the assessment.

---

# 3. Database / Prisma audit

## 3.1 Schema design — PASS

`prisma/schema.prisma` has appropriate entities:

- `User`
- `Event`
- `Booking`
- `NotificationLog`

The enums are also sensible:

- `Role`
- `EventStatus`
- `BookingStatus`
- `NotificationStatus`
- `NotificationType`

The relations use restrictive deletes for historical booking relationships, which protects booking history.

## 3.2 Money type — PASS

`Event.ticketPrice` and `Booking.totalAmount` use:

```text
Decimal @db.Decimal(10, 2)
```

This is preferable to floating-point money arithmetic.

## 3.3 Inventory fields — PASS WITH HARDENING GAP

The schema stores both:

```text
 totalCapacity
 availableTickets
```

and the service initializes:

```text
availableTickets = totalCapacity
```

Good.

### ⚠️ Database constraints are not verifiable from the ZIP

`schema.prisma` comments say:

> DB-level constraints enforced via migration raw SQL (CHECK constraints)

but the ZIP contains an empty `prisma/migrations/` directory and no SQL migration files.

**Finding: HIGH**

The artifact does not contain the claimed migration implementation. Therefore a reviewer cannot verify that PostgreSQL itself enforces:

```text
availableTickets >= 0
totalCapacity > 0
ticketPrice >= 0
```

### Recommended fix

Commit the actual migration files or explicitly document that the current artifact uses `prisma db push` and application validation only. For the assessment, actual migration SQL is preferable.

---

# 4. CRITICAL — Idempotency design flaw

## Location

`src/services/booking.service.ts` lines 18–33 and 123–137  
`prisma/schema.prisma` Booking model

## Current design

The schema has:

```text
idempotencyKey String? @unique
```

That means the key is globally unique across **all customers and all events**.

The replay lookup is:

```text
where: { idempotencyKey }
```

There is no check that the existing booking belongs to the current `customerId` or that the original request had the same event/quantity.

## Why this matters

Imagine Customer A creates:

```text
Idempotency-Key: ABC123
Event: Event-A
Quantity: 2
```

Later Customer B sends:

```text
Idempotency-Key: ABC123
Event: Event-B
Quantity: 5
```

The service can find Customer A's booking and return it as:

```text
isReplayed: true
```

That is a **cross-customer data exposure** and a semantic idempotency collision.

Even for the same customer, reusing a key with a different event or quantity silently returns the old request's booking rather than rejecting the conflicting payload.

## Severity

**CRITICAL**

## Recommended design

At minimum scope the key to the customer:

```text
@@unique([customerId, idempotencyKey])
```

and query:

```text
where: {
  customerId,
  idempotencyKey
}
```

Even better, persist a request fingerprint such as:

```text
hash(eventId + quantity)
```

Then:

```text
same customer + same key + same payload → replay
same customer + same key + different payload → 409 IDEMPOTENCY_KEY_REUSE
```

This is the single most important correctness fix I found.

---

# 5. HIGH — Past events can still be booked

## Location

`src/services/booking.service.ts` lines 48–54

Current SQL:

```sql
UPDATE "events"
SET "availableTickets" = "availableTickets" - $quantity
WHERE "id" = $eventId
  AND "availableTickets" >= $quantity
  AND "status" = 'UPCOMING'
RETURNING ...
```

The service checks `eventDate <= now` only **after the UPDATE returns zero rows**.

## Problem

Suppose:

```text
status = UPCOMING
availableTickets = 20
eventDate = yesterday
```

The UPDATE succeeds because status is still `UPCOMING` and inventory is available.

The date check is never reached.

Therefore a stale `UPCOMING` event can accept bookings after its event date.

## Recommended fix

Make the date condition part of the atomic booking predicate:

```sql
AND "eventDate" > NOW()
```

Then the business-reason lookup can distinguish the reason after the update fails.

## Severity

**HIGH**

---

# 6. Booking concurrency design — PASS

## Location

`src/services/booking.service.ts`

The central design is strong:

```sql
UPDATE events
SET availableTickets = availableTickets - quantity
WHERE id = eventId
  AND availableTickets >= quantity
  AND status = 'UPCOMING'
RETURNING ...
```

followed by creation of the booking in the same Prisma transaction.

This is the correct general pattern for aggregate inventory.

### Why it is strong

The database is the authority for the inventory condition. The application does not perform a separate:

```text
SELECT availableTickets
→ if enough
→ UPDATE
```

sequence.

That removes the classic read-modify-write overselling race.

## Cancellation — PASS

The cancellation uses:

```sql
UPDATE bookings
SET status = 'CANCELLED'
WHERE id = $bookingId
  AND customerId = $customerId
  AND status = 'CONFIRMED'
RETURNING ...
```

and then restocks inventory in the same transaction.

This is a good concurrency-safe state transition.

---

# 7. HIGH — Email enqueue reliability / missing outbox

## Locations

`src/services/booking.service.ts` lines 113–118  
`src/services/auth.service.ts` lines 41–48 and 167–174  
`src/jobs/notificationQueue.ts` lines 66–83 and 88–103 and 108–133

The pattern is effectively:

```text
DB transaction commits
        ↓
try to enqueue BullMQ job
        ↓
catch error
        ↓
log error
        ↓
continue
```

The enqueue helper itself also catches the error and does not rethrow it.

## Consequence

This can happen:

```text
Booking transaction → COMMITTED
Redis/BullMQ enqueue → FAILS
HTTP response → 201
Email → never queued
```

There is no reconciliation worker, outbox table, or retry mechanism for a failed enqueue in the supplied source.

The same problem exists for OTP delivery and event-update broadcast jobs.

## Severity

**HIGH**

## Recommended fix

For this assessment, the cleanest robust solution is a transactional outbox:

```text
DB transaction:
  booking
  notification/outbox record
        ↓
separate dispatcher
        ↓
BullMQ
```

If time is limited, at minimum make enqueue failure observable and implement a periodic reconciliation process that scans `PENDING` notification/outbox records and requeues them.

Do not claim that reconciliation exists unless it is actually implemented.

---

# 8. HIGH — Real-email requirement can be bypassed by simulated fallback

## Location

`src/services/email.service.ts` lines 246–268

The code has:

```text
if resendClient → send real email
else if smtpTransporter → send real SMTP email
else → simulated-msg-${Date.now()}
```

That means the application can report successful email delivery without any real provider configured.

The assessment explicitly requires real SMTP/API delivery and rejects console/simulated delivery.

## Recommended fix

Remove the simulated success branch.

Instead:

```text
No configured provider
        ↓
throw configuration error
        ↓
BullMQ retries
        ↓
NotificationLog = FAILED after final retry
```

Also make environment validation conditional:

```text
EMAIL_PROVIDER=resend → RESEND_API_KEY required
EMAIL_PROVIDER=smtp   → SMTP_HOST/USER/PASS required
```

## Severity

**HIGH**

---

# 9. HIGH — NotificationLog retry model is not one-log-per-notification

## Location

`src/services/email.service.ts` lines 215–300

Every worker attempt calls `deliverWithLogging()`, which creates a new `NotificationLog`:

```text
Attempt 1 → Log A PENDING → fail → Log A remains PENDING
Attempt 2 → Log B PENDING → fail → Log B remains PENDING
Attempt 3 → Log C PENDING → fail → Log C FAILED
```

This does not model a single notification moving through:

```text
PENDING → PENDING → FAILED
```

Instead, it creates three separate notification records.

## Consequences

- stale PENDING rows remain forever
- attempts are fragmented across records
- reconciliation becomes harder
- audit history is ambiguous

## Recommended fix

Create one NotificationLog before queueing or on first processing, then update that same record on every attempt.

Store:

```text
notificationId
attempts
lastError
status
providerMessageId
sentAt
```

and have the BullMQ job carry the notification ID.

## Severity

**HIGH**

---

# 10. HIGH — Environment configuration and QR signing secret mismatch

## Code

`src/config/env.ts` validates:

- DATABASE_URL
- REDIS_URL
- JWT_SECRET
- email variables

It does **not** validate `QR_SIGNING_SECRET`.

## QR implementation

`src/services/qr.service.ts` uses:

```text
crypto.createHmac('sha256', env.JWT_SECRET)
```

## Documentation

README and Phase 6 document:

```text
QR_SIGNING_SECRET
```

as a separate environment variable.

## Problem

The documented architecture and actual implementation disagree.

JWT signing and QR signing should ideally use separate secrets so compromise of one purpose does not automatically compromise the other.

## Recommended fix

Add:

```text
QR_SIGNING_SECRET: z.string().min(32)
```

and use:

```text
env.QR_SIGNING_SECRET
```

in `qr.service.ts`.

## Severity

**HIGH**

---

# 11. QR e-ticket assessment

## Positive

The QR payload is signed with HMAC-SHA256 and the code uses `timingSafeEqual()` for signature verification.

That is a good anti-tampering mechanism.

## Important limitation

The QR payload contains:

```text
ref
eventId
tickets
holder
sig
```

but there is no booking-status validation endpoint in the supplied API.

Therefore the QR signature proves:

> "This payload was signed by the server secret."

It does **not** prove:

> "This booking is currently valid and has not been cancelled."

A cancelled booking's QR remains cryptographically valid unless a verifier also checks booking state against the database.

Also, `holder` exposes the customer's name inside the QR payload.

## Recommendation

If the assessment only needs an authentic e-ticket, the current signing design is acceptable.

For a real admission system, add a server-side verification endpoint or make scanners check the booking state before admitting the ticket.

## Severity

**MEDIUM**

---

# 12. MEDIUM — Email HTML injection / escaping

The email templates interpolate user-controlled values directly into HTML:

```text
fullName
eventTitle
location
bookingReference
changedFields
```

Examples occur in `src/services/email.service.ts`.

If an attacker creates a name/event title containing HTML, the generated email can contain attacker-controlled markup.

## Recommendation

HTML-escape all dynamic values before inserting them into HTML templates, or use a trusted templating/escaping library.

## Severity

**MEDIUM**

---

# 13. Event update broadcast — mostly PASS, one functional gap

`src/services/event.service.ts` correctly identifies critical changes to:

- title
- eventDate
- location
- onlineLink

and queries only:

```text
BookingStatus.CONFIRMED
```

This is good.

### Functional gap

`onlineLink` is considered a critical changed field, but the broadcast email template only displays:

- event date
- physical location

It does not display the updated online link.

So an online-link change can trigger an email that does not actually provide the new link.

**Severity: MEDIUM**

### Another reliability gap

Broadcast enqueue failures are swallowed, as described earlier.

---

# 14. Redis caching audit

## Positive

The cache service correctly uses:

```text
GET
SET EX
DEL
SCAN
```

rather than the blocking `KEYS *` approach.

TTL values in code are:

```text
EVENT_LIST   = 60 seconds
EVENT_DETAIL = 30 seconds
```

Cache invalidation occurs when event inventory/details change.

## Performance concern

`invalidateEventCache()` scans the entire matching keyspace and waits for the scan/delete operation to complete.

Booking/cancellation therefore performs cache invalidation synchronously on the HTTP request path.

For a large cache this can become additional latency during a write-heavy flash sale.

This is not a correctness problem because PostgreSQL remains authoritative, but it limits the performance benefit.

**Severity: MEDIUM**

## Recommendation

Consider a cache version/tag strategy or bounded asynchronous invalidation. If immediate invalidation is retained, document the tradeoff.

---

# 15. MEDIUM — OTP rate-limit middleware is defined but unused

`src/middleware/rateLimit.middleware.ts` defines:

```text
otpRateLimit
```

with a five-request limit.

But the route file applies only:

```text
authRateLimit
```

to all authentication routes.

There is no route using `otpRateLimit`.

The database still has the five-attempt OTP limit, so brute-force protection is not absent, but the intended separate HTTP-level OTP limiter is dead configuration.

### Recommendation

Either:

```text
router.post('/verify-otp', otpRateLimit, ...)
```

or remove the unused limiter and document that database-level attempts are the primary protection.

---

# 16. OTP security audit

## Positive

`src/utils/otp.ts` uses:

```text
crypto.randomInt(100000, 1000000)
```

which is appropriate for generating a six-digit OTP.

The database stores only SHA-256, not plaintext.

Expiration is 10 minutes.

Attempt count is limited to five.

`timingSafeEqual()` is used.

This is a good implementation for the assessment.

## Remaining concerns

### Resend reset race

Two simultaneous resend requests can generate two different OTPs and queue both emails. The last DB write wins, while the customer may receive both codes in uncertain order.

### Registration/email reliability

Registration commits the user before queueing the OTP email. If Redis is unavailable, the account can exist with no OTP delivery.

This reinforces the outbox/reconciliation recommendation.

---

# 17. RBAC / ownership audit — PASS

The authentication middleware:

1. extracts Bearer JWT
2. verifies token
3. checks the user exists
4. checks account verification
5. attaches user to request

RBAC checks role.

Event ownership is also checked in the service layer.

Booking ownership is checked before viewing/cancelling.

This layered approach is good.

### Positive

Organizer B cannot update Organizer A's event merely by having a valid ORGANIZER token.

Customer B cannot access Customer A's booking.

---

# 18. Authentication security — mostly PASS

Passwords use bcrypt.

JWTs contain user identity and role.

The environment requires a minimum 32-character JWT secret.

Helmet is enabled.

Authentication endpoints are rate-limited.

### Note

`JWT_EXPIRES_IN` is configurable and defaults to 7 days. For a production application, shorter access-token lifetimes plus refresh tokens would be more typical, but this is not necessary for the assessment.

---

# 19. Health endpoint audit

`GET /health` probes:

- PostgreSQL
- Redis
- BullMQ queue paused state

PostgreSQL/Redis failure → 503.

Queue degradation → 200 with `status: degraded`.

That dependency classification is sensible.

## MEDIUM issue: worker liveness is not actually proven

The health code checks:

```text
notificationQueue.isPaused()
```

A queue can be unpaused while the worker process is completely dead.

Therefore:

```text
workerQueue.status = ready
```

does not necessarily mean:

```text
worker process is alive
```

## Recommendation

Expose a worker heartbeat/last-seen key in Redis, or use a lightweight worker heartbeat record.

Then health can distinguish:

```text
queue reachable
worker alive
```

---

# 20. Graceful shutdown — PASS WITH ARCHITECTURAL NOTE

`src/server.ts` correctly stops accepting new HTTP requests and waits for the server close callback before disconnecting Prisma and Redis.

The worker has its own SIGINT/SIGTERM handler and calls `emailWorker.close()`.

This is appropriate because the API and worker are separate processes.

The 10-second hard timeout is also sensible.

### Important documentation wording

Do not imply that the API process shuts down the separate worker process. Each process owns its own lifecycle.

---

# 21. Rate limiting — MEDIUM

The global API limiter is:

```text
3000 requests / minute / IP
```

This was intentionally raised for benchmark testing.

That is acceptable for a local benchmark, but it is a weak production policy.

### Recommendation

Use environment-specific limits, e.g.:

```text
development/benchmark → high limit
production             → tuned per route/IP/user
```

Also consider separate limits for expensive booking and authentication operations.

---

# 22. CORS — LOW/MEDIUM depending deployment

The application currently uses:

```text
origin: '*'
```

Because authentication is Bearer-header based rather than cookie based, this is not automatically a credential-leak vulnerability.

However, for production, restricting origins is preferable.

Recommendation:

```text
CORS_ORIGINS=https://your-frontend.example
```

or document that the API is intentionally public for the assessment.

---

# 23. Benchmark audit

## Native benchmark — strong methodology for correctness

`benchmarks/run-benchmarks.ts` creates:

- one event with 100 tickets
- 500 distinct customer records
- 500 JWTs
- 500 concurrent Supertest booking requests

This is stronger for the concurrency correctness demonstration than a k6 script that relies on a single shared token.

The final DB state is checked after the burst.

That is good.

## But there are benchmark reporting problems

### HIGH — k6 flash-sale script requires environment configuration

`benchmarks/flash-sale.js` defaults to:

```text
EVENT_ID = event_flash_sale_bench
BENCHMARK_TOKEN = ''
```

Without supplying these environment variables, the documented command:

```text
k6 run benchmarks/flash-sale.js
```

will not represent the intended authenticated flash sale against a known event.

### Recommendation

Either:

1. make the README command include the required variables, or
2. make the script perform setup/authentication safely, or
3. explicitly label the native TypeScript runner as the reproducible flash-sale benchmark and k6 as an optional load-test script requiring configuration.

---

# 24. HIGH — k6 read-cache threshold contradicts empirical results

`benchmarks/read-cache.js` contains:

```text
http_req_duration: p(95)<150ms
```

But the documented native benchmark measured approximately:

```text
uncached p95 ≈ 718 ms
cached p95   ≈ 388 ms
```

Therefore the k6 script's `p95 < 150ms` threshold is not consistent with the reported environment.

It will likely fail against the same remote infrastructure.

### Recommendation

Do not choose a target that is contradicted by your measured evidence. Either:

- remove the latency threshold and report measurements, or
- define a realistic environment-specific target.

---

# 25. HIGH — breaking-point runner still contains a hardcoded bottleneck/saturation claim

`benchmarks/run-benchmarks.ts` returns:

```text
saturationPoint: 300
primaryBottleneck: 'Single-node Express event loop & TLS connection pool...'
```

But the Phase 5 documentation was correctly revised to avoid claiming an unmeasured root cause.

The runner itself has not been brought into line with that correction.

Also, the actual stated threshold was first crossed at 50 VUs, not 300 VUs.

### Recommendation

Change the runner to report measured facts:

```text
firstP95ThresholdCrossing = 50
```

and use neutral wording such as:

```text
Observed behavior: p95 latency increased with concurrency.
```

Do not label 300 VUs as the breaking point unless 300 is explicitly defined as a separate test boundary.

---

# 26. Benchmark result label accuracy

The native runner prints:

```text
5xx / Other Errors
```

but `errorCount` increments for **any** response other than 201 or 409.

So a 400, 401, 403, 404, 429, or 500 would all be counted together.

The output label should be:

```text
Unexpected responses
```

or the code should separately count actual 5xx responses.

This is a small but important reporting-quality issue.

---

# 27. README claims that should be softened

The README currently contains claims stronger than the supplied evidence.

## Claim: "sub-millisecond idempotency deduplication"

No latency benchmark in the repository proves sub-millisecond idempotency lookup.

**Change to:**

> Database-backed idempotency replay protection.

## Claim: "mathematically guaranteed zero-overselling"

The SQL design strongly protects inventory under the tested concurrency model, but the word "guaranteed" is broader than a finite benchmark proves.

**Change to:**

> Atomic PostgreSQL inventory decrement with zero overselling observed in the 500-request concurrency test.

## Claim: ">95%" DB read-pressure reduction

The native benchmark measured latency/RPS, not database query-count reduction or CPU reduction.

**Change to:**

> Redis read-through caching reduced measured p95 latency by 46% in the reported remote test.

## Claim: email latency "300–800ms" and "80–90%" throughput impact

These figures are not established by the supplied benchmark.

**Change to:**

> Email delivery is moved off the synchronous booking HTTP path.

---

# 28. README environment mismatch

README documents:

```text
QR_SIGNING_SECRET
CACHE_ENABLED
CACHE_TTL_SECONDS
```

but the supplied `src/config/env.ts` does not validate those variables, and the cache service uses hard-coded:

```text
EVENT_LIST = 60
EVENT_DETAIL = 30
```

There is no `CACHE_ENABLED` implementation in the source.

**Severity: HIGH for documentation accuracy.**

Either implement the documented variables or remove them from the README.

---

# 29. Swagger audit

Swagger exists and is generated successfully in the project structure, which is good.

However, the specification is not a complete mirror of the implementation.

Examples:

- `/api/auth/resend-otp` is missing.
- `/api/bookings/{id}` GET is missing.
- health response schema describes `database`/`redis` as strings while actual responses contain objects with status/responseTimeMs.
- many request schemas and detailed error responses are minimal.
- the Swagger server is hard-coded to `http://localhost:4000`.

**Severity: MEDIUM**

### Recommendation

For an evaluator, completeness matters more than making Swagger visually impressive. Add the missing routes and accurate response schemas.

---

# 30. Postman collection — PASS WITH GOOD AUTOMATION

The upgraded collection has useful variables:

```text
baseUrl
organizerToken
customerToken
authToken
eventId
bookingId
```

and uses dynamic IDs / idempotency keys.

This is a strong improvement.

### Recommended final addition

Add a dedicated replay demonstration:

```text
First request with fixed demo Idempotency-Key → 201
Second request with same key               → 200 + isReplayed=true
```

This makes the concurrency/idempotency story easy for an evaluator to verify.

---

# 31. Seed data — PASS WITH SECURITY NOTE

The seed script is intentionally deterministic and uses:

```text
organizer@test.com
customer1@test.com ... customer5@test.com
Password123!
```

This is acceptable for local/demo seed data.

However, the README must make it crystal clear that these are **development/test credentials only** and must never be used in production.

---

# 32. Test suite audit

The repository contains 12 test files covering:

- authentication
- bookings
- concurrency
- events
- database
- middleware
- health
- Swagger
- QR
- queue
- broadcast
- cache

The supplied project documentation reports **62/62 passing**.

I could not independently complete a fresh `npm ci`/test run from the ZIP in this audit environment because dependency installation timed out, so the 62/62 result is treated as a **reported project result**, not as an independently reproduced result in this audit.

That distinction should not be hidden in a formal audit.

## Missing/underrepresented tests to add

### High priority

1. Cross-customer idempotency-key collision.
2. Same customer + same idempotency key + different event/quantity.
3. Booking after `eventDate` has passed while status remains `UPCOMING`.
4. BullMQ enqueue failure after a committed booking.
5. Email provider absent/misconfigured.
6. NotificationLog record count across three retry attempts.
7. Online-link update broadcast content.
8. Worker liveness vs queue availability.
9. Database CHECK constraints once migrations exist.

These tests would catch the most important issues identified in this audit.

---

# 33. Test fixtures using dummy password hashes

Several integration tests directly create users with:

```text
passwordHash: 'dummy'
```

This is acceptable when the test creates a user and signs JWTs directly rather than testing password authentication.

It is **not evidence of a production mock shortcut**.

Your production auth service correctly uses bcrypt.

---

# 34. Docker Compose audit

The local Docker setup is useful and straightforward:

- PostgreSQL 16
- Redis 7
- persistent volumes
- healthchecks

The database password is intentionally a development password in `docker-compose.yml`.

That is fine for local Docker, but documentation should emphasize that cloud deployment uses secrets/environment variables rather than this password.

---

# 35. What is genuinely strong in this project

## A. Inventory architecture — excellent

The decision to make PostgreSQL the inventory authority is correct for this assessment.

## B. Atomic booking — excellent

The conditional UPDATE is much better than application-level read/modify/write logic.

## C. Transaction boundary — strong

Inventory decrement + booking creation are in the same transaction.

## D. Cancellation — strong

The state transition and inventory restoration are performed transactionally.

## E. Ownership — strong

RBAC is separated from resource ownership.

## F. Async email — strong architectural direction

BullMQ keeps email delivery out of the booking response path.

## G. QR signing — strong concept

HMAC + timing-safe verification is appropriate for tamper detection.

## H. Redis cache — good use

Redis is used as a read cache, not as the authority for ticket inventory.

## I. Test breadth — strong

The project has significantly more automated coverage than a typical rushed assessment submission.

---

# 36. Recommended fix order

If you have limited time, fix these in exactly this order:

### P0 — Fix before submission

1. **Scope idempotency keys to customer + validate request fingerprint.**
2. **Add `eventDate > NOW()` to the atomic booking UPDATE.**
3. **Remove simulated email success fallback.**
4. **Make email-provider configuration fail fast.**
5. **Fix NotificationLog to represent one notification across retries.**
6. **Implement an outbox/reconciliation mechanism or explicitly acknowledge the enqueue-loss limitation.**
7. **Add/restore actual Prisma migration files if claiming DB CHECK constraints.**
8. **Use a dedicated `QR_SIGNING_SECRET` consistently.**

### P1 — Fix before final README/Loom

9. Align benchmark runner with corrected Phase 5 methodology.
10. Fix k6 environment/configuration documentation.
11. Remove contradictory k6 p95 threshold.
12. Complete Swagger endpoints/schemas.
13. Remove unsupported README performance claims.
14. Remove undocumented `CACHE_ENABLED` / `CACHE_TTL_SECONDS` claims or implement them.
15. Add worker heartbeat if health is advertised as deep worker health.

### P2 — Quality hardening

16. Escape HTML email variables.
17. Add onlineLink to broadcast email.
18. Use the dedicated OTP rate limiter or remove it.
19. Consider asynchronous/versioned cache invalidation.
20. Restrict production CORS.

---

# 37. Suggested final architecture after fixes

```text
                    Client
                      │
                      ▼
               Express API
                      │
          ┌───────────┴───────────┐
          │                       │
          ▼                       ▼
     PostgreSQL                 Redis
     SOURCE OF TRUTH          Cache + BullMQ
          │                       │
          │              ┌────────┴────────┐
          │              │                 │
          │         BullMQ Queue       Cache Reads
          │              │
          │              ▼
          │        Notification Worker
          │              │
          │        ┌─────┴─────┐
          │        │           │
          │      Resend      NotificationLog
          │
          └──── Transactional Outbox
```

The important reliability property is:

```text
Booking transaction
     │
     ├── inventory decrement
     ├── booking creation
     └── outbox/notification record
              │
              ▼
         dispatcher
              │
              ▼
            BullMQ
```

That closes the main reliability gap between PostgreSQL commit and Redis/BullMQ enqueue.

---

# 38. Final scorecard

| Area | Audit result |
|---|---|
| Architecture | **Strong** |
| PostgreSQL inventory concurrency | **Strong** |
| Booking transaction | **Strong** |
| Cancellation concurrency | **Strong** |
| Authentication | **Strong** |
| RBAC | **Strong** |
| Ownership | **Strong** |
| OTP generation | **Strong** |
| OTP delivery reliability | **Needs hardening** |
| Idempotency | **Critical fix required** |
| Redis cache | **Good, performance hardening recommended** |
| BullMQ architecture | **Good, enqueue reliability needs fix** |
| Email delivery | **Critical requirement mismatch due simulated fallback** |
| Notification audit logging | **Needs redesign for retries** |
| QR signing | **Good concept, secret mismatch** |
| Event update broadcast | **Good, online-link content gap** |
| Health check | **Good, worker liveness incomplete** |
| Graceful shutdown | **Good** |
| Swagger | **Needs completion** |
| Postman | **Good** |
| Automated tests | **Broad and strong, with important missing edge cases** |
| k6 scripts | **Needs reproducibility/threshold cleanup** |
| Native benchmark | **Good correctness benchmark, some reporting hardcoding remains** |
| Documentation | **Very detailed but contains overclaims/mismatches** |
| Deployment readiness | **Close, but not final** |

---

# 39. Final submission verdict

## Current state

**NOT READY FOR FINAL SUBMISSION YET.**

This is not because the project architecture is poor. The opposite is true: the core architecture is quite strong.

The reason is that the ZIP contains several issues that a strong backend evaluator could discover quickly, especially:

- idempotency scope/security
- booking after event date
- email enqueue loss
- simulated email fallback
- notification retry logging
- migration/constraint artifact mismatch
- QR secret mismatch

## After P0 fixes

If the P0 issues are corrected and the associated tests are added, I would consider the project **submission-ready** provided that:

1. the API and worker are actually deployed,
2. real email delivery is demonstrated,
3. `/health` works in the cloud,
4. Swagger/Postman work against the deployed API,
5. the final benchmark numbers are reproduced and documented accurately,
6. the Loom demonstrates correctness rather than only happy-path API calls.

### Most important interview message

The strongest story of this project is not:

> "I built an event booking API."

It is:

> **"I made PostgreSQL the source of truth for inventory, used an atomic conditional decrement inside a transaction to prevent overselling, separated asynchronous notifications with BullMQ, used Redis only as a cache, and verified the inventory invariant under 500 concurrent booking attempts."**

That is the architectural argument worth demonstrating.

---

# Appendix — Files most relevant to the audit

```text
src/services/booking.service.ts
src/services/event.service.ts
src/services/auth.service.ts
src/services/email.service.ts
src/services/qr.service.ts
src/jobs/notificationQueue.ts
src/workers/emailWorker.ts
src/config/env.ts
src/config/redis.ts
src/config/database.ts
src/routes/health.routes.ts
src/middleware/auth.middleware.ts
src/middleware/rbac.middleware.ts
src/middleware/rateLimit.middleware.ts
prisma/schema.prisma
prisma/seed.ts
benchmarks/flash-sale.js
benchmarks/read-cache.js
benchmarks/breaking-point.js
benchmarks/run-benchmarks.ts
src/config/swagger.ts
docs/Event_Booking_System.postman_collection.json
README.md
tests/*.ts
```

**Audit basis:** static inspection of the complete supplied ZIP. Reported prior test/build results were not treated as independently reproduced because dependency installation from the archive timed out in the audit environment.
