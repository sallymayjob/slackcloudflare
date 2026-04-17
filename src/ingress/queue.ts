import type { IngressJob } from '../../worker-configuration';
import type { Db } from '../db/db';
import { sanitizeInput, sha256Base64Url } from '../util';
import { err, ok } from '../errors';
import type { Result } from '../types';

export interface AppendJobInput {
  routeType: string;
  jobType: string;
  payload: Record<string, unknown>;
  requestMeta: IngressJob['requestMeta'];
}

export class IngressQueueService {
  constructor(private db: Db, private queue: Queue<IngressJob>) {}

  async generateIdempotencyKey(
    routeType: string,
    jobType: string,
    payload: Record<string, unknown>
  ): Promise<string> {
    const serialized = JSON.stringify({ routeType, jobType, payload });
    return `ik_${await sha256Base64Url(serialized)}`;
  }

  async appendJob(input: AppendJobInput): Promise<Result> {
    const jobType = sanitizeInput(input.jobType);
    const routeType = sanitizeInput(input.routeType);
    if (!jobType || !routeType) {
      return err('INVALID_QUEUE_APPEND', 'Missing routeType/jobType.');
    }

    const idempotencyKey = await this.generateIdempotencyKey(routeType, jobType, input.payload || {});
    const existing = await this.db.table('retry_queue').findOne({ correlationId: idempotencyKey });
    if (existing && existing.status !== 'failed') {
      return ok('DUPLICATE', {
        duplicate: true,
        jobId: existing.id,
        idempotencyKey,
      });
    }

    const row = await this.db.table('retry_queue').insert({
      jobType: `ingress.${jobType}`,
      payload: JSON.stringify({
        routeType,
        payload: input.payload,
        requestMeta: input.requestMeta,
      }),
      attempts: 0,
      nextRunAt: new Date().toISOString(),
      status: 'queued',
      lastError: '',
      correlationId: idempotencyKey,
    });

    await this.queue.send({
      jobType,
      routeType,
      payload: input.payload,
      requestMeta: input.requestMeta,
      idempotencyKey,
    });

    return ok('QUEUED', {
      duplicate: false,
      jobId: row.id,
      idempotencyKey,
    });
  }
}
