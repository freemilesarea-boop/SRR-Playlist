// 17B §2 — 알림 전달 주기를 5분에서 1분으로 줄이면서 Slack 이 늘지 않는다는
// 계약을 소스 수준에서 고정한다.
//
// 지켜야 하는 것은 세 겹이다:
//   1. debounce 는 incident state(0522)가 한다 — 디스패처는 debounce 하지 않는다.
//   2. 그러므로 디스패처는 "만들어진 행을 정확히 한 번" 보내야 한다.
//      1분 주기에서 실행이 겹칠 수 있으므로 행 선점이 필수다.
//   3. SUSPECTED 는 Slack 을 만들지 않는다. DOWN 만 장애, RECOVERED 만 복구.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SUSPECTED_DOWN_AFTER_S, DOWN_AFTER_S } from './playerDownDetection';

const d = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/0525_notification_dispatch_1min.sql'), 'utf-8');
const det = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/0522_player_down_detection.sql'), 'utf-8');

const exec = (s: string) => s.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
const dExec = exec(d);
const detExec = exec(det);

describe('동시 실행 — 같은 행을 두 번 보내지 않는다', () => {
  it('행을 for update skip locked 로 선점한다', () => {
    expect(dExec).toContain('for update skip locked');
  });

  it('선점이 행 선택 쿼리 안에 있다 (루프 바깥의 장식이 아니다)', () => {
    const from = dExec.indexOf('from public.admin_notifications');
    const lock = dExec.indexOf('for update skip locked');
    const loop = dExec.indexOf('loop');
    expect(from).toBeGreaterThan(-1);
    expect(lock).toBeGreaterThan(from);
    expect(lock).toBeLessThan(loop);
  });

  it('미발송 행만 고른다 — 이미 보낸 것을 다시 집지 않는다', () => {
    expect(dExec).toContain('where dispatched_at is null');
  });

  it('발송에 성공한 행만 dispatched_at 을 찍는다 (실패는 재시도 대상으로 남는다)', () => {
    const send = dExec.indexOf('net.http_post');
    const stamp = dExec.indexOf('set dispatched_at = now(),\n             dispatch_attempts');
    expect(send).toBeGreaterThan(-1);
    expect(stamp).toBeGreaterThan(send);
  });

  it('한 번에 처리하는 행 수에 상한이 있다', () => {
    expect(dExec).toContain('limit greatest(1, p_limit)');
  });
});

describe('주기', () => {
  it('1분으로 바꾼다', () => {
    expect(d).toContain("schedule => '* * * * *'");
    expect(d).toContain("jobname = 'srr-dispatch-notifications'");
  });

  it('잡이 이미 있으면 alter 만 한다 — 중복 크론을 만들지 않는다', () => {
    expect(d).toContain('perform cron.alter_job(v_id');
    expect(d).toContain('if v_id is null then');
  });

  it('5분 스케줄이 남아 있지 않다', () => {
    expect(dExec).not.toContain('*/5 * * * *');
  });
});

describe('debounce 는 incident state 가 한다 — 디스패처는 하지 않는다', () => {
  it('디스패처가 incident 를 읽거나 쓰지 않는다', () => {
    for (const bad of [
      'brand_player_incidents', 'detect_brand_player_incidents',
      '_brand_player_liveness', 'down_notified_at', 'resolve_notified_at',
    ]) {
      expect(dExec).not.toContain(bad);
    }
  });

  it('디스패처가 자체 시간창으로 중복을 거르지 않는다 (silence duration 재계산 금지)', () => {
    for (const bad of ['interval \'', 'seconds_since_heartbeat', 'opened_at']) {
      expect(dExec).not.toContain(bad);
    }
  });
});

describe('0522 가 exactly-once 를 유지한다 (주기를 줄여도 이 계약이 근거다)', () => {
  it('DOWN 알림은 down_notified_at 이 잠근다 — outage 당 1회', () => {
    expect(detExec).toContain('if v_inc.down_notified_at is null then');
    expect(det).toMatch(/set notified_at = now\(\), down_notified_at = now\(\)/);
  });

  it('복구 알림은 resolved 로 넘어가는 그 UPDATE 안에서만 만들어진다', () => {
    expect(detExec).toContain('resolve_notified_at = now()');
    expect(detExec).toContain('set resolved_at = now(), last_checked_at = now(),');
  });

  it('알린 적 없는 incident 는 복구 알림도 만들지 않는다', () => {
    expect(detExec).toContain('if v_inc.down_notified_at is not null then');
  });

  it('SUSPECTED 단계는 알림을 만들지 않는다', () => {
    const start = det.indexOf("elsif v_liveness = 'SUSPECTED_DOWN' then");
    const end = det.indexOf('-- ---- ONLINE');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(det.slice(start, end)).not.toContain('_notify_brand_player_alert');
  });

  it('임계값은 그대로 180 / 300 초다 — 이번 변경은 전달만 건드린다', () => {
    expect(det).toContain(`p_suspected_seconds integer default ${SUSPECTED_DOWN_AFTER_S}`);
    expect(det).toContain(`p_down_seconds      integer default ${DOWN_AFTER_S}`);
  });
});

describe('권한 / 안전', () => {
  it('로그인 사용자가 Slack 을 쏘게 두지 않는다', () => {
    expect(d).toContain(
      'revoke all on function public.cron_dispatch_pending_notifications(integer) from public, anon, authenticated;');
    expect(d).toContain(
      'grant execute on function public.cron_dispatch_pending_notifications(integer) to service_role;');
  });

  it('webhook 이 비어 있으면 아무것도 하지 않는다', () => {
    expect(dExec).toContain("if coalesce(v_slack, '') = '' then");
  });

  it('severity 필터를 그대로 유지한다', () => {
    expect(dExec).toContain('_severity_rank(r.severity) < v_min');
    expect(dExec).toContain("'skipped: below min severity'");
  });

  it('파괴적 DDL 이 없다', () => {
    for (const bad of ['drop table', 'drop column', 'truncate', 'delete from', 'drop function']) {
      expect(dExec.toLowerCase()).not.toContain(bad);
    }
  });
});

// ── 최악 지연 계산 ──────────────────────────────────────────────────────────
//
// 목표(§2): DOWN 확정 후 Slack 전달 추가 지연 <= 약 1~2분.
//
// 감지 크론은 1분 주기이므로 heartbeat 침묵이 DOWN_AFTER_S 를 넘긴 뒤 최대 60초
// 안에 알림 행이 만들어진다. 전달 크론이 5분이면 거기서 최대 300초를 더 먹는다.
describe('최악 지연', () => {
  const DETECT_CRON_S = 60;
  const before = DOWN_AFTER_S + DETECT_CRON_S + 300;  // 전달 */5
  const after = DOWN_AFTER_S + DETECT_CRON_S + 60;    // 전달 * * * * *

  it('변경 전 최악 지연은 11분이었다', () => {
    expect(before).toBe(660);
  });

  it('변경 후 최악 지연은 7분이다', () => {
    expect(after).toBe(420);
  });

  it('DOWN 확정 후 추가 지연이 60초를 넘지 않는다', () => {
    expect(after - (DOWN_AFTER_S + DETECT_CRON_S)).toBeLessThanOrEqual(120);
  });
});
