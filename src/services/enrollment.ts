import type { HostConfig } from '../config';
import type { Repositories } from '../db/repositories';
import type { Db } from '../db/db';
import type { SlackApiClient } from '../slack/client';
import { SlackBlocks } from '../slack/blocks';
import { LearnerProgressStateMachine } from './stateMachine';
import { sanitizeInput, nowIso } from '../util';
import { err, ok } from '../errors';
import type { Result } from '../types';

export interface EnrollInput {
  slackUserId: string;
  email?: string;
  name?: string;
  courseId?: string;
}

export class EnrollmentService {
  constructor(
    private db: Db,
    private slack: SlackApiClient,
    private repos: Repositories,
    private state: LearnerProgressStateMachine,
    private config: HostConfig
  ) {}

  async enrollLearner(input: EnrollInput): Promise<Result> {
    const slackUserId = sanitizeInput(input.slackUserId);
    if (!slackUserId) return err('INVALID_INPUT', 'slackUserId is required.');

    const learner = await this.ensureLearner({
      slackUserId,
      email: sanitizeInput(input.email || ''),
      name: sanitizeInput(input.name || ''),
    });

    const enrollment = await this.ensureEnrollment({
      learnerId: learner.id,
      courseId: sanitizeInput(input.courseId || '') || this.config.defaultCourseId,
    });

    const queueResult = await this.queueFirstLesson({
      learnerId: learner.id,
      courseId: enrollment.courseId,
    });

    await this.sendWelcomeDm(learner.slackUserId, enrollment.courseId);

    await this.db.audit('enroll_learner', 'enrollment', {
      learnerId: learner.id,
      enrollmentId: enrollment.id,
      queueId: (queueResult as Record<string, unknown>).queueId || '',
    });

    return ok('ENROLLED', {
      learnerId: learner.id,
      enrollmentId: enrollment.id,
      queueId: (queueResult as Record<string, unknown>).queueId || '',
    });
  }

  private async ensureLearner(input: { slackUserId: string; email: string; name: string }) {
    const existing = await this.repos.learnerRepo.findBySlackUserId(input.slackUserId);
    if (existing) return existing;
    return this.repos.learnerRepo.insert({
      slackUserId: input.slackUserId,
      email: input.email,
      name: input.name,
      status: 'active',
    });
  }

  private async ensureEnrollment(input: { learnerId: string; courseId: string }) {
    const existing = await this.repos.enrollmentRepo.findByLearnerAndCourse(input.learnerId, input.courseId);
    if (existing) return existing;
    return this.repos.enrollmentRepo.insert({
      learnerId: input.learnerId,
      courseId: input.courseId,
      track: this.config.defaultTrack,
      status: 'active',
    });
  }

  private async queueFirstLesson(input: { learnerId: string; courseId: string }): Promise<Result> {
    const lessons = await this.repos.lessonRepo.findActiveByCourse(input.courseId);
    const firstLesson = lessons[0];
    if (!firstLesson) return err('NO_LESSONS_AVAILABLE', 'No active lessons found for course.');

    const existingProgress = await this.repos.progressRepo.findByLearnerAndLesson(input.learnerId, firstLesson.id);
    const now = nowIso();
    if (existingProgress && this.state.normalizeState(existingProgress.state) !== 'completed') {
      return ok('FIRST_LESSON_QUEUED', {
        learnerId: input.learnerId,
        lessonId: firstLesson.id,
        queueId: '',
        progressId: existingProgress.id,
      });
    }

    await this.repos.progressRepo.insert({
      learnerId: input.learnerId,
      lessonId: firstLesson.id,
      state: 'queued',
      dueAt: now,
    });

    const queueRow = await this.db.table('delivery_queue').insert({
      learnerId: input.learnerId,
      lessonId: firstLesson.id,
      status: 'queued',
      priority: 'normal',
      runAt: now,
      attempts: 0,
      availableAt: now,
      conditionExpr: '',
    });

    return ok('FIRST_LESSON_QUEUED', {
      learnerId: input.learnerId,
      lessonId: firstLesson.id,
      queueId: queueRow.id,
    });
  }

  private async sendWelcomeDm(slackUserId: string, courseId: string) {
    const dm = await this.slack.openDm(slackUserId);
    if (!dm.ok || !dm.channelId) return dm;
    return this.slack.postMessage(dm.channelId, 'Welcome to RWR LMS', SlackBlocks.buildWelcomeMessage({ courseId }));
  }
}
