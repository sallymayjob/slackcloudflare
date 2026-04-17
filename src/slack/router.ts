import type { ParsedSlackRequest, RequestContext, SlackResponse } from '../types';
import { SlackDispatcher } from './dispatcher';

export interface RouteOutcome {
  ok: boolean;
  code: string;
  response: SlackResponse;
}

export class SlackRouter {
  constructor(private dispatcher: SlackDispatcher) {}

  async route(parsed: ParsedSlackRequest, ctx: RequestContext): Promise<RouteOutcome> {
    if (!parsed.ok) {
      return {
        ok: false,
        code: 'PARSE_FAILED',
        response: { ok: false, code: 'PARSE_FAILED', text: 'invalid_request' },
      };
    }

    if (parsed.routeType === 'url_verification') {
      return {
        ok: true,
        code: 'URL_VERIFICATION',
        response: { challenge: String((parsed.body as any)?.challenge || '') },
      };
    }

    switch (parsed.routeType) {
      case 'slash_command': {
        const response = await this.dispatcher.handleSlashCommand(parsed, ctx);
        return { ok: true, code: 'SLASH_COMMAND', response };
      }
      case 'interactivity': {
        const response = await this.dispatcher.handleInteractivity(parsed, ctx);
        return { ok: true, code: 'INTERACTIVITY', response };
      }
      case 'event_callback': {
        const response = await this.dispatcher.handleEventCallback(parsed, ctx);
        return { ok: true, code: 'EVENT_CALLBACK', response };
      }
      case 'workflow_webhook': {
        const response = await this.dispatcher.handleWorkflowWebhook(parsed, ctx);
        return { ok: true, code: 'WORKFLOW_WEBHOOK', response };
      }
      default:
        return {
          ok: false,
          code: 'UNSUPPORTED_ROUTE',
          response: { ok: false, code: 'UNSUPPORTED_ROUTE', text: `unsupported_route: ${parsed.routeType}` },
        };
    }
  }
}
