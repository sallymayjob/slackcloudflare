export type Ok<T = Record<string, unknown>> = {
  ok: true;
  code: string;
  message?: string;
  [key: string]: unknown;
} & T;

export type Err = {
  ok: false;
  code: string;
  message: string;
  retryable?: boolean;
  correlationId?: string;
};

export type Result<T = Record<string, unknown>> = Ok<T> | Err;

export type SlackRouteType =
  | 'url_verification'
  | 'slash_command'
  | 'interactivity'
  | 'event_callback'
  | 'workflow_webhook'
  | 'unknown';

export interface ParsedSlackRequest {
  ok: boolean;
  routeType: SlackRouteType;
  rawBody: string;
  body: Record<string, unknown>;
  params: Record<string, string>;
  command: string;
  payloadType: string;
  userId: string;
  channelId: string;
  teamId: string;
  triggerId: string;
  responseUrl: string;
  slackSignature: string;
  slackTimestamp: string;
  interaction: Record<string, unknown> | null;
  parseError: string;
}

export interface SlackResponse {
  response_type?: 'ephemeral' | 'in_channel';
  text?: string;
  blocks?: unknown[];
  response_action?: string;
  errors?: Record<string, string>;
  challenge?: string;
  [key: string]: unknown;
}

export interface Learner {
  id: string;
  slackUserId: string;
  email: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Enrollment {
  id: string;
  learnerId: string;
  courseId: string;
  track: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Lesson {
  id: string;
  courseId: string;
  moduleId: string;
  sequenceNumber: number;
  title: string;
  topic: string;
  objective: string;
  hook: string;
  coreContent: string;
  insight: string;
  takeaway: string;
  mission: string;
  contentRef: string;
  slackPayload: string;
  active: string;
  status: string;
  qaScore: number;
  [key: string]: unknown;
}

export interface LearnerProgress {
  id: string;
  learnerId: string;
  lessonId: string;
  state: string;
  dueAt: string;
  completedAt: string;
  submissionText: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface DeliveryQueueRow {
  id: string;
  learnerId: string;
  lessonId: string;
  status: string;
  runAt: string;
  priority: string;
  attempts: number;
  availableAt: string;
  conditionExpr: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface RequestContext {
  correlationId: string;
}
