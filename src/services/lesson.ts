import type { HostConfig } from '../config';
import type { Repositories } from '../db/repositories';
import type { Db } from '../db/db';
import type { Lesson } from '../types';
import { SlackBlocks } from '../slack/blocks';
import { err, ok } from '../errors';
import type { Result } from '../types';
import { nowIso } from '../util';

export class LessonService {
  constructor(private db: Db, private repos: Repositories, private config: HostConfig) {}

  async queueNextEligibleLessonForLearner(slackUserId: string): Promise<Result> {
    const learner = await this.repos.learnerRepo.findBySlackUserId(slackUserId);
    if (!learner) return err('LEARNER_NOT_FOUND', 'Learner not found.');

    const resolved = await this.resolveNextEligibleLesson(learner.id);
    if (!resolved.ok) return resolved;

    const lesson = (resolved as Record<string, unknown>).lesson as Lesson;
    const now = nowIso();
    const dedupedCount = await this.dedupeQueuedEntries(learner.id, lesson.id, now);

    const queueRow = await this.db.table('delivery_queue').insert({
      learnerId: learner.id,
      lessonId: lesson.id,
      status: 'queued',
      priority: 'normal',
      runAt: now,
      attempts: 0,
      availableAt: now,
      conditionExpr: '',
    });

    const existingProgress = await this.repos.progressRepo.findByLearnerAndLesson(learner.id, lesson.id);
    let progressId = '';
    if (existingProgress) {
      progressId = existingProgress.id;
      await this.repos.progressRepo.update(existingProgress.id, {
        state: 'queued',
        dueAt: existingProgress.dueAt || now,
      });
    } else {
      const inserted = await this.repos.progressRepo.insert({
        learnerId: learner.id,
        lessonId: lesson.id,
        state: 'queued',
        dueAt: now,
      });
      progressId = inserted.id;
    }

    await this.db.audit('LESSON_QUEUED', 'delivery_queue', {
      learnerId: learner.id,
      lessonId: lesson.id,
      queueId: queueRow.id,
      progressId,
      dedupedCount,
      source: '/learn',
    });

    return ok('LESSON_QUEUED', {
      learnerId: learner.id,
      lessonId: lesson.id,
      queueId: queueRow.id,
      progressId,
      dedupedCount,
    });
  }

  async resolveNextEligibleLesson(learnerId: string): Promise<Result> {
    const progressRows = (await this.repos.progressRepo.findByLearnerId(learnerId)).filter(
      (r) => r.state !== 'completed'
    );

    progressRows.sort(
      (a, b) => new Date(a.updatedAt || 0).getTime() - new Date(b.updatedAt || 0).getTime()
    );

    for (const progress of progressRows) {
      const lesson = await this.repos.lessonRepo.findById(progress.lessonId);
      if (!lesson) continue;
      if (!this.isQaApproved(lesson)) continue;
      return ok('OK', { learnerId, lesson, progress });
    }

    const enrollment = await this.repos.enrollmentRepo.findActiveForLearner(learnerId);
    if (!enrollment) return err('NO_ACTIVE_ENROLLMENT', 'No active enrollment found.');

    const lessons = await this.repos.lessonRepo.findActiveByCourse(enrollment.courseId);
    for (const lesson of lessons) {
      if (this.isQaApproved(lesson)) return ok('OK', { learnerId, lesson, progress: null });
    }
    return err('NO_ELIGIBLE_LESSON', 'No eligible lesson available yet.');
  }

  buildLessonMessagePayload(lesson: Partial<Lesson>, defaultText: string) {
    const raw = (lesson.slackPayload || '') as string;
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { text?: string; blocks?: unknown[] };
        return {
          text: parsed.text || defaultText,
          blocks: parsed.blocks || [],
        };
      } catch {
        // fall through to default block kit
      }
    }
    return { text: defaultText, blocks: SlackBlocks.buildLessonCard(lesson) };
  }

  private isQaApproved(lesson: Lesson): boolean {
    const score = Number(lesson.qaScore || 0);
    return !(score > 0 && score < this.config.qaPassThreshold) && String(lesson.status || '').toLowerCase() !== 'retired';
  }

  private async dedupeQueuedEntries(learnerId: string, lessonId: string, now: string): Promise<number> {
    const existing = await this.db
      .table('delivery_queue')
      .findAll({ learnerId, lessonId, status: 'queued' });
    for (const row of existing) {
      await this.db.table('delivery_queue').update(String(row.id), { status: 'deduped', updatedAt: now });
    }
    return existing.length;
  }
}
