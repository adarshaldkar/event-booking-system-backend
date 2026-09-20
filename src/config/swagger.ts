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
            status: { type: 'string', enum: ['healthy', 'degraded', 'unhealthy'], example: 'healthy' },
            timestamp: { type: 'string', format: 'date-time', example: '2026-09-20T12:30:00.000Z' },
            uptime: { type: 'number', example: 124.5 },
            services: {
              type: 'object',
              properties: {
                database: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'connected' },
                    responseTimeMs: { type: 'number', nullable: true, example: 2.15 },
                  },
                },
                redis: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'connected' },
                    responseTimeMs: { type: 'number', nullable: true, example: 0.85 },
                  },
                },
                workerQueue: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'ready' },
                  },
                },
              },
            },
          },
        },
        RegisterRequest: {
          type: 'object',
          required: ['email', 'password', 'fullName', 'role'],
          properties: {
            email: { type: 'string', format: 'email', example: 'customer@example.com' },
            password: { type: 'string', format: 'password', minLength: 8, example: 'Password123!' },
            fullName: { type: 'string', minLength: 2, example: 'Alex Johnson' },
            role: { type: 'string', enum: ['CUSTOMER', 'ORGANIZER'], example: 'CUSTOMER' },
          },
        },
        VerifyOtpRequest: {
          type: 'object',
          required: ['email', 'otp'],
          properties: {
            email: { type: 'string', format: 'email', example: 'customer@example.com' },
            otp: { type: 'string', minLength: 6, maxLength: 6, example: '123456' },
          },
        },
        ResendOtpRequest: {
          type: 'object',
          required: ['email'],
          properties: {
            email: { type: 'string', format: 'email', example: 'customer@example.com' },
          },
        },
        LoginRequest: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email', example: 'customer@example.com' },
            password: { type: 'string', format: 'password', example: 'Password123!' },
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
        UpdateEventRequest: {
          type: 'object',
          properties: {
            title: { type: 'string', example: 'Updated Summit Title 2026' },
            description: { type: 'string', example: 'Updated description.' },
            category: { type: 'string', example: 'Conference' },
            location: { type: 'string', example: 'Grand Ballroom, Hall B' },
            onlineLink: { type: 'string', example: 'https://meet.google.com/new-link' },
            eventDate: { type: 'string', format: 'date-time', example: '2026-11-20T10:00:00.000Z' },
            ticketPrice: { type: 'number', minimum: 0, example: 59.99 },
          },
        },
        CreateBookingRequest: {
          type: 'object',
          required: ['eventId', 'quantity'],
          properties: {
            eventId: { type: 'string', format: 'uuid', example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' },
            quantity: { type: 'integer', minimum: 1, maximum: 10, example: 2 },
          },
        },
      },
    },
    paths: {
      '/health': {
        get: {
          summary: 'Health check endpoint',
          description: 'Verifies PostgreSQL database, Redis, and BullMQ worker connectivity.',
          tags: ['System'],
          responses: {
            200: {
              description: 'Service is healthy or partially degraded',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthResponse' } } },
            },
            503: {
              description: 'Critical service dependency down (PostgreSQL or Redis)',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthResponse' } } },
            },
          },
        },
      },
      '/api/auth/register': {
        post: {
          summary: 'Register a new user',
          tags: ['Authentication'],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/RegisterRequest' } } },
          },
          responses: {
            201: { description: 'User registered. OTP sent.' },
            400: { description: 'Validation error' },
            409: { description: 'Email already exists' },
          },
        },
      },
      '/api/auth/verify-otp': {
        post: {
          summary: 'Verify OTP code',
          tags: ['Authentication'],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/VerifyOtpRequest' } } },
          },
          responses: {
            200: { description: 'Account verified. Returns JWT.' },
            400: { description: 'Invalid or expired OTP' },
          },
        },
      },
      '/api/auth/resend-otp': {
        post: {
          summary: 'Resend verification OTP code',
          tags: ['Authentication'],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ResendOtpRequest' } } },
          },
          responses: {
            200: { description: 'Fresh OTP code sent to email' },
            400: { description: 'Account already verified' },
            404: { description: 'User not found' },
          },
        },
      },
      '/api/auth/login': {
        post: {
          summary: 'User Login',
          tags: ['Authentication'],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } } },
          },
          responses: {
            200: { description: 'Login successful. Returns JWT.' },
            401: { description: 'Invalid email or password' },
            403: { description: 'Account unverified' },
          },
        },
      },
      '/api/auth/me': {
        get: {
          summary: 'Get Authenticated User Profile',
          tags: ['Authentication'],
          security: [{ BearerAuth: [] }],
          responses: {
            200: { description: 'Profile retrieved' },
            401: { description: 'Unauthorized' },
          },
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
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['UPCOMING', 'ONGOING', 'COMPLETED', 'CANCELLED'] } },
            { name: 'search', in: 'query', schema: { type: 'string' } },
          ],
          responses: { 200: { description: 'List of events with pagination' } },
        },
        post: {
          summary: 'Create Event (Organizer Only)',
          tags: ['Events'],
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateEventRequest' } } },
          },
          responses: {
            201: { description: 'Event created successfully' },
            400: { description: 'Validation error' },
            403: { description: 'Forbidden — Organizer role required' },
          },
        },
      },
      '/api/events/{id}': {
        get: {
          summary: 'Get Event Details (Public)',
          tags: ['Events'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: { description: 'Event details' },
            404: { description: 'Event not found' },
          },
        },
        put: {
          summary: 'Update Event (Organizer Owner Only)',
          tags: ['Events'],
          security: [{ BearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateEventRequest' } } },
          },
          responses: {
            200: { description: 'Event updated' },
            403: { description: 'Forbidden — Not event owner' },
            404: { description: 'Event not found' },
          },
        },
        delete: {
          summary: 'Cancel Event (Organizer Owner Only - Soft Delete)',
          tags: ['Events'],
          security: [{ BearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: { description: 'Event marked CANCELLED' },
            403: { description: 'Forbidden — Not event owner' },
            404: { description: 'Event not found' },
          },
        },
      },
      '/api/bookings': {
        get: {
          summary: 'List Customer Bookings',
          tags: ['Bookings'],
          security: [{ BearerAuth: [] }],
          responses: {
            200: { description: 'Customer booking history' },
            401: { description: 'Unauthorized' },
          },
        },
        post: {
          summary: 'Create Booking (Atomic, Idempotent, Customer Only)',
          tags: ['Bookings'],
          security: [{ BearerAuth: [] }],
          parameters: [
            {
              name: 'Idempotency-Key',
              in: 'header',
              required: false,
              schema: { type: 'string' },
              description: 'Unique key scoped to customer to prevent double-booking on network retries',
            },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateBookingRequest' } } },
          },
          responses: {
            201: { description: 'Booking confirmed' },
            200: { description: 'Existing booking replayed (Idempotency)' },
            400: { description: 'Event is in the past or invalid quantity' },
            403: { description: 'Idempotency key belongs to another customer' },
            409: { description: 'Sold out, insufficient tickets, or idempotency payload conflict' },
          },
        },
      },
      '/api/bookings/{id}': {
        get: {
          summary: 'Get Booking Details (Customer Owner Only)',
          tags: ['Bookings'],
          security: [{ BearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: { description: 'Booking details retrieved' },
            403: { description: 'Forbidden — You can only view your own bookings' },
            404: { description: 'Booking not found' },
          },
        },
      },
      '/api/bookings/{id}/cancel': {
        post: {
          summary: 'Cancel Booking & Restock Tickets (Customer Owner Only)',
          tags: ['Bookings'],
          security: [{ BearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: { description: 'Booking cancelled and tickets restocked to available inventory' },
            400: { description: 'Already cancelled or past event' },
            403: { description: 'Forbidden — You can only cancel your own bookings' },
            404: { description: 'Booking not found' },
          },
        },
      },
    },
  },
  apis: ['./src/routes/*.ts'],
};

export const swaggerSpec = swaggerJsdoc(swaggerOptions);
