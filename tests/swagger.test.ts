import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app';

describe('Swagger Documentation API', () => {
  it('GET /api-docs.json - should serve valid OpenAPI 3.0 specification', async () => {
    const res = await request(app).get('/api-docs.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.0.0');
    expect(res.body.info.title).toBe('Event Booking System API');
    expect(res.body.paths['/health']).toBeDefined();
    expect(res.body.paths['/api/auth/register']).toBeDefined();
    expect(res.body.paths['/api/auth/login']).toBeDefined();
  });

  it('GET /api-docs/ - should serve HTML Swagger UI page', async () => {
    const res = await request(app).get('/api-docs/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('swagger-ui');
  });
});
