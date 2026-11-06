// supabase/functions/analyze-track-segments/index.ts
//
// 구간별 음질 분석 (0548). 곡마다 8개 구간(각 3초)만 HTTP Range 로 받아 MP3 를 디코딩하고,
// _shared/segmentQcCore.ts 로 특징을 뽑아 track_segment_qc 에 저장한다.
// 곡 전체를 받지 않으므로 빠르고 가볍다(곡당 약 0.2~0.3초 CPU).
//
// 호출: pg_cron → cron_run_segment_qc(mode) → POST /analyze-track-segments
//   headers: x-cron-secret (Vault brand_alert_secret 과 대조) 또는 service role Bearer
//   body: { mode?: 'pending' | 'labeled', limit?: number(≤2), shard?: number }
//   한 번 호출에 2곡까지만 — 엣지 함수 CPU 한도(곡 6개면 WORKER_RESOURCE_LIMIT). 곡마다 바로 저장한다.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { MPEGDecoder } from 'npm:mpg123-decoder@1.0.3';
import { analyzeSegment, pickWindowStarts, summarizeSegments, SEGMENT_QC_VERSION, type SegmentFeatures } from '../_shared/segmentQcCore.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ENV_SECRET = (Deno.env.get('BRAND_ALERT_SECRET') ?? Deno.env.get('CRON_SECRET') ?? '').trim();
const WIN = 3;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

interface Job { id: string; audio_url: string; duration: number; content_length: number | null }

async function rangeBytes(url: string, start: number, end: number): Promise<Uint8Array> {
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
  if (!res.ok && res.status !== 206) throw new Error(`fetch ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function analyzeTrack(job: Job, decoder: MPEGDecoder) {
  let length = job.content_length ?? 0;
  if (!length) {
    const head = await fetch(job.audio_url, { method: 'HEAD' });
    length = Number(head.headers.get('content-length') ?? 0);
  }
  if (!length || !(job.duration > 0)) throw new Error('no length/duration');
  const bps = length / job.duration;
  const windows: SegmentFeatures[] = [];
  for (const at of pickWindowStarts(job.duration, 8, WIN)) {
    const start = Math.max(0, Math.floor(at * bps) - 4096);
    const end = Math.min(length - 1, Math.ceil((at + WIN + 0.5) * bps) + 8192);
    const bytes = await rangeBytes(job.audio_url, start, end);
    await decoder.reset();
    const r = decoder.decode(bytes);
    if (!r.sampleRate || !r.channelData?.length) continue;
    const skip = Math.floor(0.3 * r.sampleRate);
    const take = Math.floor(WIN * r.sampleRate);
    const ch = r.channelData.map((c) => c.subarray(skip, skip + take));
    if (ch[0].length < r.sampleRate) continue;
    windows.push(analyzeSegment({ at, sampleRate: r.sampleRate, channels: ch }));
  }
  if (windows.length < 3) throw new Error(`too few windows (${windows.length})`);
  return summarizeSegments(windows);
}

serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const given = (req.headers.get('x-cron-secret') ?? '').trim();
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  let ok = bearer === SERVICE_ROLE || (ENV_SECRET !== '' && given === ENV_SECRET);
  if (!ok && given) {
    const { data } = await sb.rpc('cron_secret_matches', { p_secret: given });
    ok = data === true;
  }
  if (!ok) return json({ error: 'unauthorized' }, 401);

  let mode = 'pending';
  let limit = 2;
  let shard = 1;
  try {
    const b = await req.json();
    if (b?.mode === 'labeled') mode = 'labeled';
    if (typeof b?.limit === 'number') limit = Math.max(1, Math.min(2, Math.floor(b.limit)));
    if (typeof b?.shard === 'number') shard = Math.max(1, Math.min(20, Math.floor(b.shard)));
  } catch { /* 빈 본문 허용 */ }

  const { data: jobs, error } = await sb.rpc('cron_next_segment_qc_batch', { p_limit: limit, p_mode: mode, p_offset: (shard - 1) * limit });
  if (error) return json({ error: error.message }, 500);

  const decoder = new MPEGDecoder();
  await decoder.ready;
  let analyzed = 0;
  let failed = 0;
  for (const job of (jobs ?? []) as Job[]) {
    let row: Record<string, unknown>;
    try {
      const s = await analyzeTrack(job, decoder);
      row = { track_id: job.id, version: SEGMENT_QC_VERSION, features: s.features, windows: s.windows };
    } catch (e) {
      row = { track_id: job.id, version: SEGMENT_QC_VERSION, error: String((e as Error)?.message ?? e) };
      failed++;
    }
    // 곡마다 바로 저장 — 중간에 한도로 끊겨도 앞 곡 결과는 남는다.
    const { error: e2 } = await sb.rpc('service_save_segment_qc', { p_rows: [row] });
    if (e2) { decoder.free(); return json({ error: e2.message, analyzed }, 500); }
    analyzed++;
  }
  decoder.free();
  return json({ mode, analyzed, failed });
});
