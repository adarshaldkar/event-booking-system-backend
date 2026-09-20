import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';

const readLatency = new Trend('event_list_latency_ms');
const requestCounter = new Counter('total_read_requests');

export const options = {
  scenarios: {
    read_throughput: {
      executor: 'constant-vus',
      vus: 200,
      duration: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'], // < 1% errors
    http_req_duration: ['p(95)<150'], // 95% of requests under 150ms
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';

export default function () {
  const res = http.get(`${BASE_URL}/api/events?page=1&limit=10`);
  
  readLatency.add(res.timings.duration);
  requestCounter.add(1);

  check(res, {
    'status is 200': (r) => r.status === 200,
    'has events list': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.success === true && Array.isArray(body.data);
      } catch (e) {
        return false;
      }
    },
  });

  sleep(0.01);
}
