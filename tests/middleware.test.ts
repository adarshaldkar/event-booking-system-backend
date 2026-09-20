import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app';

describe('Global Middleware & Error Handling', () => {
  it('GET /non-existent-route - should return 404 with structured JSON error', async () => {
    const res = await request(app).get('/non-existent-route');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toContain('Route GET /non-existent-route not found');
  });

  it('Security Headers - should include Helmet security headers', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-dns-prefetch-control']).toBe('off');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('CORS Headers - should allow cross-origin requests', async () => {
    const res = await request(app).options('/health');
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});
