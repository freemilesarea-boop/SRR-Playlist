// Phase 27 §7 — incident 는 자기 기기만 본다.
//
// 2026-09-15 14:34:00 KST 숙대점에서 실제로 일어난 일을 고정한다:
//   태블릿(823034d7) 침묵 28분 41초 · Windows(b2e9e765) 생성 12초 전
//   → canonical 이 Windows 로 옮겨감 → incident RESOLVE + "복구됐습니다" Slack
//   → 매장은 여전히 조용했다.
//
// 라이브 데이터로 두 규칙을 나란히 돌린 결과(2026-09-15, 읽기 전용):
//   OLD(0522): windows · hb_age 37s     → ONLINE → FALSE RECOVERY
//   NEW(0528): mobile  · hb_age 5,716s  → DOWN   → incident 유지
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/0528_incident_device_affinity.sql'), 'utf-8');
/** 주석을 뺀 실행 SQL — 주석의 단어가 테스트를 통과시키면 안 된다. */
const exec = sql.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');

describe('§7 canonical 선택이 열린 incident 의 세션에 고정된다', () => {
  it('열린 incident 의 session_id 를 먼저 고른다', () => {
    expect(exec).toContain('from public.brand_player_incidents i');
    expect(exec).toContain('where i.resolved_at is null and i.session_id is not null');
    expect(exec).toMatch(
      /\(oi\.session_id is not null and h\.session_id = oi\.session_id\) desc/);
  });

  it('그 우선순위가 heartbeat 신선도보다 **앞선다** (뒤면 아무것도 안 바뀐다)', () => {
    const pin = exec.indexOf('oi.session_id = ') >= 0
      ? exec.indexOf('oi.session_id = ')
      : exec.indexOf('h.session_id = oi.session_id) desc');
    const fresh = exec.indexOf('h.seconds_since_heartbeat asc');
    expect(pin).toBeGreaterThan(-1);
    expect(fresh).toBeGreaterThan(pin);
  });

  it('incident 를 **여는** 규칙은 바꾸지 않는다 (열린 건이 없으면 종전대로 가장 싱싱한 세션)', () => {
    expect(exec).toContain('left join open_inc oi on oi.store_user_id = h.user_id');
    expect(exec).toContain('h.seconds_since_heartbeat asc');
  });

  it('detect_brand_player_incidents 본문을 건드리지 않는다 (0527 frozen 경로 보존)', () => {
    expect(exec).not.toContain('create or replace function public.detect_brand_player_incidents');
    expect(exec).not.toContain('drop function if exists public.detect_brand_player_incidents');
  });

  it('세션을 revoke 하거나 incident 행을 고치지 않는다', () => {
    expect(exec).not.toMatch(/update\s+public\.brand_player_incidents/i);
    expect(exec).not.toMatch(/set\s+revoked_at/i);
  });
});

describe('§8 셸 생존은 플레이어 생존과 **다른 칸**이다', () => {
  it('shell_last_seen_at 을 새로 만든다', () => {
    expect(exec).toContain('add column if not exists shell_last_seen_at timestamptz');
  });

  it('셸 폴링이 플레이어 생존 칸을 갱신하지 않는다 — 그러면 감시가 눈먼다', () => {
    const start = exec.indexOf('create or replace function public.brand_player_shell_poll');
    const end = exec.indexOf('$fn$;', start);
    const body = exec.slice(start, end);
    expect(body).toContain('set shell_last_seen_at = now()');
    expect(body).not.toContain('last_seen_at = now(),');
    expect(body).not.toContain('last_audio_progress_at');
    expect(body).not.toContain('current_track_id');
  });

  it('명령 소비 규약이 heartbeat 와 같다 (exactly-once 가 두 벌로 갈라지지 않게)', () => {
    const hb = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/0524_client_liveness_snapshot.sql'), 'utf-8');
    for (const clause of [
      'for update skip locked',
      "delivery_source = coalesce(c.delivery_source, 'heartbeat')",
      'received_at = coalesce(c.received_at, now())',
    ]) {
      expect(hb).toContain(clause);
      expect(exec).toContain(clause);
    }
  });

  it('anon 에게 EXECUTE 를 주지 않는다', () => {
    expect(exec).toContain(
      'revoke all on function public.brand_player_shell_poll(uuid, text) from public, anon;');
    expect(exec).toContain(
      'grant execute on function public.brand_player_shell_poll(uuid, text) to authenticated, service_role;');
  });
});

describe('§7 진단 이벤트 CHECK 가 클라이언트와 일치한다', () => {
  const REQUIRED = [
    'session_start', 'page_frozen', 'page_resumed', 'page_hidden',
    'autoplay_blocked', 'autoplay_recovered', 'track_cut_short', 'playback_stalled',
    'update_pending', 'update_activated', 'update_blocked',
    'sw_controllerchange', 'audio_frozen', 'app_error', 'shell_health',
  ];

  it('15종이 전부 허용된다', () => {
    const start = exec.indexOf('add constraint store_playback_diagnostics_event_check');
    const block = exec.slice(start, exec.indexOf('));', start));
    REQUIRED.forEach((e) => expect(block).toContain(`'${e}'`));
  });

  it('DiagnosticEvent 유니온과 어긋나지 않는다', () => {
    const ts = readFileSync(resolve(process.cwd(), 'src/lib/playbackDiagnostics.ts'), 'utf-8');
    const union = ts.slice(ts.indexOf('export type DiagnosticEvent'), ts.indexOf('export type DiagnosticReason'));
    const declared = [...union.matchAll(/\|?\s*'([a-z_]+)'/g)].map((m) => m[1]);
    expect(new Set(declared)).toEqual(new Set(REQUIRED));
  });
});

describe('§7 stable install identity 의 범위를 문서가 명시한다', () => {
  it('brand_player_sessions.id 를 쓰는 근거와 한계가 적혀 있다', () => {
    expect(sql).toContain('823034d7');           // 실제 install 이 문서 재시작을 넘긴 증거
    expect(sql).toContain('player_instance_id 는 문서마다 바뀌므로');
  });
});
