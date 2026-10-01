import { describe, it, expect } from 'vitest';
import { planOneClickRecovery, SHELL_STALE_SECONDS } from './oneClickRecovery';
import { SHELL_LAYER_STALE_MS } from './recoveryControlPlane';

describe('§4 버튼 하나 — 운영자는 종류를 고르지 않는다', () => {
  it('플레이어가 응답하면 문서를 유지한 채 오디오만 되살린다', () => {
    const p = planOneClickRecovery({ status: 'playing', secondsSinceHeartbeat: 20, shellAgeSeconds: 3 });
    expect(p.command).toBe('hard_recovery');
    expect(p.mayNotReach).toBe(false);
  });

  it('★ 2026-09-15 의 칸 — 플레이어만 멈추고 셸은 살아 있다', () => {
    const p = planOneClickRecovery({
      status: 'offline', secondsSinceHeartbeat: 17 * 60 + 19, shellAgeSeconds: 5,
    });
    expect(p.command).toBe('reload');
    expect(p.mayNotReach).toBe(false);          // 셸이 받는다
    expect(p.label).toContain('앱은 살아 있어');
  });

  it('셸도 조용하면 되는 척하지 않는다', () => {
    const p = planOneClickRecovery({
      status: 'offline', secondsSinceHeartbeat: 3_600, shellAgeSeconds: SHELL_STALE_SECONDS,
    });
    expect(p.label).toBe('기기 응답 없음 — 웹 복구 불가');
    expect(p.mayNotReach).toBe(true);
  });

  it('셸 생존을 모르면 모른다고 하고 경고를 붙인다 (0528 적용 전)', () => {
    const p = planOneClickRecovery({ status: 'offline', secondsSinceHeartbeat: 600 });
    expect(p.command).toBe('reload');
    expect(p.mayNotReach).toBe(true);
  });

  it('stalled 는 문서가 살아 있으므로 reload 까지 가지 않는다', () => {
    expect(planOneClickRecovery({ status: 'stalled', secondsSinceHeartbeat: 30 }).command)
      .toBe('hard_recovery');
  });

  it('관리자 화면과 클라이언트가 같은 셸 기준을 쓴다', () => {
    expect(SHELL_STALE_SECONDS * 1_000).toBe(SHELL_LAYER_STALE_MS);
  });
});
