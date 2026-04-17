import type { Db } from '../db/db';
import type { Repositories } from '../db/repositories';
import type { HostConfig } from '../config';
import { LearnerProgressStateMachine } from './stateMachine';
import { err, ok } from '../errors';
import type { Result } from '../types';
import { nowIso, sanitizeInput } from '../util';

export interface SubmissionInput {
  slackUserId: string;
  lessonId: string;
  payload?: string;
  idempotencyKey?: string;
  auditMeta?: Record<string, unknown>;
}

export class CompletionService {
  constructor(
    private db: Db,
    private repos: Repositories,
    private state: LearnerProgressStateMachine,
    private config: HostConfig
  ) {}

  async recordSubmission(input: SubmissionInput): Promise<Result> {
    const learner = await this.repos.learnerRepo.findBySlackUserId(input.slackUserId);
    if (!learner) return err('LEARNER_NOT_FOUND', 'Learner not found.');

    const lessonId = sanitizeInput(input.lessonId || '');
    if (!lessonId) return err('INVALID_INPUT', 'lessonId is required.');

    const submitKey = sanitizeInput(input.idempotencyKey || '') || `${learner.id}:${lessonId}`;
    const existing = await this.db.table('submission_log').findOne({ submitKey });

    let submissionId: string;
    if (existing) {
      const updated = await this.db.table('submission_log').update(String(existing.id), {
        payload: input.payload || '',
      });
      submissionId = String(updated?.id ?? existing.id);
    } else {
      const inserted = await this.db.table('submission_log').insert({
        learnerId: learner.id,
        lessonId,
        submitKey,
        payload: input.payload || '',
      });
      submissionId = String(inserted.id);
    }

    const progressRow = await this.repos.progressRepo.findByLearnerAndLesson(learner.id, lessonId);
    if (!progressRow) return err('PROGRESS_NOT_FOUND', 'No progress row found for learner and lesson.');

    const normalized = this.state.normalizeState(progressRow.state);
    if (normalized === 'completed') {
      await this.db.audit('record_submission', 'submission_log', {
        learnerId: learner.id,
        lessonId,
        ...(input.auditMeta || {}),
        duplicate: true,
      });
      return ok(existing ? 'DUPLICATE_SUBMISSION' : 'SUBMISSION_RECORDED', {
        learnerId: learner.id,
        submissionId,
        message: 'Submission already recorded.',
      });
    }

    const submitted = await this.advanceLessonState({ learnerId: learner.id, lessonId, toState: 'submitted' });
    if (!submitted.ok) return submitted;

    const completed = await this.advanceLessonState({ learnerId: learner.id, lessonId, toState: 'completed' });
    if (!completed.ok) return completed;

    await this.queueNextLesson({ learnerId: learner.id, currentLessonId: lessonId });

    await this.db.audit('record_submission', 'submission_log', {
      learnerId: learner.id,
      lessonId,
      ...(input.auditMeta || {}),
    });

    return ok(existing ? 'DUPLICATE_SUBMISSION' : 'SUBMISSION_RECORDED', {
      learnerId: learner.id,
      submissionId,
      message: existing ? 'Submission already recorded.' : 'Submission recorded.',
    });
  }

  async advanceLessonState(input: {
    learnerId: string;
    lessonId: string;
    toState: 'submitted' | 'completed';
  }): Promise<Result> {
    const progress = await this.repos.progressRepo.findByLearnerAndLesson(input.learnerId, input.lessonId);
    if (!progress) return err('PROGRESS_NOT_FOUND', 'Progress not found.');

    let source: Record<string, unknown> = { ...progress };
    if (input.toState === 'submitted' && (progress.state === 'delivered' || progress.state === 'queued')) {
      source = { ...progress, state: 'started' };
    }

    const transition = this.state.transition(source, input.toState, { source: 'submission' });
    if (!transition.ok) return err(transition.code, transition.message);

    const patch: Record<string, unknown> = {
      state: String(transition.record.state),
      updatedAt: String(transition.record.updatedAt || nowIso()),
    };
    if (transition.record.completedAt) patch.completedAt = String(transition.record.completedAt);
    if (input.toState === 'submitted') patch.submissionText = '';

    await this.repos.progressRepo.update(progress.id, patch);
    return ok('STATE_UPDATED', { recordId: progress.id });
  }

  async queueNextLesson(input: { learnerId: string; currentLessonId: string }): Promise<Result> {
    const current = await this.repos.lessonRepo.findById(input.currentLessonId);
    if (!current) return err('CURRENT_LESSON_NOT_FOUND', 'Current lesson not found.');

    const next = await this.repos.lessonRepo.findNextLesson(current.courseId, Number(current.sequenceNumber || 0));
    if (!next) return ok('COURSE_COMPLETE', { message: 'No further lessons in this course.' });

    const existing = await this.repos.progressRepo.findByLearnerAndLesson(input.learnerId, next.id);
    if (existing && this.state.normalizeState(existing.state) !== 'completed') {
      return ok('ALREADY_QUEUED', { lessonId: next.id });
    }

    const now = nowIso();
    await this.repos.progressRepo.insert({
      learnerId: input.learnerId,
      lessonId: next.id,
      state: 'queued',
      dueAt: '',
    });
    await this.db.table('delivery_queue').insert({
      learnerId: input.learnerId,
      lessonId: next.id,
      status: 'queued',
      priority: 'normal',
      runAt: now,
      attempts: 0,
      availableAt: now,
      conditionExpr: '',
    });
    return ok('NEXT_LESSON_QUEUED', { lessonId: next.id });
  }
}
