// 0533 — 감시 기기가 꺼진 뒤 "매장이 실제로 조용한가" 를 따로 본다.
//
// 2026-10-01 숙대점: 05:19 브랜드 플레이어 '나가기' → 05:36 홈 화면에서 재생 →
// 12:44 배포 리로드로 재생 멈춤 → 17:3x 알바생 발견. incident 는 05:22 부터 열려 있어
// 12:44 의 진짜 무음은 아무 신호도 만들지 못했다.
//
// 실행 검증(로컬 Postgres 16, 스텁 스키마)으로 위 타임라인을 재생했다:
//   DOWN('나가기' 문구) → [참고] 다른 화면 재생 → 6시간 리마인더 없음 → 200초 공백 무시
//   → 400초 무신호 [긴급] → 중복 없음 → 6시간 뒤 리마인더 → 감시 기기 복귀 시 해소.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/0533_store_audio_elsewhere.sql'), 'utf-8');
const exec = sql.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');

describe('다른 화면 재생은 incident 를 닫지 않는다 (0528 FALSE RECOVERY 방지 유지)', () => {
  it('liveness 를 다시 만들지 않는다', () => {
    expect(exec).not.toContain('function public._brand_player_liveness');
  });

  it('판정 분기는 감시 기기 값만 본다 — stream_sessions_v2 는 판정 뒤에 읽힌다', () => {
    const judge = exec.indexOf("v_liveness := 'ONLINE'; v_detection := null;\n    end if;");
    const elsewhere = exec.indexOf('from public.stream_sessions_v2 s');
    expect(judge).toBeGreaterThan(-1);
    expect(elsewhere).toBeGreaterThan(judge);
  });

  it('다른 화면 추적은 silence 일 때만, DOWN 분기 안에서만 돈다', () => {
    const down = exec.indexOf("if v_liveness = 'DOWN' then");
    const suspected = exec.indexOf("elsif v_liveness = 'SUSPECTED_DOWN' then");
    const guard = exec.indexOf("if v_detection = 'silence' then");
    expect(guard).toBeGreaterThan(down);
    expect(guard).toBeLessThan(suspected);
  });

  it('해소 쪽은 resolved_at 을 다른 화면 값으로 건드리지 않는다', () => {
    const start = exec.indexOf("if v_detection = 'silence' then");
    const end = exec.indexOf('if v_inc.down_notified_at is null then', start);
    expect(end).toBeGreaterThan(start);
    const block = exec.slice(start, end);
    expect(block).not.toContain('resolved_at');
  });
});

describe('전환 알림과 리마인더', () => {
  it('켜짐 180초 / 꺼짐 300초 히스테리시스', () => {
    expect(exec).toContain('v_else_at > now() - make_interval(secs => p_suspected_seconds) then true');
    expect(exec).toContain('v_else_at <= now() - make_interval(secs => p_down_seconds) then false');
    expect(exec).toContain('else v_else_prev end;');
  });

  it('다른 화면 재생 중에는 "멈춰 있습니다" 리마인더를 보내지 않는다', () => {
    expect(exec).toMatch(/if not v_else_now\s+and v_inc\.reminder_count < p_max_reminders/);
  });

  it('다른 화면 재생도 멈추면 긴급(critical) 으로 알리고 리마인더 주기를 다시 센다', () => {
    expect(exec).toContain("'detection', 'silence_elsewhere'");
    expect(exec).toContain('set reminded_at = now(), reminder_count = 0');
  });

  it('참고 알림 이벤트명이 푸시 디스패처의 정보 분기와 같다 (긴급·매장 복구 푸시 금지)', () => {
    expect(exec).toContain("'event', 'brand_player_audio_elsewhere', 'severity', 'info'");
    const fn = readFileSync(
      resolve(process.cwd(), 'supabase/functions/dispatch-brand-player-alerts/index.ts'), 'utf-8');
    expect(fn).toContain("payload.event === 'brand_player_audio_elsewhere'");
    expect(fn).toContain('if (!isInfo) {');
  });

  it('권한은 0527 과 같다', () => {
    expect(exec).toContain('revoke all on function public.detect_brand_player_incidents(integer, integer, integer, integer)');
    expect(exec).toMatch(/grant execute on function public\.detect_brand_player_incidents\(integer, integer, integer, integer\)\s+to service_role;/);
  });
});

describe('진단 이벤트 CHECK 가 클라이언트와 정확히 일치한다 (최신 CHECK)', () => {
  it('player_exit 를 포함해 DiagnosticEvent 유니온과 같다', () => {
    const start = exec.indexOf('add constraint store_playback_diagnostics_event_check');
    const block = exec.slice(start, exec.indexOf('));', start));
    const allowed = [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    const ts = readFileSync(resolve(process.cwd(), 'src/lib/playbackDiagnostics.ts'), 'utf-8');
    const union = ts.slice(ts.indexOf('export type DiagnosticEvent'), ts.indexOf('export type DiagnosticReason'));
    const declared = [...union.matchAll(/\|?\s*'([a-z_]+)'/g)].map((m) => m[1]);
    expect(allowed).toContain('player_exit');
    expect(new Set(allowed)).toEqual(new Set(declared));
  });

  it('브랜드 플레이어 나가기가 player_exit 를 남긴다 — pause 보다 먼저', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/pages/BrandPlayerPage.tsx'), 'utf-8');
    const start = page.indexOf('const exitPlayer = useCallback');
    const body = page.slice(start, page.indexOf('}, [', start));
    expect(body).toContain("beaconPlaybackDiagnostic('player_exit'");
    expect(body.indexOf("'player_exit'")).toBeLessThan(body.indexOf('pause();'));
  });
});
