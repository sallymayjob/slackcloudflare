-- Initial schema for Slack LMS on Cloudflare D1.
-- Mirrors the 13-table contract from the original Google Sheets DB
-- (see docs/schema_contract.md in the original repo).

CREATE TABLE IF NOT EXISTS learners (
  id TEXT PRIMARY KEY,
  slackUserId TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_learners_slack ON learners(slackUserId);

CREATE TABLE IF NOT EXISTS enrollment (
  id TEXT PRIMARY KEY,
  learnerId TEXT NOT NULL,
  courseId TEXT NOT NULL,
  track TEXT NOT NULL DEFAULT 'ONBOARDING',
  status TEXT NOT NULL DEFAULT 'active',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_enrollment_learner ON enrollment(learnerId);
CREATE INDEX IF NOT EXISTS idx_enrollment_course ON enrollment(courseId);

CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY,
  courseId TEXT NOT NULL,
  moduleId TEXT NOT NULL DEFAULT '',
  sequenceNumber INTEGER NOT NULL DEFAULT 0,
  track TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  topic TEXT NOT NULL DEFAULT '',
  objective TEXT NOT NULL DEFAULT '',
  difficulty TEXT NOT NULL DEFAULT '',
  hook TEXT NOT NULL DEFAULT '',
  coreContent TEXT NOT NULL DEFAULT '',
  insight TEXT NOT NULL DEFAULT '',
  takeaway TEXT NOT NULL DEFAULT '',
  mission TEXT NOT NULL DEFAULT '',
  missionType TEXT NOT NULL DEFAULT '',
  missionDuration TEXT NOT NULL DEFAULT '',
  verification TEXT NOT NULL DEFAULT '',
  submitBlock TEXT NOT NULL DEFAULT '',
  contentRef TEXT NOT NULL DEFAULT '',
  slackPayload TEXT NOT NULL DEFAULT '',
  active TEXT NOT NULL DEFAULT 'true',
  lessonType TEXT NOT NULL DEFAULT '',
  estimatedMinutes TEXT NOT NULL DEFAULT '',
  prerequisites TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',
  deliveryChannel TEXT NOT NULL DEFAULT '',
  releaseAt TEXT NOT NULL DEFAULT '',
  sunsetAt TEXT NOT NULL DEFAULT '',
  locale TEXT NOT NULL DEFAULT '',
  owner TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  version TEXT NOT NULL DEFAULT '1',
  qaStatus TEXT NOT NULL DEFAULT '',
  qaScore INTEGER NOT NULL DEFAULT 0,
  qaReviewer TEXT NOT NULL DEFAULT '',
  qaDate TEXT NOT NULL DEFAULT '',
  sourceRef TEXT NOT NULL DEFAULT '',
  migrationNotes TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_lessons_course_seq ON lessons(courseId, sequenceNumber);
CREATE INDEX IF NOT EXISTS idx_lessons_status ON lessons(status);

CREATE TABLE IF NOT EXISTS learner_progress (
  id TEXT PRIMARY KEY,
  learnerId TEXT NOT NULL,
  lessonId TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued',
  dueAt TEXT NOT NULL DEFAULT '',
  completedAt TEXT NOT NULL DEFAULT '',
  submissionText TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_progress_learner_lesson ON learner_progress(learnerId, lessonId);
CREATE INDEX IF NOT EXISTS idx_progress_state ON learner_progress(state);

CREATE TABLE IF NOT EXISTS submission_log (
  id TEXT PRIMARY KEY,
  learnerId TEXT NOT NULL,
  lessonId TEXT NOT NULL,
  submitKey TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT
);

CREATE TABLE IF NOT EXISTS delivery_queue (
  id TEXT PRIMARY KEY,
  learnerId TEXT NOT NULL,
  lessonId TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  runAt TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  attempts INTEGER NOT NULL DEFAULT 0,
  availableAt TEXT NOT NULL,
  conditionExpr TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_delivery_status ON delivery_queue(status, availableAt);

CREATE TABLE IF NOT EXISTS retry_queue (
  id TEXT PRIMARY KEY,
  jobType TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '',
  attempts INTEGER NOT NULL DEFAULT 0,
  nextRunAt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  lastError TEXT NOT NULL DEFAULT '',
  correlationId TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_retry_status ON retry_queue(status, nextRunAt);
CREATE INDEX IF NOT EXISTS idx_retry_correlation ON retry_queue(correlationId);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL DEFAULT 'system',
  action TEXT NOT NULL,
  resourceType TEXT NOT NULL DEFAULT '',
  resourceId TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ok',
  message TEXT NOT NULL DEFAULT '',
  metadata TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_action_time ON audit_log(action, createdAt);

CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  courseTitle TEXT NOT NULL DEFAULT '',
  brandScope TEXT NOT NULL DEFAULT '',
  moduleOrder TEXT NOT NULL DEFAULT '',
  durationMonths INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT
);

CREATE TABLE IF NOT EXISTS modules (
  id TEXT PRIMARY KEY,
  courseId TEXT NOT NULL,
  moduleTitle TEXT NOT NULL DEFAULT '',
  monthNumber INTEGER NOT NULL DEFAULT 0,
  lessonCount INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT
);

CREATE TABLE IF NOT EXISTS onboarding_requests (
  id TEXT PRIMARY KEY,
  requestorUserId TEXT NOT NULL,
  targetEmail TEXT NOT NULL DEFAULT '',
  targetName TEXT NOT NULL DEFAULT '',
  targetBrand TEXT NOT NULL DEFAULT '',
  targetRole TEXT NOT NULL DEFAULT '',
  courseId TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'slash_command',
  status TEXT NOT NULL DEFAULT 'pending',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT
);

CREATE TABLE IF NOT EXISTS onboarding_checklists (
  id TEXT PRIMARY KEY,
  learnerId TEXT NOT NULL,
  taskTitle TEXT NOT NULL DEFAULT '',
  taskOwner TEXT NOT NULL DEFAULT '',
  dueDate TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_checklist_learner ON onboarding_checklists(learnerId);

CREATE TABLE IF NOT EXISTS onboarding_task_log (
  id TEXT PRIMARY KEY,
  checklistItemId TEXT NOT NULL,
  learnerId TEXT NOT NULL,
  eventType TEXT NOT NULL DEFAULT '',
  eventBy TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT
);

CREATE TABLE IF NOT EXISTS config_flags (
  flagKey TEXT PRIMARY KEY,
  flagValue TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
