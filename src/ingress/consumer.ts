import type { IngressJob } from '../../worker-configuration';
import type { ServiceContainer } from '../container';
import { nowIso } from '../util';

export async function handleIngressBatch(
  batch: MessageBatch<IngressJob>,
  deps: ServiceContainer
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await dispatch(message.body, deps);
      await markJobProcessed(deps, message.body.idempotencyKey);
      message.ack();
    } catch (error) {
      const err = error as { code?: string; message?: string };
      await markJobFailed(deps, message.body.idempotencyKey, err);
      // Retry with exponential backoff; queue config controls max retries.
      message.retry({ delaySeconds: 30 });
    }
  }
}

async function dispatch(job: IngressJob, deps: ServiceContainer): Promise<void> {
  const { payload } = job;
  switch (job.jobType) {
    case 'slash.learn':
    case 'slash.mix': {
      await deps.lessonService.queueNextEligibleLessonForLearner(String(payload.userId || ''));
      return;
    }
    case 'slash.submit':
    case 'interactivity.submit_lesson':
    case 'interactivity.modal_submission': {
      await deps.completionService.recordSubmission({
        slackUserId: String(payload.slackUserId || ''),
        lessonId: String(payload.lessonId || ''),
        payload: String(payload.payload || ''),
        idempotencyKey: String(payload.idempotencyKey || ''),
      });
      return;
    }
    case 'slash.enroll':
    case 'workflow.enroll': {
      await deps.enrollmentService.enrollLearner({
        slackUserId: String(payload.slackUserId || ''),
        email: String(payload.email || ''),
        name: String(payload.name || ''),
        courseId: String(payload.courseId || ''),
      });
      return;
    }
    case 'interactivity.checklist_mark': {
      await deps.onboardingService.advanceOnboardingState(
        String(payload.learnerId || ''),
        String(payload.checklistItemId || ''),
        String(payload.status || 'completed')
      );
      return;
    }
    case 'event.app_mention': {
      await deps.slackApiClient.postMessage(
        String(payload.channelId || ''),
        'Hi! Commands: `/learn`, `/submit <lesson_id> complete`, `/progress`, `/help`, `/enroll [courseId]`, `/report`, `/onboard [email]`, `/gaps`, `/audit`, `/mix`, `/reinforce`, `/offboard [email]`.'
      );
      return;
    }
    case 'event.message_im': {
      const text = String(payload.text || '').toLowerCase();
      let message = 'Welcome! Use `/learn` to get your current lesson, or `/help` for all commands.';
      if (text.includes('progress')) message = 'Use `/progress` for your learner snapshot.';
      if (text.includes('help')) message = 'Need help? Try `/help` for all commands.';
      const dm = await deps.slackApiClient.openDm(String(payload.userId || ''));
      if (!dm.ok || !dm.channelId) {
        throw { code: dm.code || 'DM_OPEN_FAILED', message: dm.message || 'Unable to open DM' };
      }
      await deps.slackApiClient.postMessage(dm.channelId, message);
      return;
    }
    default:
      throw { code: 'UNSUPPORTED_JOB_TYPE', message: `Unsupported job type: ${job.jobType}` };
  }
}

async function markJobProcessed(deps: ServiceContainer, idempotencyKey: string): Promise<void> {
  const row = await deps.db.table('retry_queue').findOne({ correlationId: idempotencyKey });
  if (!row) return;
  await deps.db.table('retry_queue').update(String(row.id), {
    status: 'processed',
    lastError: '',
    updatedAt: nowIso(),
  });
}

async function markJobFailed(
  deps: ServiceContainer,
  idempotencyKey: string,
  error: { code?: string; message?: string }
): Promise<void> {
  const row = await deps.db.table('retry_queue').findOne({ correlationId: idempotencyKey });
  if (!row) return;
  const attempts = Number(row.attempts || 0) + 1;
  const terminal = attempts >= deps.config.pipelineMaxRetries;
  await deps.db.table('retry_queue').update(String(row.id), {
    attempts,
    status: terminal ? 'failed' : 'retry',
    lastError: error.message || error.code || 'unknown',
  });
}
