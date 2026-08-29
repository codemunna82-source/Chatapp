/**
 * OpenAPI spec, built up incrementally as modules are added (Phase 1 covers
 * auth + users; later phases append their own paths here rather than
 * introducing a second documentation mechanism).
 */
export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'VOXO API',
    version: '0.1.0',
    description: 'Multi-tenant WhatsApp communication platform backend.',
  },
  servers: [{ url: '/api' }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/auth/login': {
      post: {
        summary: 'Log in with email + password',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: { email: { type: 'string' }, password: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Access + refresh tokens issued' },
          '401': { description: 'Invalid credentials', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/auth/refresh': {
      post: {
        summary: 'Rotate a refresh token for a new access/refresh pair',
        security: [],
        responses: { '200': { description: 'New token pair issued' } },
      },
    },
    '/auth/logout': {
      post: {
        summary: 'Revoke a refresh token',
        security: [],
        responses: { '200': { description: 'Logged out' } },
      },
    },
    '/auth/change-password': {
      post: {
        summary: 'Change the authenticated user\'s password',
        responses: { '200': { description: 'Password changed' } },
      },
    },
    '/users': {
      get: { summary: 'List users in the caller\'s tenant (MASTER_ADMIN only)', responses: { '200': { description: 'OK' } } },
      post: { summary: 'Create a sub-user in the caller\'s tenant, optionally assigning the WhatsApp number they send from (MASTER_ADMIN only)', responses: { '201': { description: 'Created' } } },
    },
    '/users/{id}': {
      get: { summary: 'Get a user by id (tenant-scoped)', responses: { '200': { description: 'OK' } } },
      patch: { summary: 'Update a user (role, permissions, validity, status, assigned WhatsApp number)', responses: { '200': { description: 'OK' } } },
      delete: { summary: 'Disable a user (soft delete)', responses: { '200': { description: 'OK' } } },
    },
    '/whatsapp/numbers': {
      get: {
        summary: 'List the caller\'s tenant WhatsApp numbers, for assigning one to a user (MASTER_ADMIN only)',
        responses: { '200': { description: 'OK' } },
      },
    },
    '/contacts': {
      get: { summary: 'List contacts (cursor-paginated, optional search)', responses: { '200': { description: 'OK' } } },
      post: { summary: 'Create a contact', responses: { '201': { description: 'Created' } } },
    },
    '/contacts/{id}': {
      get: { summary: 'Get a contact by id', responses: { '200': { description: 'OK' } } },
      patch: { summary: 'Update a contact', responses: { '200': { description: 'OK' } } },
    },
    '/conversations': {
      get: {
        summary: 'List conversations (pinned-first, cursor-paginated, optional search/status filter)',
        responses: { '200': { description: 'OK' } },
      },
    },
    '/conversations/{id}': {
      get: { summary: 'Get a conversation by id', responses: { '200': { description: 'OK' } } },
      patch: {
        summary: 'Pin/unpin (CHAT_PIN) or archive a conversation',
        responses: { '200': { description: 'OK' } },
      },
    },
    '/conversations/{id}/messages': {
      get: { summary: 'List a conversation\'s messages (cursor-paginated, newest first)', responses: { '200': { description: 'OK' } } },
      post: {
        summary: 'Send a message (text/template/image/video/audio/document/reaction) — enforces the 24h customer-service window server-side',
        responses: {
          '201': { description: 'Sent' },
          '422': { description: 'Outside the 24h window and not a template — MESSAGE_TEMPLATE_REQUIRED', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/media/upload': {
      post: {
        summary: 'Upload a media file to Meta (multipart/form-data: file, whatsappPhoneNumberId)',
        responses: { '201': { description: 'Uploaded' } },
      },
    },
    '/media/{id}': {
      get: {
        summary: 'Proxy-stream a media file\'s bytes from Meta (never exposes the Meta access token to the client)',
        responses: { '200': { description: 'The raw file bytes, with the original Content-Type' } },
      },
    },
    '/templates': {
      get: { summary: 'List approved WhatsApp templates for the caller\'s tenant', responses: { '200': { description: 'OK' } } },
    },
    '/wallet': {
      get: { summary: 'Get the tenant\'s wallet balance (MASTER_ADMIN only)', responses: { '200': { description: 'OK' } } },
    },
    '/wallet/transactions': {
      get: { summary: 'List the tenant\'s wallet ledger entries, cursor-paginated (MASTER_ADMIN only)', responses: { '200': { description: 'OK' } } },
    },
    '/notifications': {
      get: { summary: 'List the caller\'s own notifications, cursor-paginated, optional unreadOnly filter', responses: { '200': { description: 'OK' } } },
    },
    '/notifications/read-all': {
      post: { summary: 'Mark all of the caller\'s unread notifications as read', responses: { '200': { description: 'OK' } } },
    },
    '/notifications/{id}/read': {
      patch: { summary: 'Mark one notification as read', responses: { '200': { description: 'OK' }, '404': { description: 'Not found' } } },
    },
    '/subscription': {
      get: {
        summary: 'Get the tenant\'s current subscription plan and live-computed status (MASTER_ADMIN only)',
        responses: { '200': { description: 'OK' }, '404': { description: 'No subscription record exists' } },
      },
    },
    '/dashboard': {
      get: {
        summary: 'Aggregated tenant analytics — contact/conversation/message counts and a 14-day message time series (ANALYTICS_VIEW)',
        responses: { '200': { description: 'OK' } },
      },
    },
    '/calls': {
      get: {
        summary: 'List the tenant\'s call history, cursor-paginated (CALL_HISTORY)',
        responses: { '200': { description: 'OK' } },
      },
      post: {
        summary:
          'Log a call and return a wa.me deep link to hand off into the real WhatsApp app for the actual call (CALL_ACCESS) — no third-party app, including this one, can start a live call inside WhatsApp itself',
        responses: { '201': { description: 'Logged' }, '404': { description: 'Contact not found' } },
      },
    },
    '/health': { get: { summary: 'Liveness probe', security: [], responses: { '200': { description: 'OK' } } } },
    '/ready': { get: { summary: 'Readiness probe', security: [], responses: { '200': { description: 'OK' }, '503': { description: 'Not ready' } } } },
  },
};
