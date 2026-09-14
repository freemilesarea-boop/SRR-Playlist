// 0522 마이그레이션의 계약을 소스 수준에서 고정한다.
//
// 경계값과 상태 전이는 playerDownDetection.test.ts 가 지킨다. 여기서는 SQL 이
// **같은 숫자**를 쓰는지, 그리고 안전 규칙을 되돌리지 않았는지만 본다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SUSPECTED_DOWN_AFTER_S, DOWN_AFTER_S } from './playerDownDetection';

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/0522_player_down_detection.sql'), 'utf-8');

describe('경계값이 TS 정본과 같다', () => {
  it('SUSPECTED / DOWN 기본값이 180 / 300 초', () => {
    expect(sql).toContain(`p_suspected_seconds integer default ${SUSPECTED_DOWN_AFTER_S}`);
    expect(sql).toContain(`p_down_seconds      integer default ${DOWN_AFTER_S}`);
  });

  it('DOWN 을 먼저 보고 그 다음 SUSPECTED 를 본다 (순서가 뒤집히면 DOWN 이 영영 안 뜬다)', () => {
    const down = sql.indexOf('b.heartbeat_age_seconds >= p_down_seconds');
    const susp = sql.indexOf('b.heartbeat_age_seconds >= p_suspected_seconds');
    expect(down).toBeGreaterThan(-1);
    expect(susp).toBeGreaterThan(-1);
    expect(down).toBeLessThan(susp);
  });
});

describe('한 outage 당 DOWN Slack 정확히 1회', () => {
  it('down_notified_at 이 잠금 역할을 한다', () => {
    expect(sql).toContain('add column if not exists down_notified_at  timestamptz');
    expect(sql).toContain('if v_inc.down_notified_at is null then');
    expect(sql).toMatch(/set notified_at = now\(\), down_notified_at = now\(\)/);
  });

  it('SUSPECTED 단계에서는 _notify_brand_player_alert 를 부르지 않는다', () => {
    const start = sql.indexOf("elsif v_liveness = 'SUSPECTED_DOWN' then");
    const end = sql.indexOf('-- ---- ONLINE');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(sql.slice(start, end)).not.toContain('_notify_brand_player_alert');
  });

  it('알린 적 없는 incident 는 복구 알림도 보내지 않는다', () => {
    expect(sql).toContain('if v_inc.down_notified_at is not null then');
  });
});

describe('오탐 방지', () => {
  it('감시 제외 계정과 영업 종료는 무조건 ONLINE', () => {
    expect(sql).toContain('if b.monitoring_exempt or not b.playback_expected then');
    expect(sql).toContain('resolve_brand_playback_window');
  });

  it('revoked 세션은 heartbeat 집계에서 빠진다 (_brand_player_session_health 가 이미 거른다)', () => {
    expect(sql).toContain('revoked');
  });

  it('생존 판정 출처는 brand_player_sessions 하나뿐이다 (session-scope 보장)', () => {
    // stream_sessions_v2 는 FK 가 없어 user_id 로만 합쳐진다 — revoked 제외가
    // 우회되어 죽은 플레이어를 ONLINE 으로 붙잡을 수 있다. 실행 SQL 에서 제외한다.
    const executable = sql.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
    expect(executable).not.toContain('stream_sessions_v2');
    expect(executable).toContain('_brand_player_session_health');
  });

  it('매장당 canonical session 은 heartbeat 가 가장 싱싱한 한 줄이다', () => {
    expect(sql).toContain('select distinct on (h.user_id) h.*');
    expect(sql).toContain('order by h.user_id, h.seconds_since_heartbeat asc');
  });

  it('기존 stalled 경로를 없애지 않았다', () => {
    expect(sql).toContain('b.seconds_on_current_track >= b.stall_threshold_seconds');
    expect(sql).toContain("v_detection := 'stalled'");
  });
});

describe('보안', () => {
  it('Recovery Console URL 을 SQL 이 직접 조립하지 않는다 (허용 호스트 검사는 Edge 쪽)', () => {
    expect(sql).not.toContain("'/admin?tab=brand-player&store='");
    expect(sql).not.toMatch(/recovery_console_base_url/);
  });

  it('알림 context 에 store_user_id 를 실어 Edge 가 링크를 만들 수 있게 한다', () => {
    expect(sql).toContain("'store_user_id', b.user_id");
  });

  it('새 함수에 public·anon EXECUTE 를 주지 않는다', () => {
    expect(sql).toContain(
      'revoke all on function public._brand_player_liveness(integer) from public, anon;');
    expect(sql).toContain(
      'revoke all on function public.detect_brand_player_incidents(integer, integer, integer, integer) from public, anon;');
  });

  it('옛 3인자 시그니처(20분 grace)를 새 함수 생성 **전에** 지운다', () => {
    // 둘이 공존하는 동안 무인자 호출은 ambiguous 로 실패한다 — 크론이 그 틈에 돈다.
    const dropAt = sql.indexOf(
      'drop function if exists public.detect_brand_player_incidents(integer, integer, integer);');
    const createAt = sql.indexOf('create or replace function public.detect_brand_player_incidents(');
    expect(dropAt).toBeGreaterThan(-1);
    expect(dropAt).toBeLessThan(createAt);
  });
});

describe('크론', () => {
  it('300초 임계가 의미를 가지려면 1분 주기여야 한다', () => {
    expect(sql).toContain("schedule => '* * * * *'");
    expect(sql).toContain("jobname = 'srr-brand-player-health'");
  });

  it('잡이 이미 있으면 alter 만 한다 — 중복 크론을 만들지 않는다', () => {
    expect(sql).toContain('perform cron.alter_job(v_id');
    expect(sql).toContain('if v_id is null then');
  });
});
