import type { AppCtx } from '../app.js';
import { HttpError } from '../auth.js';

export async function webhookRoutes({ app, svc }: AppCtx) {
  // Payment-provider callbacks. Authenticity is proven per provider (HMAC / md5sig), never by IP or by trust.
  app.post('/api/webhooks/:provider', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (req, reply) => {
    const raw = req.rawBody;
    if (raw === undefined) throw new HttpError(400, 'bad_request', 'Unsupported content type');
    const r = await svc.handleWebhook((req.params as any).provider, req.headers, raw);
    return reply.status(200).send(r);
  });
}
