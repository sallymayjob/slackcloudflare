# Migration mapping: GAS → Cloudflare Workers

Where each file from the original [`SlackLMS`](https://github.com/slackadmin-coder/SlackLMS) repo ended up.

| GAS file (source)                            | Cloudflare Workers equivalent                              | Notes |
| -------------------------------------------- | ---------------------------------------------------------- | ----- |
| `code.gs` (doPost shell)                     | `src/index.ts`                                             | Hono route `/slack/events` |
| `00_WebAppEntry.gs`                          | `src/container.ts`                                         | DI container |
| `01_SlackRouter.gs`                          | `src/slack/router.ts`                                      | 1:1 route table |
| `02_SlackPayloadParser.gs`                   | `src/parser.ts`                                            | Form-urlencoded + JSON + interactivity payload |
| `03_SlackService.gs`                         | `src/slack/dispatcher.ts`                                  | Slash/event/interactivity registries |
| `04_SlackSecurity.gs` / `33_SecurityService` | `src/security.ts` + `src/util.ts`                          | Signature via `crypto.subtle`; replay via KV |
| `05_AppSheetWebhook.gs`                      | `workflow_webhook` branch in dispatcher                    | Same enqueue path |
| `07_AuditLogger_Sheets.gs` / `28_AuditLogger`| `Db.audit()` in `src/db/db.ts`                             | Appends to `audit_log` table |
| `08_DbSchema.gs`                             | `migrations/0001_initial.sql`                              | 13-table contract preserved + `config_flags` |
| `09_LmsEnrollmentService.gs`                 | `src/services/enrollment.ts`                               | |
| `10_QueueProcessor.gs`                       | `src/ingress/queue.ts` + `src/ingress/consumer.ts`         | Polling → Cloudflare Queues |
| `11_OnboardingService.gs`                    | `src/services/onboarding.ts`                               | Simplified — keeps start/advance/audit/offboard |
| `11_SlackApiClient.gs`                       | `src/slack/client.ts`                                      | `UrlFetchApp` → `fetch` |
| `12_LmsLessonService.gs`                     | `src/services/lesson.ts`                                   | |
| `12_SlackBlockKitBuilder.gs`                 | `src/slack/blocks.ts`                                      | |
| `13_LearnerProgressStateMachine.gs`          | `src/services/stateMachine.ts`                             | Canonical states + legacy map |
| `13_LmsProgressService.gs`                   | `src/services/progress.ts`                                 | |
| `13a_LmsCompletionService.gs`                | `src/services/completion.ts`                               | |
| `14_LmsReminderService.gs`                   | `src/services/reminder.ts`                                 | |
| `14_Scheduler.gs`                            | `src/schedules.ts` + `wrangler.toml` crons                 | GAS triggers → Cron Triggers |
| `15_SheetsDataSync.gs`                       | (not ported)                                               | Use D1 SQL / `wrangler d1 execute` instead |
| `16_ConfigBootstrap.gs` / `22_ScriptProperties` / `23_Config.gs` | `src/config.ts` + `[vars]` in `wrangler.toml` + secrets | |
| `17_HealthMonitor.gs`                        | `runHealthCheck` in `src/schedules.ts`                     | 30-minute cron |
| `18_BackupService.gs`                        | `runDailyBackup` in `src/schedules.ts`                     | Audit marker; use `wrangler d1 export` for real snapshots |
| `18_RetryResolver.gs`                        | Queue `max_retries` + DLQ (`slack-lms-ingress-dlq`)        | Native retry semantics |
| `19_HostTestHarness.gs`                      | (not ported)                                               | Use `vitest` / `wrangler dev` for Worker tests |
| `20_Errors.gs` / `34_ErrorService.gs`        | `src/errors.ts`                                            | `ok()` / `err()` helpers |
| `21_Util.gs`                                 | `src/util.ts`                                              | |
| `24_SheetsGateway.gs` / `25_SchemaRegistry.gs` / `26_TableRepository.gs` / `27_TransactionManager.gs` / `29_DbClient.gs` / `30_SheetDb.gs` / `35_RepositoryLayer.gs` / `36_DbAdapter.gs` | `src/db/db.ts` + `src/db/repositories.ts` | D1 + prepared statements |
| `33_WorkflowEngine.gs`                       | Inlined into services                                      | Workers don't need the GAS workflow wrapper |
| `37_SkillRegistry.gs`                        | (not ported)                                               | Was only used for skill IDs in audit metadata |
| `ReportService.gs`                           | `src/services/report.ts`                                   | |
| `manifest.json`                              | `slack-manifest.json`                                      | Point request_url to Worker host |

## Data migration

The 13 tables preserve the same column names as the GAS contract in
`docs/schema_contract.md`, so you can export sheets to CSV and load with:

```bash
# Example: lessons.csv -> D1
npx wrangler d1 execute slack_lms --remote --file=./migrations/0001_initial.sql
# Repeat per-table import scripts as needed; CSV -> INSERT statements.
```

Timestamps kept as ISO strings so existing rows carry over cleanly.

## Behavioral differences to know

1. **No `LockService`.** Cloudflare Workers execute per-request with independent isolates; the
   original GAS code used a project-wide script lock for scheduler jobs. D1's own write ordering
   + Queues' single-flight per message covers the cases that mattered.
2. **Ingress queue.** Original code polled `retry_queue` from a time-based trigger. Now the
   producer enqueues to `INGRESS_QUEUE` and Cloudflare drives consumption; DB row is kept only
   as an idempotency ledger.
3. **Backup.** `18_BackupService.gs` manipulated Sheets tabs. Use `wrangler d1 export` instead.
4. **Replay cache.** Uses KV with a 5-minute TTL. Cross-region consistency is eventual (same as
   the GAS cache), which is fine for a replay guard.
