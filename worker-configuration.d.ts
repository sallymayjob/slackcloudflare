/// <reference types="@cloudflare/workers-types" />

export interface Env {
  DB: D1Database;
  REPLAY_CACHE: KVNamespace;
  INGRESS_QUEUE: Queue<IngressJob>;

  SLACK_BOT_TOKEN: string;
  SLACK_SIGNING_SECRET: string;

  DEFAULT_COURSE_ID: string;
  DEFAULT_TRACK: string;
  ADMIN_USER_IDS: string;
  OPS_ALERT_CHANNEL: string;
  QA_PASS_THRESHOLD: string;
  QUIET_HOURS_START: string;
  QUIET_HOURS_END: string;
  PIPELINE_MAX_RETRIES: string;
  INGRESS_JOB_BATCH_SIZE: string;
  DELIVERY_BATCH_SIZE: string;
}

export interface IngressJob {
  jobType: string;
  routeType: string;
  payload: Record<string, unknown>;
  requestMeta: {
    correlationId: string;
    teamId: string;
    userId: string;
    command: string;
  };
  idempotencyKey: string;
}
