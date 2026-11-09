// k6 run tests/load/webhook.k6.js -e TARGET=http://localhost:4000/webhook/demo-leads
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  scenarios: { ramp: { executor: 'ramping-vus', startVUs: 1, stages: [{ duration: '30s', target: 50 }, { duration: '1m', target: 50 }, { duration: '15s', target: 0 }] } },
  thresholds: { http_req_failed: ['rate<0.01'], http_req_duration: ['p(95)<500'] },
};

export default function () {
  const res = http.post(__ENV.TARGET, JSON.stringify({ name: 'Load Test', email: `load${__VU}.${__ITER}@example.com` }), { headers: { 'content-type': 'application/json' } });
  check(res, { 'accepted': (r) => r.status === 200 || r.status === 202 });
}
