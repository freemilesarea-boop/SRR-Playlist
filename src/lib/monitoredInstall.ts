/**
 * monitoredInstall.ts — "이 매장의 진짜 재생기는 어느 install 인가".
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────────
 * 2026-09-15 숙대점에서 같은 계정에 세션이 둘이 됐다(매장 Android 태블릿 + 운영자
 * Windows). 감시·복구가 "가장 싱싱한 세션"을 고르는 바람에 죽은 매장 재생기가
 * 가려졌고 incident 가 FALSE RECOVERY 로 닫혔다.
 *
 * ── mobile / desktop 으로 가르지 않는다 ─────────────────────────────────────
 * 처음엔 "매장 재생기는 모바일" 로 가르려 했다. **틀렸다.** 화정점의 정상 매장
 * 재생기는 데스크톱이다(session 1177a528, 311.7시간 연속). UA·기기 종류는
 * 관찰 metadata 일 뿐 감시 신원이 아니다.
 *
 * ── 실제로 가르는 것: 얼마나 오래 그 자리에 있었는가 ────────────────────────
 * 매장 재생기는 **설치되어 계속 살아 있는** install 이다. 누군가 오늘 연 PC 탭이
 * 아니다. 실측(2026-09-15 15:5x KST):
 *
 *   숙대  823034d7  151.5h  mobile   ← 매장 재생기
 *   숙대  b2e9e765    1.4h  desktop  ← 오늘 열린 운영자 탭
 *   화정  1177a528  311.7h  desktop  ← 매장 재생기 (데스크톱이다)
 *
 * 경계는 새로 만들지 않는다 — 이 시스템이 이미 쓰는 24시간 창을 그대로 쓴다
 * (admin_brand_player_health(1440) · _brand_player_liveness(1440)).
 *
 * ── 애매하면 고르지 않는다 ──────────────────────────────────────────────────
 * 자리 잡은 install 이 둘 이상이면 우리는 모르는 것이다. 그때 "가장 싱싱한 것"으로
 * 넘어가면 2026-09-15 가 그대로 재현된다. **FAIL CLOSED** — 운영자에게 모른다고
 * 말하고 명령을 보내지 않는다.
 */

/** 이 시스템이 이미 쓰는 관찰 창. 새 숫자가 아니다. */
export const ESTABLISHED_INSTALL_MIN_AGE_HOURS = 24;

export interface SessionCandidate {
  sessionId: string;
  /** 세션 행 생성 이후 경과(시간). brand_player_sessions.created_at 기준. */
  ageHours: number;
  /** 관찰 metadata 일 뿐 — 판정에 쓰지 않는다. */
  deviceKind?: 'mobile' | 'desktop' | string | null;
}

export type MonitoredInstall =
  | { kind: 'resolved'; sessionId: string; via: 'open_incident' | 'established_install' }
  | { kind: 'unknown'; reason: 'no_established_install' | 'multiple_established_installs' | 'no_sessions' };

/**
 * 감시 대상 install 을 고른다.
 *
 * 1) 열린 incident 가 지목한 세션이 있으면 그것이다 — 이미 그 기기 이야기다.
 *    (서버 쪽 같은 규칙은 0528 _brand_player_liveness 에 있다.)
 * 2) 없으면 24시간 넘게 자리 잡은 install 이 **정확히 하나**일 때만 그것이다.
 * 3) 그 외에는 모른다.
 */
export function resolveMonitoredInstall(
  sessions: readonly SessionCandidate[],
  openIncidentSessionId?: string | null,
  minAgeHours: number = ESTABLISHED_INSTALL_MIN_AGE_HOURS,
): MonitoredInstall {
  if (openIncidentSessionId) {
    const pinned = sessions.find((s) => s.sessionId === openIncidentSessionId);
    if (pinned) return { kind: 'resolved', sessionId: pinned.sessionId, via: 'open_incident' };
    // incident 가 가리키는 세션이 목록에 없다 = 24시간 넘게 조용하다.
    // 그래도 그 incident 의 대상은 여전히 그 세션이다.
    return { kind: 'resolved', sessionId: openIncidentSessionId, via: 'open_incident' };
  }
  if (sessions.length === 0) return { kind: 'unknown', reason: 'no_sessions' };

  const established = sessions.filter((s) => s.ageHours >= minAgeHours);
  if (established.length === 1) {
    return { kind: 'resolved', sessionId: established[0].sessionId, via: 'established_install' };
  }
  if (established.length === 0) return { kind: 'unknown', reason: 'no_established_install' };
  return { kind: 'unknown', reason: 'multiple_established_installs' };
}

/** 운영자에게 보여줄 한 줄. 모르면 모른다고 쓴다. */
export function describeMonitoredInstall(m: MonitoredInstall): string {
  if (m.kind === 'resolved') {
    return m.via === 'open_incident'
      ? '이 장애가 지목한 매장 재생기'
      : '자리 잡은 매장 재생기';
  }
  switch (m.reason) {
    case 'no_sessions':
      return '대상 매장 재생기 식별 불가 — 최근 접속한 세션이 없습니다';
    case 'no_established_install':
      return `대상 매장 재생기 식별 불가 — ${ESTABLISHED_INSTALL_MIN_AGE_HOURS}시간 이상 유지된 기기가 없습니다`;
    case 'multiple_established_installs':
      return '대상 매장 재생기 식별 불가 — 자리 잡은 기기가 둘 이상입니다';
  }
}
