import type { Db } from '../db/db';
import type { Repositories } from '../db/repositories';
import type { HostConfig } from '../config';
import type { ParsedSlackRequest, SlackResponse } from '../types';
import { sanitizeInput } from '../util';

export class OnboardingService {
  constructor(private db: Db, private repos: Repositories, private config: HostConfig) {}

  async startOnboarding(input: {
    requestorUserId: string;
    targetEmail: string;
    source: string;
  }): Promise<SlackResponse> {
    const targetEmail = sanitizeInput(input.targetEmail);
    if (!targetEmail) {
      return { response_type: 'ephemeral', text: 'Usage: /onboard [email]' };
    }
    const row = await this.db.table('onboarding_requests').insert({
      requestorUserId: input.requestorUserId,
      targetEmail,
      courseId: this.config.defaultCourseId,
      source: input.source,
      status: 'pending',
    });
    await this.db.audit('onboarding_started', 'onboarding_requests', {
      resourceId: row.id,
      requestorUserId: input.requestorUserId,
      targetEmail,
    });
    return {
      response_type: 'ephemeral',
      text: `:inbox_tray: Onboarding request captured for ${targetEmail}.`,
    };
  }

  async advanceOnboardingState(
    learnerId: string,
    checklistItemId: string,
    status: string
  ): Promise<void> {
    await this.db.table('onboarding_checklists').update(checklistItemId, {
      status: sanitizeInput(status) || 'completed',
    });
    await this.db.table('onboarding_task_log').insert({
      checklistItemId,
      learnerId,
      eventType: 'status_change',
      eventBy: learnerId,
      note: `Status set to ${status}`,
    });
  }

  async handleAuditQuery(_parsed: ParsedSlackRequest): Promise<SlackResponse> {
    const { results } = await this.db
      .raw()
      .prepare(
        `SELECT action, COUNT(*) as count FROM audit_log
         WHERE createdAt > datetime('now', '-7 days')
         GROUP BY action ORDER BY count DESC LIMIT 10`
      )
      .all<{ action: string; count: number }>();
    const lines = (results || []).map((r) => `• ${r.action}: ${r.count}`);
    return {
      response_type: 'ephemeral',
      text: lines.length
        ? `Audit summary (last 7d):\n${lines.join('\n')}`
        : 'No recent audit events.',
    };
  }

  async handleOffboard(parsed: ParsedSlackRequest): Promise<SlackResponse> {
    const email = sanitizeInput(parsed.params.text || '');
    if (!email) return { response_type: 'ephemeral', text: 'Usage: /offboard [email]' };
    await this.db.audit('offboard_requested', 'learners', {
      requestorUserId: parsed.userId,
      targetEmail: email,
    });
    return { response_type: 'ephemeral', text: `:outbox_tray: Offboarding recorded for ${email}.` };
  }
}
