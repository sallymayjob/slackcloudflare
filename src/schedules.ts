import type { ServiceContainer } from './container';
import type { DeliveryQueueRow, Lesson } from './types';
import { nowIso } from './util';

export async function handleScheduled(
  event: ScheduledEvent,
  deps: ServiceContainer
): Promise<unknown> {
  const cron = event.cron;
  switch (cron) {
    case '0 8 * * *':
      return runDailyLessonDelivery(deps);
    case '0 * * * *':
      return runHourlyReminderCheck(deps);
    case '0 9 * * 1':
      return runWeeklyAdminReport(deps);
    case '*/30 * * * *':
      return runHealthCheck(deps);
    case '0 2 * * *':
      return runDailyBackup(deps);
    default:
      return { ok: false, code: 'UNKNOWN_CRON', cron };
  }
}

export async function runDailyLessonDelivery(deps: ServiceContainer): Promise<Record<string, unknown>> {
  const { db, repos, slackApiClient, lessonService, config } = deps;
  const now = new Date();
  const retryThreshold = config.pipelineMaxRetries;
  const nowTs = now.toISOString();

  const { results } = await db
    .raw()
    .prepare(
      `SELECT * FROM delivery_queue
       WHERE status IN ('queued', 'retry')
         AND (availableAt IS NULL OR availableAt = '' OR availableAt <= ?)
       ORDER BY COALESCE(availableAt, runAt) ASC
       LIMIT ?`
    )
    .bind(nowTs, config.deliveryBatchSize)
    .all<DeliveryQueueRow>();

  const rows = results || [];
  const summary: Record<string, unknown> = {
    ok: true,
    scanned: rows.length,
    delivered: 0,
    failed: 0,
    items: [] as Array<Record<string, unknown>>,
  };

  for (const queueRow of rows) {
    try {
      const lesson = await repos.lessonRepo.findById(queueRow.lessonId);
      if (!lesson) throw { code: 'LESSON_NOT_FOUND', message: 'Lesson missing.' };
      if (!isLive(lesson)) throw { code: 'LESSON_NOT_LIVE', message: 'Lesson not deliverable.' };

      const learner = await repos.learnerRepo.findById(queueRow.learnerId);
      if (!learner) throw { code: 'LEARNER_NOT_FOUND', message: 'Learner missing.' };

      const progress = await repos.progressRepo.findByLearnerAndLesson(queueRow.learnerId, queueRow.lessonId);
      if (!progress) throw { code: 'PROGRESS_NOT_FOUND', message: 'Learner progress missing.' };

      await repos.progressRepo.update(progress.id, { state: 'delivered', updatedAt: nowTs });

      const payload = lessonService.buildLessonMessagePayload(lesson, 'New lesson available');
      const dm = await slackApiClient.openDm(learner.slackUserId);
      if (!dm.ok || !dm.channelId) {
        throw { code: dm.code || 'DM_OPEN_FAILED', message: dm.message || 'Cannot open DM.' };
      }

      const sent = await slackApiClient.postMessage(dm.channelId, payload.text, payload.blocks);
      if (!sent.ok) throw { code: sent.code || 'DM_SEND_FAILED', message: sent.message || 'Cannot send DM.' };

      await db.table('delivery_queue').update(queueRow.id, {
        status: 'delivered',
        updatedAt: nowTs,
      });

      await db.audit('lesson_queue_delivery_success', 'delivery_queue', {
        queueId: queueRow.id,
        learnerId: queueRow.learnerId,
        lessonId: queueRow.lessonId,
      });

      (summary.delivered as number) = (summary.delivered as number) + 1;
      (summary.items as unknown[]).push({ id: queueRow.id, ok: true, code: 'DELIVERED' });
    } catch (error) {
      const e = error as { code?: string; message?: string };
      const attempts = Number(queueRow.attempts || 0) + 1;
      const terminal = attempts >= retryThreshold;
      await db.table('delivery_queue').update(queueRow.id, {
        status: terminal ? 'failed' : 'retry',
        attempts,
        updatedAt: nowTs,
      });
      await db.audit('lesson_queue_delivery_failure', 'delivery_queue', {
        queueId: queueRow.id,
        code: e.code || 'QUEUE_DELIVERY_ERROR',
        message: e.message || '',
        attempts,
        failed: terminal,
      });
      (summary.failed as number) = (summary.failed as number) + 1;
      (summary.items as unknown[]).push({ id: queueRow.id, ok: false, code: e.code || 'QUEUE_DELIVERY_ERROR', attempts, failed: terminal });
    }
  }

  return summary;
}

export async function runHourlyReminderCheck(deps: ServiceContainer) {
  return deps.reminderService.sendOverdueReminders();
}

export async function runWeeklyAdminReport(deps: ServiceContainer) {
  const summary = await deps.reportService.buildWeeklySummary();
  if (deps.config.opsAlertChannel) {
    const blocks = await deps.reportService.buildSummaryBlocks();
    await deps.slackApiClient.postMessage(deps.config.opsAlertChannel, 'Weekly LMS summary', blocks);
  }
  await deps.db.audit('weekly_report', 'report', {
    learnerCount: summary.learnerCount,
    activeEnrollments: summary.activeEnrollments,
    completedLessons: summary.completedLessons,
    pendingQueue: summary.pendingQueue,
    failedJobs: summary.failedJobs,
  });
  return summary;
}

export async function runHealthCheck(deps: ServiceContainer) {
  const pending = await deps.db
    .raw()
    .prepare('SELECT COUNT(*) as count FROM delivery_queue WHERE status = "queued"')
    .first<{ count: number }>();
  const failed = await deps.db
    .raw()
    .prepare('SELECT COUNT(*) as count FROM retry_queue WHERE status = "failed"')
    .first<{ count: number }>();
  const snapshot = {
    ok: true,
    checkedAt: nowIso(),
    pendingDelivery: Number(pending?.count || 0),
    failedJobs: Number(failed?.count || 0),
  };
  await deps.db.audit('health_check', 'system', snapshot);
  return snapshot;
}

export async function runDailyBackup(deps: ServiceContainer) {
  // D1 is managed by Cloudflare; rely on `wrangler d1 export` for true snapshots.
  // This job simply records an audit marker so ops can track that the cron fired.
  await deps.db.audit('daily_backup_marker', 'system', { note: 'Use `wrangler d1 export` for snapshots.' });
  return { ok: true, code: 'BACKUP_MARKER_RECORDED' };
}

function isLive(lesson: Lesson): boolean {
  const status = String(lesson.status || '').toLowerCase();
  return status === 'live' || String(lesson.active || '').toLowerCase() === 'true';
}
