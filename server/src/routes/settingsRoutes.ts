import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { getWorkspaceSettings, updateWorkspaceSettings } from '../services/workspaceSettingsService.js';
import { invalidateWorkspaceReads } from '../services/cacheInvalidation.js';

export function settingsRouter() {
  const router = Router();

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await getWorkspaceSettings(req.deviceId));
    } catch (error) {
      next(error);
    }
  });

  router.patch('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const settings = await updateWorkspaceSettings(req.deviceId, req.body || {});
      await invalidateWorkspaceReads(req.deviceId).catch(() => undefined);
      res.json(settings);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
