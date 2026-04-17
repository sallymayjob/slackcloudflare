import type { Db } from '../db/db';
import type { Repositories } from '../db/repositories';
import type { SlackApiClient } from '../slack/client';
import { SlackBlocks } from '../slack/blocks';
import type { HostConfig } from '../config';
import type { LearnerProgress } from '../types';

export class ReminderService {
  constructor(
    private db: Db,
    private repos: Repositories,
    private slack: SlackApiClient,
    private config: HostConfig
  ) {}

  async sendOverdueReminders(): Promise<{ ok: true; total: number; sent: number }> {
    const rows = await this.db
      .table<LearnerProgress>('learner_progress')
      .findAll();
    const stuck = rows.filter((r) => r.state === 'in_progress' || r.state === 'started' || r.state === 'submitted');
    let sent = 0;
    for (const row of stuck) {
      const learner = await this.repos.learnerRepo.findById(row.learnerId);
      if (!learner) continue;
      const dm = await this.slack.openDm(learner.slackUserId);
      if (!dm.ok || !dm.channelId) continue;
      const res = await this.slack.postMessage(dm.channelId, 'Lesson reminder', SlackBlocks.buildReminder({ learnerId: learner.id }));
      if (res.ok) sent += 1;
    }
    return { ok: true, total: stuck.length, sent };
  }
}
