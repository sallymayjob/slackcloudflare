import type { Db } from '../db/db';
import type { SlackResponse } from '../types';
import type { HostConfig } from '../config';
import { SlackBlocks } from '../slack/blocks';

export interface WeeklySummary {
  ok: true;
  learnerCount: number;
  activeEnrollments: number;
  completedLessons: number;
  pendingQueue: number;
  failedJobs: number;
}

export class ReportService {
  constructor(private db: Db, private config: HostConfig) {}

  async buildAdminDashboard(_requestorUserId: string): Promise<Record<string, number>> {
    return this.gatherCounts();
  }

  async buildWeeklySummary(): Promise<WeeklySummary> {
    const counts = await this.gatherCounts();
    return { ok: true, ...counts };
  }

  async handleGaps(): Promise<SlackResponse> {
    const { results } = await this.db
      .raw()
      .prepare(
        `SELECT state, COUNT(*) as count FROM learner_progress
         WHERE state IN ('overdue', 'started', 'submitted')
         GROUP BY state`
      )
      .all<{ state: string; count: number }>();
    const lines = (results || []).map((r) => `• ${r.state}: ${r.count}`);
    return {
      response_type: 'ephemeral',
      text: lines.length
        ? `Learning gaps snapshot:\n${lines.join('\n')}`
        : 'No current gaps detected.',
    };
  }

  async buildSummaryBlocks(): Promise<unknown[]> {
    const counts = await this.gatherCounts();
    return SlackBlocks.buildAdminSummary(counts);
  }

  private async gatherCounts(): Promise<{
    learnerCount: number;
    activeEnrollments: number;
    completedLessons: number;
    pendingQueue: number;
    failedJobs: number;
  }> {
    const q = async (sql: string): Promise<number> => {
      const row = await this.db.raw().prepare(sql).first<{ count: number }>();
      return Number(row?.count || 0);
    };
    return {
      learnerCount: await q('SELECT COUNT(*) as count FROM learners WHERE status = "active"'),
      activeEnrollments: await q('SELECT COUNT(*) as count FROM enrollment WHERE status = "active"'),
      completedLessons: await q('SELECT COUNT(*) as count FROM learner_progress WHERE state = "completed"'),
      pendingQueue: await q('SELECT COUNT(*) as count FROM delivery_queue WHERE status = "queued"'),
      failedJobs: await q('SELECT COUNT(*) as count FROM retry_queue WHERE status = "failed"'),
    };
  }
}
