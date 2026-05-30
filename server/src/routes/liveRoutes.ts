import { Router } from 'express';
import { addLiveClient } from '../services/liveEvents.js';

export function liveRouter() {
  const router = Router();

  router.get('/', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.flushHeaders?.();
    addLiveClient(req.deviceId, res);
  });

  return router;
}
