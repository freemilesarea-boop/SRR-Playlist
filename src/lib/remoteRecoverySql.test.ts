// 0520 마이그레이션의 보안·호환 계약을 소스 수준에서 고정한다.
//
// 여기 있는 항목들은 프로덕션 DB 에서 실제로 실행해 확인했지만, 그 확인은 세션이
// 끝나면 사라진다. 다음 사람이 무심코 되돌리는 것을 막으려면 테스트로 남아야 한다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const M = (name: string) =>
  readFileSync(resolve(process.cwd(), 'supabase/migrations', name), 'utf-8');

const sql0520 = M('0520_realtime_recovery_delivery.sql');
const sql0519 = M('0519_remote_recovery_control.sql');

describe('15. Recovery Console 은 관리자만', () => {
  it('admin_brand_player_health 는 role=admin 을 확인하고 아니면 예외', () => {
    expect(sql0520).toMatch(/from public\.users u where u\.id = auth\.uid\(\) and u\.role = 'admin'/);
    expect(sql0520).toContain("raise exception 'unauthorized'");
  });

  it('health / ack 함수에 public·anon EXECUTE 를 주지 않는다', () => {
    expect(sql0520).toContain(
      'revoke all on function public.admin_brand_player_health(integer) from public, anon;');
    expect(sql0520).toContain(
      'revoke all on function public.ack_store_recovery(uuid, text, text, text, text) from public, anon;');
  });

  it('명령 생성(request_store_recovery)은 여전히 admin 전용이고 store 지목이 필수다', () => {
    expect(sql0519).toMatch(/admin only/);
    expect(sql0519).toContain('p_store_user_id');
  });
});

describe('매장 클라이언트 권한 — 읽기만, 자기 것만', () => {
  it('authenticated 에 SELECT 만 준다', () => {
    expect(sql0520).toContain('grant select on public.brand_player_commands to authenticated;');
    expect(sql0520).toContain(
      'revoke insert, update, delete on public.brand_player_commands from authenticated;');
  });

  it('anon 은 이 테이블에 아무 권한도 없다', () => {
    expect(sql0520).toContain('revoke all on public.brand_player_commands from anon;');
  });

  it('행 범위는 RLS 가 정한다 — 자기 매장만 (0519)', () => {
    expect(sql0519).toContain('using (store_user_id = auth.uid())');
  });
});

describe('17. heartbeat fallback 회귀 없음', () => {
  it('heartbeat 는 그대로 명령을 배달한다', () => {
    expect(sql0520).toContain("'command', v_cmd");
    expect(sql0520).toContain("'command_id', v_cmd_id");
  });

  it('반환 키는 추가만 됐다 — 구버전 클라이언트가 읽던 키가 그대로 있다', () => {
    expect(sql0520).toContain("'success', true");
    expect(sql0520).toContain("'session_id', v_sid");
  });

  it('Realtime 이 먼저 집어간 명령은 heartbeat 가 다시 배달하지 않는다 (무한 리로드 방지)', () => {
    expect(sql0520).toMatch(/and status = 'pending'/);
  });

  it('배달 경로를 각인한다 — Realtime 이 실제로 도는지 사후 판별용', () => {
    expect(sql0520).toContain("delivery_source = coalesce(c.delivery_source, 'heartbeat')");
    expect(sql0520).toContain("delivery_source = coalesce(delivery_source, 'realtime')");
  });

  it('delivery_source 는 두 값만 허용한다', () => {
    expect(sql0520).toMatch(/delivery_source in \('realtime', 'heartbeat'\)/);
  });
});

describe('명령 화이트리스트 회귀 없음', () => {
  it('웹이 실행하지 않는 명령은 서버도 거부한다 (0519)', () => {
    expect(sql0519).toMatch(/app_restart/);
    expect(sql0519).toMatch(/device_reboot/);
  });
});
