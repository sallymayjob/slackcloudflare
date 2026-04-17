import type { ParsedSlackRequest, SlackRouteType } from './types';
import { pickString, safeJsonParse } from './util';

export async function parseSlackRequest(request: Request): Promise<ParsedSlackRequest> {
  const contentType = (request.headers.get('content-type') || '').toLowerCase();
  const rawBody = await request.text();
  const headers = request.headers;

  let params: Record<string, string> = {};
  let body: Record<string, unknown> = {};
  let parseOk = true;

  if (contentType.includes('application/json')) {
    const json = safeJsonParse<Record<string, unknown>>(rawBody);
    if (json === null && rawBody) parseOk = false;
    body = json || {};
  } else if (contentType.includes('application/x-www-form-urlencoded')) {
    const form = new URLSearchParams(rawBody);
    for (const [k, v] of form.entries()) params[k] = v;
  }

  let interaction: Record<string, unknown> | null = null;
  if (params.payload) {
    interaction = safeJsonParse<Record<string, unknown>>(params.payload);
  }

  let routeType: SlackRouteType = 'unknown';
  if (body.type === 'url_verification') routeType = 'url_verification';
  else if (params.command) routeType = 'slash_command';
  else if (interaction) routeType = 'interactivity';
  else if (body.type === 'event_callback') routeType = 'event_callback';
  else if (body.workflow || body.workflow_step || params.workflow) routeType = 'workflow_webhook';

  const source: unknown = interaction || body || params;

  return {
    ok: parseOk,
    routeType,
    rawBody,
    body,
    params,
    command: String(params.command || ''),
    payloadType: String((interaction as any)?.type || body.type || ''),
    userId: pickString(source, ['user.id', 'user_id', 'event.user']),
    channelId: pickString(source, ['channel.id', 'channel_id', 'event.channel']),
    teamId: pickString(source, ['team.id', 'team_id']),
    triggerId: pickString(source, ['trigger_id']),
    responseUrl: pickString(source, ['response_url']),
    slackSignature: headers.get('x-slack-signature') || '',
    slackTimestamp: headers.get('x-slack-request-timestamp') || '',
    interaction,
    parseError: parseOk ? '' : 'Invalid JSON body',
  };
}
