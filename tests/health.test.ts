import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app';

describe('Health Check API', () => {
  it('GET /health - should return 200 and healthy status for database and redis', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('healthy');
    expect(res.body.services.database).toBe('connected');
    expect(res.body.services.redis).toBe('connected');
    expect(res.body.timestamp).toBeDefined();
  });
});
