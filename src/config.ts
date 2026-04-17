import type { Env } from '../worker-configuration';

export interface HostConfig {
  slackBotToken: string;
  slackSigningSecret: string;
  defaultCourseId: string;
  defaultTrack: string;
  adminUserIds: string[];
  opsAlertChannel: string;
  qaPassThreshold: number;
  quietHoursStart: number;
  quietHoursEnd: number;
  pipelineMaxRetries: number;
  ingressJobBatchSize: number;
  deliveryBatchSize: number;
}

const numOr = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value ?? '');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export function resolveHostConfig(env: Env): HostConfig {
  return {
    slackBotToken: env.SLACK_BOT_TOKEN ?? '',
    slackSigningSecret: env.SLACK_SIGNING_SECRET ?? '',
    defaultCourseId: env.DEFAULT_COURSE_ID || 'C001',
    defaultTrack: env.DEFAULT_TRACK || 'ONBOARDING',
    adminUserIds: (env.ADMIN_USER_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    opsAlertChannel: env.OPS_ALERT_CHANNEL || '',
    qaPassThreshold: numOr(env.QA_PASS_THRESHOLD, 70),
    quietHoursStart: numOr(env.QUIET_HOURS_START, 21),
    quietHoursEnd: numOr(env.QUIET_HOURS_END, 7),
    pipelineMaxRetries: numOr(env.PIPELINE_MAX_RETRIES, 3),
    ingressJobBatchSize: numOr(env.INGRESS_JOB_BATCH_SIZE, 20),
    deliveryBatchSize: numOr(env.DELIVERY_BATCH_SIZE, 25),
  };
}

export function isAdmin(config: HostConfig, userId: string): boolean {
  return userId !== '' && config.adminUserIds.includes(userId);
}
