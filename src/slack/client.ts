import type { HostConfig } from '../config';
import { err, ok } from '../errors';
import type { Result } from '../types';

export interface SlackCallResult<T = unknown> {
  ok: boolean;
  code: string;
  message?: string;
  retryable?: boolean;
  method?: string;
  status?: number;
  data?: T;
  channelId?: string;
}

export class SlackApiClient {
  private readonly token: string;

  constructor(private readonly config: HostConfig) {
    this.token = config.slackBotToken;
  }

  async postMessage(channel: string, text: string, blocks: unknown[] = []): Promise<SlackCallResult> {
    if (this.isQuietHours()) {
      return { ok: false, code: 'QUIET_HOURS', message: 'Message suppressed during quiet hours.', retryable: false };
    }
    return this.call('chat.postMessage', { channel, text, blocks });
  }

  postEphemeral(channel: string, user: string, text: string, blocks: unknown[] = []): Promise<SlackCallResult> {
    return this.call('chat.postEphemeral', { channel, user, text, blocks });
  }

  openView(triggerId: string, view: unknown): Promise<SlackCallResult> {
    return this.call('views.open', { trigger_id: triggerId, view });
  }

  updateMessage(channel: string, ts: string, text: string, blocks: unknown[] = []): Promise<SlackCallResult> {
    return this.call('chat.update', { channel, ts, text, blocks });
  }

  async openDm(userId: string): Promise<SlackCallResult<{ channel?: { id?: string } }>> {
    const res = await this.call<{ channel?: { id?: string } }>('conversations.open', { users: userId });
    return {
      ok: !!res.ok,
      code: res.code,
      message: res.message,
      retryable: !!res.retryable,
      method: res.method || 'conversations.open',
      status: res.status,
      channelId: res.data?.channel?.id || '',
    };
  }

  async fetchMessageByTs(channel: string, ts: string) {
    const res = await this.call<{ messages?: Array<Record<string, unknown>> }>('conversations.history', {
      channel,
      oldest: ts,
      latest: ts,
      inclusive: true,
      limit: 1,
    });
    const message = res.data?.messages?.[0] || null;
    return {
      ok: !!res.ok && !!message,
      code: message ? 'OK' : res.code || 'MESSAGE_NOT_FOUND',
      message,
    };
  }

  private isQuietHours(): boolean {
    const { quietHoursStart: start, quietHoursEnd: end } = this.config;
    // Preserve original logic: shift UTC by +12 and wrap to simulate a local day window.
    let hour = new Date().getUTCHours() + 12;
    hour = hour % 24;
    if (start > end) return hour >= start || hour < end;
    return hour >= start && hour < end;
  }

  private async call<T = unknown>(method: string, payload: Record<string, unknown>): Promise<SlackCallResult<T>> {
    if (!this.token) {
      return { ok: false, code: 'MISSING_BOT_TOKEN', message: 'SLACK_BOT_TOKEN missing', retryable: false, method };
    }

    let response: Response;
    try {
      response = await fetch(`https://slack.com/api/${method}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(payload || {}),
      });
    } catch (e) {
      return {
        ok: false,
        code: 'HTTP_FETCH_FAILED',
        message: e instanceof Error ? e.message : String(e),
        retryable: true,
        method,
      };
    }

    const status = response.status;
    let body: Record<string, unknown> = {};
    try {
      body = (await response.json()) as Record<string, unknown>;
    } catch {
      body = { ok: false, error: 'invalid_json' };
    }

    if (status < 200 || status >= 300 || !body.ok) {
      return {
        ok: false,
        code: (body.error as string) || 'SLACK_API_ERROR',
        message: `Slack API call failed for ${method}`,
        retryable: status >= 500 || body.error === 'ratelimited',
        method,
        status,
        data: body as T,
      };
    }

    return { ok: true, code: 'OK', message: 'success', data: body as T, method, status };
  }
}

export function coerceSlackResult(res: SlackCallResult): Result {
  if (res.ok) return ok(res.code || 'OK', { data: res.data });
  return err(res.code || 'SLACK_API_ERROR', res.message || 'Slack API error', {
    retryable: !!res.retryable,
  });
}
