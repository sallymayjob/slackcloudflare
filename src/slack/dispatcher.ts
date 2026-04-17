import type { ParsedSlackRequest, RequestContext, SlackResponse } from '../types';
import type { ServiceContainer } from '../container';
import { sanitizeInput } from '../util';
import { isAdmin } from '../config';

type Handler = (parsed: ParsedSlackRequest, ctx: RequestContext) => Promise<SlackResponse>;

export class SlackDispatcher {
  private readonly slashRegistry: Record<string, Handler>;

  constructor(private deps: ServiceContainer) {
    this.slashRegistry = {
      '/learn': this.queueSlash('slash.learn'),
      '/submit': this.queueSlashSubmit.bind(this),
      '/progress': this.handleProgress.bind(this),
      '/help': this.handleHelp.bind(this),
      '/enroll': this.queueSlashEnroll.bind(this),
      '/report': this.handleReport.bind(this),
      '/onboard': this.handleOnboard.bind(this),
      '/gaps': this.handleGaps.bind(this),
      '/audit': this.handleAudit.bind(this),
      '/mix': this.queueSlash('slash.mix'),
      '/reinforce': this.handleReinforce.bind(this),
      '/offboard': this.handleOffboard.bind(this),
    };
  }

  async handleSlashCommand(parsed: ParsedSlackRequest, ctx: RequestContext): Promise<SlackResponse> {
    if (!parsed.command) {
      return { response_type: 'ephemeral', text: 'Missing slash command context.' };
    }
    const handler = this.slashRegistry[parsed.command];
    if (!handler) return { response_type: 'ephemeral', text: `Unsupported command: ${parsed.command}` };
    return handler(parsed, ctx);
  }

  async handleInteractivity(parsed: ParsedSlackRequest, ctx: RequestContext): Promise<SlackResponse> {
    const payload = (parsed.interaction || {}) as Record<string, any>;
    const action = (payload.actions && payload.actions[0]) || {};
    const actionId = String(action.action_id || '');
    const type = String(payload.type || '');

    if (type === 'view_submission') {
      const values = (payload.view?.state?.values || {}) as Record<string, any>;
      const lessonId = sanitizeInput(values?.lesson?.lesson_id?.value || '');
      const notes = sanitizeInput(values?.notes?.notes_value?.value || '');
      const queued = await this.deps.ingressQueue.appendJob({
        routeType: 'interactivity',
        jobType: 'interactivity.modal_submission',
        payload: {
          slackUserId: payload.user?.id || parsed.userId,
          lessonId,
          payload: JSON.stringify({ notes, source: 'modal_submission' }),
        },
        requestMeta: this.buildRequestMeta(parsed, ctx),
      });
      if (!queued.ok) {
        return { response_action: 'errors', errors: { lesson: queued.message || 'Unable to queue submission.' } };
      }
      return { response_action: 'clear' };
    }

    if (actionId.startsWith('checklist_mark_')) {
      const queued = await this.deps.ingressQueue.appendJob({
        routeType: 'interactivity',
        jobType: 'interactivity.checklist_mark',
        payload: {
          learnerId: payload.user?.id || '',
          checklistItemId: actionId.replace('checklist_mark_', ''),
          status: action.value || 'completed',
        },
        requestMeta: this.buildRequestMeta(parsed, ctx),
      });
      return {
        response_type: 'ephemeral',
        text: queued.ok
          ? ':hourglass_flowing_sand: Checklist update queued.'
          : queued.message || 'Checklist update failed.',
      };
    }

    if (actionId === 'submit_lesson') {
      const lessonId = sanitizeInput(action.value || '');
      const queued = await this.deps.ingressQueue.appendJob({
        routeType: 'interactivity',
        jobType: 'interactivity.submit_lesson',
        payload: {
          slackUserId: parsed.userId,
          lessonId,
          payload: JSON.stringify(payload),
          idempotencyKey: `submit:${parsed.userId}:${lessonId}:complete`,
        },
        requestMeta: this.buildRequestMeta(parsed, ctx),
      });
      return {
        response_type: 'ephemeral',
        text: queued.ok
          ? ':white_check_mark: Lesson submitted.'
          : queued.message || queued.code,
      };
    }

    return { response_type: 'ephemeral', text: 'Action received. Use /help to see supported actions.' };
  }

  async handleEventCallback(parsed: ParsedSlackRequest, ctx: RequestContext): Promise<SlackResponse> {
    const event = ((parsed.body as any)?.event || {}) as Record<string, any>;

    if (event.type === 'reaction_added') {
      return this.handleReactionAdded(parsed, event);
    }

    if (event.type === 'app_mention') {
      await this.deps.ingressQueue.appendJob({
        routeType: 'event_callback',
        jobType: 'event.app_mention',
        payload: {
          userId: event.user || parsed.userId,
          channelId: event.channel || parsed.channelId,
          text: event.text || '',
        },
        requestMeta: this.buildRequestMeta(parsed, ctx),
      });
      return { ok: true, text: 'Event queued' };
    }

    if (event.type === 'message' && event.channel_type === 'im') {
      await this.deps.ingressQueue.appendJob({
        routeType: 'event_callback',
        jobType: 'event.message_im',
        payload: {
          userId: event.user || parsed.userId,
          channelId: event.channel || parsed.channelId,
          text: event.text || '',
        },
        requestMeta: this.buildRequestMeta(parsed, ctx),
      });
      return { ok: true, text: 'Event queued' };
    }

    return { ok: true, text: 'Event ignored', eventType: event.type || '' };
  }

  async handleWorkflowWebhook(parsed: ParsedSlackRequest, ctx: RequestContext): Promise<SlackResponse> {
    const data = ((parsed.body as any)?.data || {}) as Record<string, unknown>;
    const slackUserId = sanitizeInput(data.user_id || parsed.params.user_id || '');
    if (!slackUserId) return { ok: false, code: 'INVALID_WORKFLOW_PAYLOAD', text: 'Missing user_id' };

    const queued = await this.deps.ingressQueue.appendJob({
      routeType: 'workflow_webhook',
      jobType: 'workflow.enroll',
      payload: {
        slackUserId,
        email: sanitizeInput(data.email || parsed.params.email || ''),
        name: sanitizeInput(data.name || parsed.params.name || ''),
        courseId:
          sanitizeInput(data.course_id || parsed.params.course_id || '') ||
          this.deps.config.defaultCourseId,
      },
      requestMeta: this.buildRequestMeta(parsed, ctx),
    });
    return queued;
  }

  private async handleReactionAdded(
    parsed: ParsedSlackRequest,
    event: Record<string, any>
  ): Promise<SlackResponse> {
    const reaction = String(event.reaction || '').toLowerCase();
    if (reaction !== 'white_check_mark' && reaction !== '✅') {
      return { ok: true, text: 'Reaction ignored' };
    }

    const eventId = sanitizeInput((parsed.body as any)?.event_id || '');
    if (!eventId) return { ok: true, text: 'Reaction ignored' };
    const replayKey = `slack_event_reaction_${eventId}`;
    const seen = await this.deps.env.REPLAY_CACHE.get(replayKey);
    if (seen) return { ok: true, text: 'Reaction ignored', reason: 'duplicate_event' };
    await this.deps.env.REPLAY_CACHE.put(replayKey, '1', { expirationTtl: 60 * 60 * 6 });

    const slackUserId = sanitizeInput(event.user || '');
    const channel = sanitizeInput(event.item?.channel || '');
    const ts = sanitizeInput(event.item?.ts || event.event_ts || '');
    if (!slackUserId || !channel || !ts) return { ok: true, text: 'Reaction ignored', reason: 'MALFORMED_REACTION' };

    const lookedUp = await this.deps.slackApiClient.fetchMessageByTs(channel, ts);
    if (!lookedUp.ok || !lookedUp.message) return { ok: true, text: 'Reaction ignored', reason: 'LESSON_NOT_FOUND' };
    const lessonId = this.extractLessonId(lookedUp.message);
    if (!lessonId) return { ok: true, text: 'Reaction ignored', reason: 'LESSON_CONTEXT_NOT_FOUND' };

    const submission = await this.deps.completionService.recordSubmission({
      slackUserId,
      lessonId,
      payload: JSON.stringify({ source: 'reaction_added', event_id: eventId, channel, ts }),
      idempotencyKey: `submit:${slackUserId}:${lessonId}:complete`,
      auditMeta: { source: 'reaction_added', event_id: eventId, channel, ts },
    });

    return {
      ok: true,
      text: submission.ok ? 'Reaction submission processed' : submission.message || submission.code,
    };
  }

  private extractLessonId(message: Record<string, any>): string {
    const metadata = message.metadata || {};
    const payload = metadata.event_payload || {};
    const candidate =
      payload.lessonId || payload.lesson_id || metadata.lessonId || metadata.lesson_id || '';
    if (candidate) return sanitizeInput(candidate);

    if (Array.isArray(message.blocks)) {
      for (const block of message.blocks) {
        if (block?.type !== 'context' || !Array.isArray(block.elements)) continue;
        for (const el of block.elements) {
          const text = String(el?.text || '');
          const match = text.match(/[A-Z0-9]+-[A-Z0-9-]+/);
          if (match) return sanitizeInput(match[0]);
        }
      }
    }

    const textBody = String(message.text || '');
    const match = textBody.match(/\/submit\s+([A-Za-z0-9-]+)\s+complete/i);
    if (match) return sanitizeInput(match[1]);
    return '';
  }

  // ---- Slash handlers ----

  private queueSlash(jobType: string): Handler {
    return async (parsed, ctx) => {
      const queued = await this.deps.ingressQueue.appendJob({
        routeType: 'slash_command',
        jobType,
        payload: { userId: parsed.userId },
        requestMeta: this.buildRequestMeta(parsed, ctx),
      });
      return queued.ok
        ? {
            response_type: 'ephemeral',
            text: 'Queued your next lesson for delivery. You will receive it in DM shortly.',
            job_id: String((queued as any).jobId || ''),
          }
        : { response_type: 'ephemeral', text: queued.message || queued.code || 'Unable to queue lesson right now.' };
    };
  }

  private async queueSlashSubmit(parsed: ParsedSlackRequest, ctx: RequestContext): Promise<SlackResponse> {
    const parts = String(parsed.params.text || '').trim().split(/\s+/);
    const lessonId = sanitizeInput(parts[0] || '');
    const keyword = (parts[1] || '').toLowerCase();
    if (keyword !== 'complete' || !lessonId) {
      return { response_type: 'ephemeral', text: 'Usage: /submit <lesson_id> complete' };
    }

    const queued = await this.deps.ingressQueue.appendJob({
      routeType: 'slash_command',
      jobType: 'slash.submit',
      payload: {
        slackUserId: parsed.userId,
        lessonId,
        payload: parsed.rawBody || JSON.stringify(parsed.params || {}),
        idempotencyKey: `submit:${parsed.userId}:${lessonId}:complete`,
      },
      requestMeta: this.buildRequestMeta(parsed, ctx),
    });

    return queued.ok
      ? { response_type: 'ephemeral', text: `Submission queued for ${lessonId}.` }
      : { response_type: 'ephemeral', text: queued.message || queued.code || 'Unable to queue submission.' };
  }

  private async queueSlashEnroll(parsed: ParsedSlackRequest, ctx: RequestContext): Promise<SlackResponse> {
    const courseId = sanitizeInput(parsed.params.text || '') || this.deps.config.defaultCourseId;
    const queued = await this.deps.ingressQueue.appendJob({
      routeType: 'slash_command',
      jobType: 'slash.enroll',
      payload: { slackUserId: parsed.userId, courseId },
      requestMeta: this.buildRequestMeta(parsed, ctx),
    });
    return queued.ok
      ? {
          response_type: 'ephemeral',
          text: 'Enrollment request queued. You will get a DM shortly.',
        }
      : { response_type: 'ephemeral', text: queued.message || queued.code || 'Unable to queue enrollment.' };
  }

  private handleProgress(parsed: ParsedSlackRequest): Promise<SlackResponse> {
    return this.deps.progressService.handleProgress(parsed.userId);
  }

  private async handleHelp(): Promise<SlackResponse> {
    return {
      response_type: 'ephemeral',
      text: 'Commands: /learn, /submit <lesson_id> complete, /progress, /help, /enroll [courseId], /report, /onboard [email], /gaps, /audit, /mix, /reinforce, /offboard [email]',
    };
  }

  private handleReinforce(parsed: ParsedSlackRequest): Promise<SlackResponse> {
    return this.deps.progressService.handleReinforce(parsed.userId);
  }

  private async handleOnboard(parsed: ParsedSlackRequest): Promise<SlackResponse> {
    const guard = this.requireAdmin(parsed, '/onboard');
    if (guard) return guard;
    const email = sanitizeInput(parsed.params.text || '');
    return this.deps.onboardingService.startOnboarding({
      requestorUserId: parsed.userId,
      targetEmail: email,
      source: 'slash_command',
    });
  }

  private async handleReport(parsed: ParsedSlackRequest): Promise<SlackResponse> {
    const guard = this.requireAdmin(parsed, '/report');
    if (guard) return guard;
    const blocks = await this.deps.reportService.buildSummaryBlocks();
    return { response_type: 'ephemeral', text: 'Admin report', blocks };
  }

  private handleGaps(): Promise<SlackResponse> {
    return this.deps.reportService.handleGaps();
  }

  private async handleAudit(parsed: ParsedSlackRequest): Promise<SlackResponse> {
    const guard = this.requireAdmin(parsed, '/audit');
    if (guard) return guard;
    return this.deps.onboardingService.handleAuditQuery(parsed);
  }

  private async handleOffboard(parsed: ParsedSlackRequest): Promise<SlackResponse> {
    const guard = this.requireAdmin(parsed, '/offboard');
    if (guard) return guard;
    return this.deps.onboardingService.handleOffboard(parsed);
  }

  private requireAdmin(parsed: ParsedSlackRequest, commandName: string): SlackResponse | null {
    if (isAdmin(this.deps.config, parsed.userId)) return null;
    return { response_type: 'ephemeral', text: `:lock: ${commandName} is restricted to admins.` };
  }

  private buildRequestMeta(parsed: ParsedSlackRequest, ctx: RequestContext) {
    return {
      correlationId: ctx.correlationId,
      teamId: parsed.teamId || '',
      userId: parsed.userId || '',
      command: parsed.command || '',
    };
  }
}
