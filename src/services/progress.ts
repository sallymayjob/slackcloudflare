import type { Repositories } from '../db/repositories';
import type { HostConfig } from '../config';
import { err, ok } from '../errors';
import type { Result, SlackResponse } from '../types';
import { SlackBlocks } from '../slack/blocks';

export class ProgressService {
  constructor(private repos: Repositories, private config: HostConfig) {}

  async handleProgress(slackUserId: string): Promise<SlackResponse> {
    const snapshot = await this.getProgressSnapshot(slackUserId);
    if (!snapshot.ok) return { response_type: 'ephemeral', text: snapshot.message };
    return {
      response_type: 'ephemeral',
      text: 'Progress summary',
      blocks: SlackBlocks.buildProgressSummary({
        completedCount: Number(snapshot.completedCount || 0),
        overdueCount: Number(snapshot.overdueCount || 0),
        nextAction: String(snapshot.nextAction || ''),
      }),
    };
  }

  async handleReinforce(slackUserId: string): Promise<SlackResponse> {
    const snapshot = await this.getProgressSnapshot(slackUserId);
    if (!snapshot.ok) return { response_type: 'ephemeral', text: snapshot.message };
    const lessonId = String(snapshot.currentLesson || 'your current module');
    return {
      response_type: 'ephemeral',
      text: `Reinforcement focus: review ${lessonId} and resubmit with \`/submit ${lessonId} complete\`.`,
    };
  }

  async getProgressSnapshot(slackUserId: string): Promise<Result> {
    const learner = await this.repos.learnerRepo.findBySlackUserId(slackUserId);
    if (!learner) return err('LEARNER_NOT_FOUND', 'Learner not found.');

    const rows = await this.repos.progressRepo.findByLearnerId(learner.id);
    const completed = rows.filter((r) => r.state === 'completed').length;
    const inProgress = rows.filter((r) => r.state === 'in_progress' || r.state === 'started' || r.state === 'submitted').length;
    const active = rows.find((r) => r.state !== 'completed') || null;

    return ok('OK', {
      learnerId: learner.id,
      activeCourse: this.config.defaultCourseId,
      currentLesson: active ? active.lessonId : '',
      completedCount: completed,
      overdueCount: inProgress,
      nextAction: active ? `Complete lesson ${active.lessonId}` : 'Request next lesson',
      totalCount: rows.length,
    });
  }
}
