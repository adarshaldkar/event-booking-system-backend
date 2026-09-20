import swaggerJsdoc from 'swagger-jsdoc';

const swaggerOptions: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Event Booking System API',
      version: '1.0.0',
      description:
        'Production-ready, high-concurrency Event Booking System backend with RBAC, atomic database transactions, idempotency, Redis caching, and BullMQ asynchronous notifications.',
      contact: {
        name: 'API Support',
        email: 'support@eventbooking.local',
      },
    },
    servers: [
      {
        url: 'http://localhost:4000',
        description: 'Local Development Server',
      },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter your JWT token: Bearer <token>',
        },
      },
      schemas: {
        StandardSuccessResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            data: { type: 'object' },
            message: { type: 'string', example: 'Operation completed successfully' },
          },
        },
        StandardErrorResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', example: 'INSUFFICIENT_TICKETS' },
                message: { type: 'string', example: 'Not enough tickets available' },
                details: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
        HealthResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            status: { type: 'string', example: 'healthy' },
            timestamp: { type: 'string', example: '2026-09-20T12:30:00.000Z' },
            services: {
              type: 'object',
              properties: {
                database: { type: 'string', example: 'connected' },
                redis: { type: 'string', example: 'connected' },
              },
            },
          },
        },
        CreateEventRequest: {
          type: 'object',
          required: ['title', 'description', 'category', 'location', 'eventDate', 'totalCapacity', 'ticketPrice'],
          properties: {
            title: { type: 'string', example: 'Cloud Architecture Summit 2026' },
            description: { type: 'string', example: 'Deep dive into microservices and atomic distributed transactions.' },
            category: { type: 'string', example: 'Technology' },
            location: { type: 'string', example: 'Convention Center, Hall A' },
            onlineLink: { type: 'string', example: 'https://meet.google.com/xyz-abc' },
            eventDate: { type: 'string', format: 'date-time', example: '2026-11-15T09:00:00.000Z' },
            totalCapacity: { type: 'integer', minimum: 1, example: 250 },
            ticketPrice: { type: 'number', minimum: 0, example: 49.99 },
          },
        },
        CreateBookingRequest: {
          type: 'object',
          required: ['eventId', 'quantity'],
          properties: {
            eventId: { type: 'string', format: 'uuid', example: 'seed-flash-sale-event-id' },
            quantity: { type: 'integer', minimum: 1, maximum: 10, example: 2 },
          },
        },
      },
    },
    paths: {
      '/health': {
        get: {
          summary: 'Health check endpoint',
          description: 'Verifies PostgreSQL database and Redis connectivity.',
          tags: ['System'],
          responses: {
            200: { description: 'All services healthy' },
            503: { description: 'One or more services degraded' },
          },
        },
      },
      '/api/auth/register': {
        post: {
          summary: 'Register a new user',
          tags: ['Authentication'],
          responses: { 201: { description: 'User registered. OTP sent.' } },
        },
      },
      '/api/auth/verify-otp': {
        post: {
          summary: 'Verify OTP code',
          tags: ['Authentication'],
          responses: { 200: { description: 'Account verified. Returns JWT.' } },
        },
      },
      '/api/auth/login': {
        post: {
          summary: 'User Login',
          tags: ['Authentication'],
          responses: { 200: { description: 'Login successful. Returns JWT.' } },
        },
      },
      '/api/auth/me': {
        get: {
          summary: 'Get Authenticated User Profile',
          tags: ['Authentication'],
          security: [{ BearerAuth: [] }],
          responses: { 200: { description: 'Profile retrieved' } },
        },
      },
      '/api/events': {
        get: {
          summary: 'List Events (Public)',
          tags: ['Events'],
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 10 } },
            { name: 'category', in: 'query', schema: { type: 'string' } },
            { name: 'search', in: 'query', schema: { type: 'string' } },
          ],
          responses: { 200: { description: 'List of events' } },
        },
        post: {
          summary: 'Create Event (Organizer Only)',
          tags: ['Events'],
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateEventRequest' } } },
          },
          responses: { 201: { description: 'Event created' }, 403: { description: 'Forbidden' } },
        },
      },
      '/api/events/{id}': {
        get: {
          summary: 'Get Event Details (Public)',
          tags: ['Events'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Event details' }, 404: { description: 'Not found' } },
        },
        put: {
          summary: 'Update Event (Organizer Owner Only)',
          tags: ['Events'],
          security: [{ BearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Event updated' }, 403: { description: 'Not owner' } },
        },
        delete: {
          summary: 'Cancel Event (Organizer Owner Only - Soft Delete)',
          tags: ['Events'],
          security: [{ BearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Event marked CANCELLED' }, 403: { description: 'Not owner' } },
        },
      },
      '/api/bookings': {
        get: {
          summary: 'List Customer Bookings',
          tags: ['Bookings'],
          security: [{ BearerAuth: [] }],
          responses: { 200: { description: 'Customer booking history' } },
        },
        post: {
          summary: 'Create Booking (Atomic & Idempotent)',
          tags: ['Bookings'],
          security: [{ BearerAuth: [] }],
          parameters: [
            {
              name: 'Idempotency-Key',
              in: 'header',
              required: false,
              schema: { type: 'string' },
              description: 'Unique UUID to prevent duplicate charges/bookings on network retries',
            },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateBookingRequest' } } },
          },
          responses: {
            201: { description: 'Booking confirmed' },
            200: { description: 'Existing booking replayed (Idempotency)' },
            409: { description: 'Insufficient tickets or Sold out' },
          },
        },
      },
      '/api/bookings/{id}/cancel': {
        post: {
          summary: 'Cancel Booking & Restock Tickets (Customer Only)',
          tags: ['Bookings'],
          security: [{ BearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: { description: 'Booking cancelled and tickets restocked' },
            400: { description: 'Already cancelled or past event' },
          },
        },
      },
    },
  },
  apis: ['./src/routes/*.ts'],
};

export const swaggerSpec = swaggerJsdoc(swaggerOptions);
