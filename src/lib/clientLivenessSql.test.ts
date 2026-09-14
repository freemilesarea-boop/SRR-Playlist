// 0524 마이그레이션의 안전 규칙을 소스 수준에서 고정한다.
//
// 이 파일이 막으려는 사고는 구체적이다: 숙대점은 heartbeat 가 끊기면 아무도
// 모른다. heartbeat RPC 를 잘못 건드리면 관측을 늘리려다 관측을 끊는다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LIVENESS_PAYLOAD_KEYS } from './clientLiveness';

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/0524_client_liveness_snapshot.sql'), 'utf-8');

const executable = sql.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');

describe('구버전 클라이언트를 끊지 않는다', () => {
  it('새 인자는 전부 default null 이다', () => {
    for (const arg of [
      'p_player_instance_id text default null',
      'p_last_audio_progress_at timestamptz default null',
      'p_visibility_state text default null',
      'p_client_online boolean default null',
      'p_realtime_status text default null',
      'p_wake_lock_active boolean default null',
    ]) {
      expect(sql).toContain(arg);
    }
  });

  it('옛 8인자 시그니처를 새 함수 생성 **전에** 지운다 (공존하면 ambiguous 로 heartbeat 가 끊긴다)', () => {
    const dropAt = sql.indexOf(
      'drop function if exists public.brand_player_heartbeat(uuid, text, uuid, text, text, text, boolean, text);');
    const createAt = sql.indexOf('create or replace function public.brand_player_heartbeat(');
    expect(dropAt).toBeGreaterThan(-1);
    expect(dropAt).toBeLessThan(createAt);
  });

  it('구버전이 보내는 null 이 이미 알던 값을 지우지 않는다', () => {
    for (const col of [
      'player_instance_id', 'visibility_state', 'client_online',
      'realtime_status', 'wake_lock_active',
    ]) {
      expect(executable).toMatch(new RegExp(`${col}\\s*=\\s*coalesce\\(`));
    }
  });

  it('명령 소비 경로(0520)를 그대로 보존한다 — 이 함수가 원격 복구의 fallback 이다', () => {
    expect(executable).toContain("delivery_source = coalesce(c.delivery_source, 'heartbeat')");
    expect(executable).toContain('for update skip locked');
    expect(executable).toContain('where expires_at > now()');
  });

  it('16A build identity 필드를 그대로 유지한다', () => {
    for (const col of ['page_build_hash', 'sw_build_hash', 'sw_controlled', 'navigation_type']) {
      expect(executable).toContain(col);
    }
  });
});

describe('클라이언트가 보낸 값을 그대로 믿지 않는다', () => {
  it('visibility / realtime 은 화이트리스트만 저장한다', () => {
    expect(sql).toContain("p_visibility_state in ('visible','hidden','prerender','unloaded')");
    expect(sql).toContain("p_realtime_status in ('SUBSCRIBED','TIMED_OUT','CLOSED','CHANNEL_ERROR')");
  });

  it('미래 시각을 받지 않는다 — 기기 시계가 틀어져도 죽은 플레이어가 싱싱해 보이면 안 된다', () => {
    expect(executable).toContain('least(p_last_audio_progress_at, now())');
  });

  it('마지막 진행 시각은 뒤로 가지 않는다', () => {
    expect(executable).toContain('greatest(last_audio_progress_at, v_progress)');
  });
});

describe('권한', () => {
  it('anon 에게 EXECUTE 를 주지 않는다', () => {
    expect(sql).toMatch(/revoke all on function public\.brand_player_heartbeat\([\s\S]*?from public, anon;/);
    expect(sql).toMatch(/grant execute on function public\.brand_player_heartbeat\([\s\S]*?to authenticated, service_role;/);
  });
});

describe('감지 체계를 건드리지 않는다', () => {
  it('0522 의 감지·알림 경로를 재정의하지 않는다 (오늘 실전에서 처음 작동한 경로다)', () => {
    for (const bad of [
      'detect_brand_player_incidents',
      '_brand_player_liveness',
      '_brand_player_session_health',
      'admin_brand_player_health',
      '_notify_brand_player_alert',
      'cron.schedule',
      'cron.alter_job',
    ]) {
      expect(executable).not.toContain(bad);
    }
  });

  it('파괴적 DDL 이 없다', () => {
    for (const bad of ['drop table', 'drop column', 'truncate', 'delete from', 'alter column']) {
      expect(executable.toLowerCase()).not.toContain(bad);
    }
  });
});

describe('컬럼과 클라이언트 페이로드가 1:1 이다', () => {
  it('LIVENESS_PAYLOAD_KEYS 의 6개가 모두 컬럼으로 존재한다', () => {
    const colFor: Record<string, string> = {
      playerInstanceId: 'player_instance_id',
      lastAudioProgressAt: 'last_audio_progress_at',
      visibilityState: 'visibility_state',
      online: 'client_online',
      realtimeStatus: 'realtime_status',
      wakeLockActive: 'wake_lock_active',
      storageUsageBytes: 'storage_usage_bytes',
      storageQuotaBytes: 'storage_quota_bytes',
      jsHeapUsedBytes: 'js_heap_used_bytes',
      audioReadyState: 'audio_ready_state',
      audioNetworkState: 'audio_network_state',
    };
    expect(LIVENESS_PAYLOAD_KEYS).toHaveLength(11);
    // 0524 가 6개, 0526 이 나머지 5개를 만든다.
    const sql26 = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/0526_device_resource_telemetry.sql'), 'utf-8');
    for (const k of LIVENESS_PAYLOAD_KEYS) {
      const decl = `add column if not exists ${colFor[k]}`;
      expect(sql.includes(decl) || sql26.includes(decl)).toBe(true);
    }
  });
});
