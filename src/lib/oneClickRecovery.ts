/**
 * oneClickRecovery.ts — 버튼 하나가 고를 것을 서버 상태로 결정한다.
 *
 * 운영자는 장애 종류를 판단하지 않는다. Play / Next / 페이지 재시작 중 무엇을
 * 눌러야 하는지는 우리가 알아야 할 일이지 매장 담당자가 알 일이 아니다.
 *
 * ── 판정에 쓰는 것 ──────────────────────────────────────────────────────────
 * 오늘 관리자 화면이 가진 값은 admin_brand_player_health 의 status 와
 * seconds_since_heartbeat 뿐이다. 셸 생존(shell_last_seen_at)은 0528 이 적용되고
 * 매장이 새 빌드를 받은 뒤에야 온다 — 그때까지 RUNG 2 와 RUNG 3 을 서버에서
 * 가를 수 없다. **가를 수 없는 것을 가른 척하지 않는다.**
 *
 * 다만 그 구분이 없어도 버튼은 옳게 동작한다:
 *   플레이어가 응답하면      → hard_recovery (문서를 유지한 채 오디오만 되살린다)
 *   heartbeat 가 끊겼으면    → reload (제어면이 셸에서 받으므로, 셸이 살아 있으면 닿는다)
 *
 * 2026-09-15 숙대점이 정확히 두 번째다 — 플레이어는 멈췄고 셸은 26분 38초 동안
 * 살아 있었다. 그때 reload 를 셸이 받았다면 복구됐을 것이다. 받을 수 없었던 이유는
 * 수신기가 죽은 쪽에 있었기 때문이고, 그건 이번 Phase 에서 고쳤다.
 */
import type { BrandPlayerCommand } from '@/lib/api/brandPlayerApi';

/** admin_brand_player_health 의 status. 0522 가 정한 값이다. */
export type HealthStatus = 'playing' | 'stalled' | 'offline';

export interface OneClickInput {
  status: HealthStatus;
  secondsSinceHeartbeat: number;
  /** 0528 + 새 빌드 이후에만 값이 온다. null 은 "모른다" 이지 "죽었다" 가 아니다. */
  shellAgeSeconds?: number | null;
}

export interface OneClickPlan {
  command: BrandPlayerCommand;
  /** 운영자에게 보여줄 한 줄. 되는 척하지 않는다. */
  label: string;
  /** 명령이 배달되지 못할 수 있음을 알려야 하는가. */
  mayNotReach: boolean;
}

/**
 * 셸이 조용하다고 볼 시간.
 *
 * 셸 폴링 주기 5초의 12배. recoveryControlPlane.SHELL_LAYER_STALE_MS 와 같은 값을
 * 초로 쓴다 — 클라이언트와 관리자 화면이 다른 기준을 쓰면 서로 다른 말을 한다.
 */
export const SHELL_STALE_SECONDS = 60;

export function planOneClickRecovery(i: OneClickInput): OneClickPlan {
  // 셸 생존을 아는 경우 — 0528 적용 후.
  if (typeof i.shellAgeSeconds === 'number') {
    if (i.shellAgeSeconds >= SHELL_STALE_SECONDS) {
      return {
        command: 'reload',
        label: '기기 응답 없음 — 웹 복구 불가',
        mayNotReach: true,
      };
    }
    if (i.status === 'playing') {
      return { command: 'hard_recovery', label: '플레이어 응답 중 — 오디오를 되살립니다', mayNotReach: false };
    }
    return {
      command: 'reload',
      label: '플레이어만 멈춤 — 앱은 살아 있어 복구를 시도합니다',
      mayNotReach: false,
    };
  }

  // 셸 생존을 모르는 경우 — 오늘.
  if (i.status === 'playing' || i.status === 'stalled') {
    return { command: 'hard_recovery', label: '플레이어 응답 중 — 오디오를 되살립니다', mayNotReach: false };
  }
  return {
    command: 'reload',
    label: 'heartbeat 끊김 — 플레이어를 다시 띄웁니다',
    // 셸까지 죽었으면 닿지 않는다. 그 구분이 아직 없으므로 정직하게 경고한다.
    mayNotReach: true,
  };
}
