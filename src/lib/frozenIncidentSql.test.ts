// 0527 마이그레이션의 계약을 소스 수준에서 고정한다.
//
// 2026-09-15 숙대점: heartbeat 는 60초마다 멀쩡히 왔고 곡도 26번 넘어갔는데
// 27분간 소리가 없었다. 서버의 두 감지 경로(silence / stalled)가 **구조적으로**
// 볼 수 없는 모양이었다. 여기서는 새 경로(frozen)가 그 모양을 잡는지,
// 그리고 기존 두 경로와 안전 규칙을 되돌리지 않았는지만 본다.
//
// 경계값의 정본은 playerDownDetection.ts 다 — frozen 은 새 숫자를 만들지 않고
// silence 와 같은 180 / 300 을 쓴다(migration 주석의 a·b·c 근거).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SUSPECTED_DOWN_AFTER_S, DOWN_AFTER_S } from './playerDownDetection';
import { RELOAD_PAGE_AFTER_MS } from './stallWatchdog';

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/0527_audio_pipeline_frozen_detection.sql'), 'utf-8');

/** 주석을 뺀 실행 SQL — 주석에 쓴 단어가 테스트를 통과시키면 안 된다. */
const executable = sql.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');

describe('§8 frozen — 클라이언트는 살아 있는데 타임라인이 안 간다', () => {
  it('detection / status 에 frozen 이 기존 값과 나란히 추가된다 (새 테이블 없음)', () => {
    expect(executable).toContain("check (status in ('stalled', 'offline', 'frozen'))");
    expect(executable).toContain("v_detection := 'frozen'");
  });

  it('frozen 은 heartbeat 가 싱싱할 때만 본다 — 프로세스 사망은 silence 가 잡는다', () => {
    const silenceDown = executable.indexOf('b.heartbeat_age_seconds >= p_down_seconds');
    const silenceSusp = executable.indexOf('b.heartbeat_age_seconds >= p_suspected_seconds');
    const frozenDown = executable.indexOf('b.audio_progress_age_seconds >= p_down_seconds');
    const frozenSusp = executable.indexOf('b.audio_progress_age_seconds >= p_suspected_seconds');
    for (const i of [silenceDown, silenceSusp, frozenDown, frozenSusp]) expect(i).toBeGreaterThan(-1);
    // silence 두 칸이 먼저 걸러진 뒤에야 frozen 을 본다.
    expect(silenceDown).toBeLessThan(frozenDown);
    expect(silenceSusp).toBeLessThan(frozenDown);
    // DOWN 을 SUSPECTED 보다 먼저 본다 (뒤집히면 DOWN 이 영영 안 뜬다).
    expect(frozenDown).toBeLessThan(frozenSusp);
  });

  it('last_audio_progress_at 이 null 이면 판정하지 않는다 (구버전 클라이언트 오탐 방지)', () => {
    // DOWN·SUSPECTED 두 칸 모두 null 가드를 달고 있어야 한다.
    const guards = executable.match(/b\.audio_progress_age_seconds is not null/g) ?? [];
    expect(guards.length).toBe(2);
    // liveness 도 null 을 0 으로 채우지 않는다.
    expect(executable).toContain('case when bps.last_audio_progress_at is null then null');
  });

  it('frozen 은 새 임계값을 만들지 않는다 — silence 와 같은 180 / 300 을 쓴다', () => {
    expect(sql).toContain(`p_suspected_seconds integer default ${SUSPECTED_DOWN_AFTER_S}`);
    expect(sql).toContain(`p_down_seconds      integer default ${DOWN_AFTER_S}`);
    // 그리고 그 값은 클라이언트 사다리의 마지막 칸보다 **뒤**여야 한다.
    // 서버가 클라이언트 자체 복구보다 먼저 소리치면 오탐이 된다.
    expect(SUSPECTED_DOWN_AFTER_S * 1_000).toBeGreaterThan(RELOAD_PAGE_AFTER_MS);
  });

  it('§11-K 이번 26곡 패턴은 incident 가 된다 — 27분은 DOWN 임계를 훨씬 넘는다', () => {
    const SUKDAE_OUTAGE_SEC = 27 * 60;
    expect(SUKDAE_OUTAGE_SEC).toBeGreaterThanOrEqual(DOWN_AFTER_S);
  });

  it('§8 한 번의 transient freeze 로는 DOWN 이 되지 않는다', () => {
    // 클라이언트 사다리가 끝까지 가는 데 걸리는 최대 시간(150초)에 갇힌 정지는
    // SUSPECTED(180초)에도 닿지 못한다. 즉 incident 자체가 열리지 않는다.
    expect(RELOAD_PAGE_AFTER_MS / 1_000).toBeLessThan(SUSPECTED_DOWN_AFTER_S);
  });

  it('SUSPECTED 단계에서는 Slack 을 보내지 않는다 (frozen 도 예외 없음)', () => {
    const start = executable.indexOf("elsif v_liveness = 'SUSPECTED_DOWN' then");
    const end = executable.indexOf("elsif v_inc.id is not null then");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(executable.slice(start, end)).not.toContain('_notify_brand_player_alert');
  });

  it('클라이언트 자가보고(audio_frozen)는 방증이지 판정 근거가 아니다', () => {
    // 카운트는 context 에만 실린다. 조건문에 등장하면 구버전 클라이언트가
    // 있는 매장은 영영 감지되지 않는다.
    expect(executable).toContain("'frozen_reports', v_frozen_reports");
    expect(executable).not.toMatch(/if\s+v_frozen_reports/);
  });
});

describe('§7 진단 이벤트가 서버에서 조용히 버려지지 않는다', () => {
  // store_playback_diagnostics.event CHECK 는 0512 의 8개에서 멈춰 있었고
  // log_store_playback_diagnostic 은 `exception when others then return` 이라
  // CHECK 위반을 삼켰다. 그래서 update_* 가 전 매장 0건이었다(Phase 24 미해결 결함).
  // audio_frozen 도 고치지 않으면 같은 자리에서 사라진다.
  const REQUIRED = [
    'session_start', 'page_frozen', 'page_resumed', 'page_hidden',
    'autoplay_blocked', 'autoplay_recovered', 'track_cut_short', 'playback_stalled',
    'update_pending', 'update_activated', 'update_blocked',
    'sw_controllerchange', 'audio_frozen',
  ];

  it('클라이언트가 보내는 13종이 전부 CHECK 에 있다', () => {
    const start = executable.indexOf('add constraint store_playback_diagnostics_event_check');
    expect(start).toBeGreaterThan(-1);
    const block = executable.slice(start, executable.indexOf('));', start));
    for (const ev of REQUIRED) expect(block).toContain(`'${ev}'`);
  });

  it('DiagnosticEvent 유니온과 CHECK 목록이 어긋나지 않는다', () => {
    const ts = readFileSync(resolve(process.cwd(), 'src/lib/playbackDiagnostics.ts'), 'utf-8');
    const union = ts.slice(ts.indexOf('export type DiagnosticEvent'), ts.indexOf('export type DiagnosticReason'));
    const declared = [...union.matchAll(/\|?\s*'([a-z_]+)'/g)].map((m) => m[1]);
    expect(new Set(declared)).toEqual(new Set(REQUIRED));
  });
});

describe('§10 verified_seconds 를 개명하지 않고 뜻만 박는다', () => {
  it('칸 주석이 벽시계 누적이라고 명시한다', () => {
    expect(executable).toContain('comment on column public.stream_sessions_v2.verified_seconds');
    expect(sql).toContain('실제 소리가 났다는 증거가 아니다');
  });

  it('정산이 읽는 칸을 alter/rename 하지 않는다', () => {
    expect(executable).not.toMatch(/alter\s+table\s+public\.stream_sessions_v2/i);
    expect(executable).not.toMatch(/rename\s+column/i);
  });
});

describe('§12 기존 경로 회귀 금지', () => {
  it('silence 경로가 그대로 있다', () => {
    expect(executable).toContain("v_detection := 'silence'");
  });

  it('stalled 경로가 그대로 있다', () => {
    expect(executable).toContain('b.seconds_on_current_track >= b.stall_threshold_seconds');
    expect(executable).toContain("v_detection := 'stalled'");
  });

  it('감시 제외 계정과 영업 종료는 무조건 ONLINE', () => {
    expect(executable).toContain('if b.monitoring_exempt or not b.playback_expected then');
  });

  it('생존 판정 출처는 여전히 brand_player_sessions 하나뿐이다', () => {
    expect(executable).not.toContain('stream_sessions_v2 s');
    expect(executable).toContain('_brand_player_session_health');
    expect(executable).toContain('select distinct on (h.user_id) h.*');
  });

  it('한 outage 당 DOWN Slack 정확히 1회', () => {
    expect(executable).toContain('if v_inc.down_notified_at is null then');
    expect(executable).toMatch(/set notified_at = now\(\), down_notified_at = now\(\)/);
  });

  it('새 함수에 public·anon·authenticated EXECUTE 를 주지 않는다', () => {
    expect(executable).toContain(
      'revoke all on function public._brand_player_liveness(integer) from public, anon, authenticated;');
    expect(executable).toMatch(
      /revoke all on function public\.detect_brand_player_incidents\(integer, integer, integer, integer\)\s*\n?\s*from public, anon, authenticated;/);
    expect(executable).toContain('to service_role;');
  });

  it('Recovery Console URL 을 SQL 이 직접 조립하지 않는다', () => {
    expect(executable).not.toMatch(/recovery_console_base_url/);
    expect(executable).toContain("'store_user_id', b.user_id");
  });

  it('원격 복구 명령을 자동으로 넣지 않는다 — 감지와 알림까지만', () => {
    expect(executable).not.toMatch(/insert\s+into\s+public\.brand_player_commands/i);
    expect(executable).not.toMatch(/admin_enqueue_brand_player_command/);
  });
});
