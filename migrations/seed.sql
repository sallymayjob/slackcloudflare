-- Minimal seed for local dev and smoke testing.
INSERT OR IGNORE INTO courses (id, courseTitle, brandScope, moduleOrder, durationMonths, status, createdAt, updatedAt)
VALUES ('C001', 'RWR Onboarding', 'default', 'M001', 3, 'active', datetime('now'), datetime('now'));

INSERT OR IGNORE INTO modules (id, courseId, moduleTitle, monthNumber, lessonCount, status, createdAt, updatedAt)
VALUES ('M001', 'C001', 'Month One', 1, 2, 'active', datetime('now'), datetime('now'));

INSERT OR IGNORE INTO lessons (
  id, courseId, moduleId, sequenceNumber, title, objective, coreContent,
  contentRef, active, status, qaScore, createdAt, updatedAt
) VALUES
  ('L001', 'C001', 'M001', 1, 'Welcome', 'Intro to the program', 'Watch the welcome video and say hi in Slack.', '', 'true', 'live', 100, datetime('now'), datetime('now')),
  ('L002', 'C001', 'M001', 2, 'Tools Tour', 'Know your tools', 'Walk through the core stack we use every day.', '', 'true', 'live', 100, datetime('now'), datetime('now'));

INSERT OR IGNORE INTO config_flags (flagKey, flagValue, updatedAt) VALUES
  ('enable_onboarding', 'true', datetime('now')),
  ('enable_reporting', 'true', datetime('now'));
