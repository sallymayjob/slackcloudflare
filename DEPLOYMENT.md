# Deployment

End-to-end deploy of the Slack LMS Worker. Replaces the original
`deployment.md` (Apps Script Web App flow).

## 1. Prereqs

- Node 20+
- A Cloudflare account with Workers + D1 + KV + Queues enabled
- Slack app with a bot token and signing secret (see `slack-manifest.json`)

## 2. Install + login

```bash
npm install
npx wrangler login
```

## 3. Create Cloudflare resources

```bash
# D1
npx wrangler d1 create slack_lms
# KV (replay cache)
npx wrangler kv namespace create REPLAY_CACHE
# Queues (ingress + DLQ)
npx wrangler queues create slack-lms-ingress
npx wrangler queues create slack-lms-ingress-dlq
```

Copy the returned IDs into `wrangler.toml`:

- `database_id` for the `DB` binding
- `id` for the `REPLAY_CACHE` binding
- queue names are hard-coded (`slack-lms-ingress`)

## 4. Apply schema

```bash
# local (for `wrangler dev`)
npm run db:migrate:local
npm run db:seed:local

# production
npm run db:migrate:remote
```

## 5. Secrets

```bash
npx wrangler secret put SLACK_BOT_TOKEN       # xoxb-...
npx wrangler secret put SLACK_SIGNING_SECRET  # signing secret from Slack app
```

Non-secret config (`ADMIN_USER_IDS`, `OPS_ALERT_CHANNEL`, etc.) lives in the `[vars]` block of `wrangler.toml`.

## 6. Deploy

```bash
npm run deploy
```

Note the deployed URL, e.g. `https://slack-lms.<account>.workers.dev`.

## 7. Wire Slack app

In `slack-manifest.json`, replace `<YOUR-WORKER>.workers.dev` with the deployed hostname, then update the Slack app. All three endpoints point to the same route:

```
https://<host>/slack/events
```

Slack config required:
- Slash commands: `/learn /submit /progress /report /onboard /gaps /audit /mix /reinforce /offboard /enroll /help`
- Event subscriptions: `message.im`, `app_mention`, `reaction_added`
- Interactivity: enabled

## 8. Smoke tests

```bash
# Tail the live logs
npm run tail
```

From Slack:
1. Run `/help` — should return the command list (ephemeral).
2. Run `/enroll` — should DM you a welcome message.
3. Run `/learn` — should queue delivery. Wait for the daily cron or run it manually (see below).
4. Run `/submit <lesson_id> complete` — should confirm.
5. Run `/progress` — should show your snapshot.

## 9. Manually triggering cron jobs (ops)

```bash
# Trigger the scheduled handler locally
npx wrangler dev --test-scheduled
# Then hit the scheduled endpoint:
curl "http://localhost:8787/__scheduled?cron=0+8+*+*+*"
```

For production, cron triggers fire automatically per `wrangler.toml`.

## 10. Backup

D1 backups are native in Cloudflare. The `0 2 * * *` cron only writes an audit marker. To capture a real snapshot:

```bash
npx wrangler d1 export slack_lms --remote --output=backups/$(date +%F).sql
```
