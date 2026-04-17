import type { Env } from '../worker-configuration';
import { Db } from './db/db';
import { buildRepositories, Repositories } from './db/repositories';
import { SlackApiClient } from './slack/client';
import { LearnerProgressStateMachine } from './services/stateMachine';
import { EnrollmentService } from './services/enrollment';
import { LessonService } from './services/lesson';
import { ProgressService } from './services/progress';
import { CompletionService } from './services/completion';
import { ReminderService } from './services/reminder';
import { ReportService } from './services/report';
import { OnboardingService } from './services/onboarding';
import { IngressQueueService } from './ingress/queue';
import { HostConfig, resolveHostConfig } from './config';

export interface ServiceContainer {
  env: Env;
  config: HostConfig;
  db: Db;
  repos: Repositories;
  slackApiClient: SlackApiClient;
  state: LearnerProgressStateMachine;
  lessonService: LessonService;
  completionService: CompletionService;
  progressService: ProgressService;
  enrollmentService: EnrollmentService;
  reminderService: ReminderService;
  reportService: ReportService;
  onboardingService: OnboardingService;
  ingressQueue: IngressQueueService;
}

export function buildContainer(env: Env): ServiceContainer {
  const config = resolveHostConfig(env);
  const db = new Db(env.DB);
  const repos = buildRepositories(db);
  const slackApiClient = new SlackApiClient(config);
  const state = new LearnerProgressStateMachine();

  return {
    env,
    config,
    db,
    repos,
    slackApiClient,
    state,
    lessonService: new LessonService(db, repos, config),
    completionService: new CompletionService(db, repos, state, config),
    progressService: new ProgressService(repos, config),
    enrollmentService: new EnrollmentService(db, slackApiClient, repos, state, config),
    reminderService: new ReminderService(db, repos, slackApiClient, config),
    reportService: new ReportService(db, config),
    onboardingService: new OnboardingService(db, repos, config),
    ingressQueue: new IngressQueueService(db, env.INGRESS_QUEUE),
  };
}
