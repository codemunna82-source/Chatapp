import { Types } from 'mongoose';
import { AuditLog } from './auditLog.model';
import { logger } from '../../lib/logger';

export interface RecordAuditParams {
  tenantId: string | Types.ObjectId;
  actorUserId?: string | Types.ObjectId;
  action: string;
  targetType?: string;
  targetId?: string | Types.ObjectId;
  metadata?: Record<string, unknown>;
  ip?: string;
}

/**
 * Fire-and-forget-ish audit write: failures are logged, never thrown, so a
 * logging outage can't take down the request it's describing.
 */
export async function recordAudit(params: RecordAuditParams): Promise<void> {
  try {
    await AuditLog.create({
      tenantId: params.tenantId,
      actorUserId: params.actorUserId,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      metadata: params.metadata,
      ip: params.ip,
    });
  } catch (err) {
    logger.error({ err, action: params.action }, 'Failed to write audit log');
  }
}
