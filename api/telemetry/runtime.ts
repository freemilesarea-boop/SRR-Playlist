/**
 * Vercel serverless (edge) — POST /api/telemetry/runtime
 *
 * WEB-OBS-1 — Runtime Telemetry ingestion. Same-origin sink between the browser transport and
 * Supabase. The browser NEVER writes the telemetry table directly (RLS deny-all); it POSTs here,
 * this function validates + sanitizes + rate-limits, then inserts via the service-role RPC
 * `ingest_runtime_telemetry` (dedup on event_id).
 *
 * Guarantees:
 *   • Fail-OPEN for the caller: every response is fast + small; a telemetry failure is never a
 *     service failure. (The client already treats non-2xx as "drop", never as a user error.)
 *   • Double sanitization: `parseEnvelope` (shared with the client) REBUILDS each event from an
 *     allow-list — unknown fields dropped, strings re-sanitized, enums collapsed, numbers clamped.
 *   • No PII, no tokens, no IP persisted. Rate-limit keys use a hashed session id only, in-memory.
 *
 * Status codes: 202 accepted · 400 malformed · 413 too large · 415 bad content-type · 429 rate
 * limit · 500 internal. Rejection reasons are intentionally coarse (no schema leak to abusers).
 *
 * Absolutely does not touch: any existing table, cron, auth flow, or app logic — insert-only via
 * one additive RPC.
 */

import {
  parseEnvelope, MAX_BATCH_EVENTS, MAX_BODY_BYTES, type TelemetryEvent,
} from '../../src/lib/telemetry/schema';

export const config = { runtime: 'edge' };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

// ---------------------------------------------------------------------------
// Best-effort in-memory rate limit. NOTE: edge instances are ephemeral + regionally distributed,
// so this is a per-instance guard, not a global quota — documented as a known limitation. It still
// blunts a single hot client hammering one instance. Key = hashed session id (NEVER raw IP).
// ---------------------------------------------------------------------------
const RL_WINDOW_MS = 60_000;      // 1 minute window
const RL_MAX_BATCHES = 12;        // max batches / session / minute
const rl = new Map<string, { count: number; resetAt: number }>();

function rateLimited(key: string, now: number): boolean {
  const cur = rl.get(key);
  if (!cur || now >= cur.resetAt) {
    rl.set(key, { count: 1, resetAt: now + RL_WINDOW_MS });
    if (rl.size > 5000) { // bound the map
      for (const [k, v] of rl) if (now >= v.resetAt) rl.delete(k);
    }
    return false;
  }
  cur.count++;
  return cur.count > RL_MAX_BATCHES;
}

/** FNV-1a hash → short hex. Used only to derive a non-reversible rate-limit key. */
function hashKey(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  // Content-Type gate (415).
  const ctype = req.headers.get('content-type') ?? '';
  if (!ctype.toLowerCase().includes('application/json')) {
    return json(415, { error: 'unsupported_media_type' });
  }

  // Body size gate (413) — check declared length first, then actual.
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return json(413, { error: 'payload_too_large' });
  }

  let text: string;
  try {
    text = await req.text();
  } catch {
    return json(400, { error: 'unreadable_body' });
  }
  if (text.length > MAX_BODY_BYTES) return json(413, { error: 'payload_too_large' });

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return json(400, { error: 'malformed_json' });
  }

  // Accept { events: [...] }, a bare array, or a single event object.
  let rawEvents: unknown[];
  if (Array.isArray(parsed)) rawEvents = parsed;
  else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { events?: unknown[] }).events)) {
    rawEvents = (parsed as { events: unknown[] }).events;
  } else if (parsed && typeof parsed === 'object') rawEvents = [parsed];
  else return json(400, { error: 'malformed_payload' });

  if (rawEvents.length === 0) return json(202, { accepted: 0, rejected: 0 });
  if (rawEvents.length > MAX_BATCH_EVENTS) return json(413, { error: 'too_many_events' });

  // Validate + rebuild each event (server-side sanitization). Reject silently-coarse.
  const clean: TelemetryEvent[] = [];
  let rejected = 0;
  let sessionForKey = '';
  for (const raw of rawEvents) {
    const res = parseEnvelope(raw);
    if (res.ok && res.event) {
      clean.push(res.event);
      if (!sessionForKey) sessionForKey = res.event.session_id;
    } else {
      rejected++;
    }
  }

  // Rate limit AFTER we know the session (hashed). No session → fall back to a coarse anon key.
  const now = Date.now();
  const rlKey = hashKey(sessionForKey || (req.headers.get('user-agent') ?? 'anon'));
  if (rateLimited(rlKey, now)) {
    return json(429, { error: 'rate_limited' });
  }

  if (clean.length === 0) {
    return json(202, { accepted: 0, rejected });
  }

  // Insert via service-role RPC (dedup on event_id). Missing env → fail-open 500 (client drops).
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return json(500, { error: 'ingestion_unavailable' });
  }

  try {
    const r = await fetch(`${url}/rest/v1/rpc/ingest_runtime_telemetry`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ p_events: clean }),
    });
    if (!r.ok) {
      return json(500, { error: 'ingestion_failed' });
    }
    const out = (await r.json().catch(() => null)) as { inserted?: number; duplicate?: number } | null;
    const inserted = typeof out?.inserted === 'number' ? out.inserted : clean.length;
    const duplicate = typeof out?.duplicate === 'number' ? out.duplicate : 0;
    return json(202, { accepted: inserted, rejected, duplicate });
  } catch {
    return json(500, { error: 'ingestion_error' });
  }
}
