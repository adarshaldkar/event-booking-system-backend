import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// Custom metrics
const successfulBookings = new Counter('successful_bookings_201');
const conflictBookings = new Counter('conflict_bookings_409');
const unexpectedErrors = new Counter('unexpected_errors');
const bookingSuccessRate = new Rate('booking_success_rate');
const bookingLatency = new Trend('booking_latency_ms');

export const options = {
  scenarios: {
    flash_sale: {
      executor: 'shared-iterations',
      vus: 500,
      iterations: 500,
      maxDuration: '60s',
    },
  },
  thresholds: {
    successful_bookings_201: ['count==100'],
    conflict_bookings_409: ['count==400'],
    unexpected_errors: ['count==0'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';
const EVENT_ID = __ENV.EVENT_ID || 'event_flash_sale_bench';

export function setup() {
  console.log(`Setting up Flash Sale Benchmark against ${BASE_URL}...`);
  console.log(`Target Event ID: ${EVENT_ID}`);
  console.log(`Tip: Pass -e BASE_URL=... -e EVENT_ID=... -e BENCHMARK_TOKEN=... to customize`);
  return { baseUrl: BASE_URL, eventId: EVENT_ID };
}

export default function (data) {
  const vuId = __VU;
  const iterId = __ITER;
  
  const payload = JSON.stringify({
    eventId: data.eventId,
    quantity: 1,
  });

  const headers = {
    'Content-Type': 'application/json',
    'Idempotency-Key': `k6-flash-${vuId}-${iterId}-${Date.now()}`,
  };

  if (__ENV.BENCHMARK_TOKEN) {
    headers['Authorization'] = `Bearer ${__ENV.BENCHMARK_TOKEN}`;
  }

  const res = http.post(`${data.baseUrl}/api/bookings`, payload, { headers });
  bookingLatency.add(res.timings.duration);

  if (res.status === 201) {
    successfulBookings.add(1);
    bookingSuccessRate.add(1);
    check(res, { 'status is 201 Created': (r) => r.status === 201 });
  } else if (res.status === 409) {
    conflictBookings.add(1);
    bookingSuccessRate.add(0);
    check(res, { 'status is 409 Conflict (Sold Out / Insufficient)': (r) => r.status === 409 });
  } else {
    unexpectedErrors.add(1);
    console.error(`Unexpected response: ${res.status} - ${res.body}`);
    check(res, { 'status is unexpected': (r) => false });
  }
}

export function teardown(data) {
  console.log('Flash sale benchmark completed.');
  console.log(`Check final DB state to ensure 100 tickets sold and 0 oversold.`);
}
