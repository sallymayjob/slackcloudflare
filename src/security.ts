import type { ParsedSlackRequest, Result } from './types';
import type { HostConfig } from './config';
import { constantTimeEquals, hmacSha256Hex } from './util';
import { err, ok } from './errors';

const REPLAY_WINDOW_SECONDS = 60 * 5;
const REPLAY_CACHE_TTL_SECONDS = 300;

export async function verifySlackRequest(
  parsed: ParsedSlackRequest,
  config: HostConfig,
  replayCache: KVNamespace
): Promise<Result> {
  if (!parsed || !parsed.ok) {
    return err('PARSE_FAILED', parsed?.parseError || 'Invalid payload');
  }

  const secret = config.slackSigningSecret || '';
  const signature = parsed.slackSignature || '';
  const ts = parsed.slackTimestamp || '';

  if (!secret) {
    return err('SAFE_MODE_NO_SIGNING_SECRET', 'Signing secret missing; rejecting request in safe mode.');
  }

  if (!signature || !ts || !parsed.rawBody) {
    return err('UNVERIFIED', 'Slack signature headers missing.');
  }

  const signatureCheck = await verifySignature(secret, signature, ts, parsed.rawBody);
  if (!signatureCheck.ok) return signatureCheck;

  const replay = await checkReplay(replayCache, signature, ts);
  if (!replay.ok) return replay;

  return ok('OK');
}

async function verifySignature(secret: string, signature: string, ts: string, rawBody: string): Promise<Result> {
  const tsNum = Number(ts);
  if (!tsNum || Math.abs(Math.floor(Date.now() / 1000) - tsNum) > REPLAY_WINDOW_SECONDS) {
    return err('REPLAY_REJECTED', 'Timestamp outside replay window.');
  }
  const base = `v0:${ts}:${rawBody}`;
  const hex = await hmacSha256Hex(secret, base);
  const expected = `v0=${hex}`;
  if (!constantTimeEquals(expected, signature)) {
    return err('SIGNATURE_MISMATCH', 'Slack signature mismatch.');
  }
  return ok('OK');
}

async function checkReplay(cache: KVNamespace, signature: string, ts: string): Promise<Result> {
  const key = `slack_replay_${ts}_${signature.slice(0, 24)}`;
  const existing = await cache.get(key);
  if (existing) {
    return err('REPLAY_DETECTED', 'Replay request blocked.');
  }
  await cache.put(key, '1', { expirationTtl: REPLAY_CACHE_TTL_SECONDS });
  return ok('OK');
}
