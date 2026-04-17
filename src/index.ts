import { Hono } from 'hono';
import type { Env, IngressJob } from '../worker-configuration';
import { buildContainer } from './container';
import { parseSlackRequest } from './parser';
import { verifySlackRequest } from './security';
import { SlackDispatcher } from './slack/dispatcher';
import { SlackRouter } from './slack/router';
import { handleScheduled } from './schedules';
import { handleIngressBatch } from './ingress/consumer';
import { correlationId, sanitizeForLog } from './util';

const app = new Hono<{ Bindings: Env }>();

app.get('/', (c) => c.text('alive'));
app.get('/healthz', (c) => c.json({ ok: true }));

// Single Slack ingress endpoint. Mirrors the original doPost() design:
//   parse -> security -> route -> respond (JSON)
app.post('/slack/events', async (c) => {
  const reqId = correlationId();
  const env = c.env;
  const deps = buildContainer(env);

  try {
    const parsed = await parseSlackRequest(c.req.raw);
    const verified = await verifySlackRequest(parsed, deps.config, env.REPLAY_CACHE);

    if (!verified.ok) {
      await deps.db.audit('request_denied', 'slack_ingress', {
        correlationId: reqId,
        code: verified.code,
        routeType: parsed.routeType,
      });
      return c.json(verified, 401);
    }

    const router = new SlackRouter(new SlackDispatcher(deps));
    const routed = await router.route(parsed, { correlationId: reqId });

    await deps.db.audit('request_routed', 'slack_ingress', {
      correlationId: reqId,
      routeType: parsed.routeType,
      ok: !!routed.ok,
      code: routed.code,
    });

    return c.json(routed.response, 200);
  } catch (err) {
    console.log(
      JSON.stringify(
        sanitizeForLog({
          action: 'doPost_error',
          correlationId: reqId,
          message: err instanceof Error ? err.message : String(err),
        })
      )
    );
    return c.json(
      {
        ok: false,
        code: 'HOST_ERROR',
        message: 'Something went wrong in the Slack handler.',
        correlationId: reqId,
      },
      500
    );
  }
});

export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const deps = buildContainer(env);
    ctx.waitUntil(
      handleScheduled(event, deps).then(async (result) => {
        await deps.db.audit('scheduled_run', 'cron', {
          cron: event.cron,
          result: JSON.stringify(result ?? {}),
        });
      })
    );
  },

  async queue(batch: MessageBatch<IngressJob>, env: Env): Promise<void> {
    const deps = buildContainer(env);
    await handleIngressBatch(batch, deps);
  },
};
