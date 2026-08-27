import type { Request, Response } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { getTenantContext } from '../../middleware/tenantContext.middleware';
import { listApprovedTemplates } from './messageTemplate.service';

export const listTemplatesHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = getTenantContext(req);
  const templates = await listApprovedTemplates(auth.tenantId);
  res.status(200).json({
    success: true,
    data: templates.map((t) => ({
      id: String(t._id),
      name: t.name,
      language: t.language,
      category: t.category,
      status: t.status,
      components: t.components,
    })),
  });
});
