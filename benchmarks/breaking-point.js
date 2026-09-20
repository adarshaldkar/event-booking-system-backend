import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

const stressLatency = new Trend('stress_latency_ms');
const errorRate = new Rate('stress_error_rate');
const requestCount = new Counter('stress_req_count');

export const options = {
  stages: [
    { duration: '30s', target: 200 },   // Stage 1: Warm-up to 200 VUs
    { duration: '45s', target: 500 },   // Stage 2: Ramp-up to 500 VUs
    { duration: '60s', target: 1000 },  // Stage 3: Heavy load to 1000 VUs
    { duration: '60s', target: 2000 },  // Stage 4: Stress limit to 2000 VUs
    { duration: '30s', target: 0 },     // Stage 5: Cooldown to 0 VUs
  ],
  thresholds: {
    stress_error_rate: ['rate<0.05'], // Max 5% errors during stress ramp
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';

export default function () {
  const res = http.get(`${BASE_URL}/api/events?page=1&limit=10`);
  
  stressLatency.add(res.timings.duration);
  requestCount.add(1);

  const isSuccess = res.status === 200;
  errorRate.add(!isSuccess);

  check(res, {
    'status is 200 OK': (r) => r.status === 200,
    'latency within limits (<500ms)': (r) => r.timings.duration < 500,
  });

  sleep(0.02);
}
