import { logger } from '../../lib/logger';
import { fcmGateway } from './client';
import type { PushGateway } from './types';

/**
 * A gateway that does nothing, used when no service account is configured.
 *
 * Push has to degrade to silence rather than to an error: a deployment
 * without Firebase set up is a normal, supported state (it is how this app
 * ran before push existed), and a missing credential must never stop a
 * customer's message from being stored and delivered over the socket.
 */
const disabledGateway: PushGateway = {
  isConfigured: () => false,
  async send() {
    return { invalidTokens: [], successCount: 0, failureCount: 0 };
  },
};

let warned = false;

export function getPushGateway(): PushGateway {
  if (fcmGateway.isConfigured()) return fcmGateway;
  if (!warned) {
    warned = true;
    logger.warn(
      'FCM_SERVICE_ACCOUNT_JSON not set — push notifications are disabled; the app still receives messages live over Socket.IO while it is open',
    );
  }
  return disabledGateway;
}

export type { PushPayload, PushGateway, SendResult } from './types';
