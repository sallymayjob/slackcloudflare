# Slack LMS — Cloudflare Workers

Cloudflare Workers port of the original Google Apps Script "Slack LMS" host
(https://github.com/slackadmin-coder/SlackLMS). Preserves the `parser -> security -> router -> service -> repo` architecture and the full slash/event/interactivity surface while replacing GAS primitives with Cloudflare equivalents.

## Runtime mapping

| Original (GAS)                     | Cloudflare equivalent                                    |
| ---------------------------------- | -------------------------------------------------------- |
| `doPost(e)` / `ContentService`     | Workers `fetch` handler + Hono / native `Response`       |
| `UrlFetchApp.fetch`                | native `fetch`                                           |
| `Utilities.computeHmacSha256`      | `crypto.subtle` HMAC-SHA256                              |
| `CacheService`                     | KV namespace (`REPLAY_CACHE`)                            |
| Google Sheets (`SheetDb`)          | D1 database (`DB`), 14 tables                            |
| `ScriptProperties`                 | Worker secrets + `[vars]` in `wrangler.toml`             |
| `ScriptApp.newTrigger` (time-based)| Workers Cron Triggers                                    |
| `LockService.getScriptLock`        | N/A — per-request isolation                              |
| `retry_queue` polling processor    | Cloudflare Queues producer + consumer                    |

## Project layout

```
src/
  index.ts              // fetch + scheduled + queue handlers
  parser.ts             // Slack payload normalization
  security.ts           // signature verify + replay guard (KV-backed)
  container.ts          // DI wiring
  config.ts             // env -> HostConfig
  util.ts               // hmac, base64url, id/time helpers
  errors.ts             // ok/err helpers
  schedules.ts          // cron handlers (delivery, reminders, report, health, backup)
  db/
    db.ts               // D1 table gateway (findAll/findById/insert/update + audit)
    repositories.ts     // learner/enrollment/lesson/progress repos
  slack/
    client.ts           // Slack Web API client
    blocks.ts           // Block Kit builders
    dispatcher.ts       // slash/event/interactivity handlers
    router.ts           // route by parsed.routeType
  services/
    stateMachine.ts     // learner_progress state transitions
    enrollment.ts       // enrollLearner, queueFirstLesson, welcome DM
    lesson.ts           // queueNextEligibleLessonForLearner, buildLessonMessagePayload
    progress.ts         // handleProgress, handleReinforce, snapshot
    completion.ts       // recordSubmission, advanceLessonState, queueNextLesson
    reminder.ts         // sendOverdueReminders
    report.ts           // handleGaps, weekly summary, admin dashboard
    onboarding.ts       // startOnboarding, advanceOnboardingState, audit/offboard
  ingress/
    queue.ts            // IngressQueueService (idempotent enqueue)
    consumer.ts         // Cloudflare Queues consumer -> service dispatch
migrations/
  0001_initial.sql      // 13-table schema + config_flags
  seed.sql              // seed row for local dev
slack-manifest.json     // Slack app manifest with Worker URLs
wrangler.toml           // bindings: DB (D1), REPLAY_CACHE (KV), INGRESS_QUEUE (Queues), crons
worker-configuration.d.ts
```

## Commands supported

Same as the GAS host: `/learn`, `/submit <lesson_id> complete`, `/progress`, `/help`, `/enroll [courseId]`, `/report`, `/onboard [email]`, `/gaps`, `/audit`, `/mix`, `/reinforce`, `/offboard [email]`.

Events: `url_verification`, `app_mention`, `message.im`, `reaction_added`.
Interactivity: `view_submission`, `checklist_mark_*`, `submit_lesson`.
Workflow webhook: `workflow.enroll`.

## Quickstart

```bash
npm install

# Create resources (names must match wrangler.toml)
npx wrangler d1 create slack_lms
npx wrangler kv namespace create REPLAY_CACHE
npx wrangler queues create slack-lms-ingress
npx wrangler queues create slack-lms-ingress-dlq

# Paste the returned IDs into wrangler.toml.

# Apply schema
npm run db:migrate:local
npm run db:seed:local

# Secrets (production)
npx wrangler secret put SLACK_BOT_TOKEN
npx wrangler secret put SLACK_SIGNING_SECRET

# Run locally
cp .dev.vars.example .dev.vars   # fill in values for `wrangler dev`
npm run dev
```

See `DEPLOYMENT.md` for the full flow and `MIGRATION_MAPPING.md` for a file-by-file mapping from the GAS source.

## Configuration

Set in `wrangler.toml` under `[vars]` (non-secret):

- `DEFAULT_COURSE_ID`, `DEFAULT_TRACK`
- `ADMIN_USER_IDS` (comma-separated Slack user IDs)
- `OPS_ALERT_CHANNEL`
- `QA_PASS_THRESHOLD`, `QUIET_HOURS_START`, `QUIET_HOURS_END`
- `PIPELINE_MAX_RETRIES`, `INGRESS_JOB_BATCH_SIZE`, `DELIVERY_BATCH_SIZE`

Secrets (via `wrangler secret put`):

- `SLACK_BOT_TOKEN`
- `SLACK_SIGNING_SECRET`

## Cron triggers

| Cron          | Job                                   |
| ------------- | ------------------------------------- |
| `0 8 * * *`   | Daily lesson delivery (08:00 UTC)     |
| `0 * * * *`   | Hourly reminder sweep                 |
| `0 9 * * 1`   | Weekly admin report (Mon 09:00 UTC)   |
| `*/30 * * * *`| Health check snapshot                 |
| `0 2 * * *`   | Daily backup marker (audit only; use `wrangler d1 export` for real snapshots) |

## Type-safety

```bash
npm run typecheck
```
