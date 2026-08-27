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
      post: { summary: 'Create a sub-user in the caller\'s tenant (MASTER_ADMIN only)', responses: { '201': { description: 'Created' } } },
    },
    '/users/{id}': {
      get: { summary: 'Get a user by id (tenant-scoped)', responses: { '200': { description: 'OK' } } },
      patch: { summary: 'Update a user (role, permissions, validity, status)', responses: { '200': { description: 'OK' } } },
      delete: { summary: 'Disable a user (soft delete)', responses: { '200': { description: 'OK' } } },
    },
    '/health': { get: { summary: 'Liveness probe', security: [], responses: { '200': { description: 'OK' } } } },
    '/ready': { get: { summary: 'Readiness probe', security: [], responses: { '200': { description: 'OK' }, '503': { description: 'Not ready' } } } },
  },
};
