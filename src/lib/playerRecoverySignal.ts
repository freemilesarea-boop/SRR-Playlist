/**
 * playerRecoverySignal.ts — 서버가 보낸 복구 신호를 받아 매장 재생을 되살린다.
 *
 * 왜 필요한가 — 숙대점 2026-09-12:
 *   02:50 에 탭이 죽어 07:18 에 점주가 직접 열 때까지 4시간 28분 무음이었다.
 *   탭이 죽으면 페이지의 JS 는 한 줄도 돌지 않는다. 워치독도 같이 죽는다.
 *   서버는 5분마다 offline 을 감지하고 있었지만 **매장에 손쓸 방법이 없었다.**
 *
 * 유일한 길 — 서비스워커는 페이지가 죽어도 푸시로 깨어난다.
 *   서버가 offline 감지 → 매장 기기로 푸시(kind='player_recover')
 *     → SW 가 깨어나 살아있는 창을 찾아 이 모듈에 신호를 보냄
 *     → 여기서 재생을 되살리고 ok 를 회신
 *     → 회신이 없으면(창이 얼었거나 없으면) SW 가 알림을 띄워 사람을 부른다
 *
 * 한계는 분명하다: 창이 하나도 없으면 소리를 낼 수 없다(SW 는 오디오를 못 낸다).
 * 그때는 알림까지가 끝이다. 다만 **얼기만 한 창은 이 경로로 되살아난다** —
 * 관측된 사고 대부분이 그 경우다.
 */

/** SW → 페이지 복구 신호. sw.ts 의 postMessage 와 이 타입이 계약이다. */
export const PLAYER_RECOVER_MESSAGE = 'PLAYER_RECOVER';

export interface RecoveryState {
  /** 매장/브랜드 플레이어인가. 일반 청취자 화면은 건드리지 않는다. */
  businessMode: boolean;
  /** 재생 의도. false = 사용자가 멈춘 것 → 되살리지 않는다. */
  playing: boolean;
  /** audio element 가 실제로 소리를 내고 있는가. */
  audioActive: boolean;
  /** 자동재생 차단 상태 — play() 를 눌러도 소용없다(제스처 필요). */
  autoplayBlocked: boolean;
  /** 본사 스케줄로 재생이 억제된 상태인가. */
  suppressed: boolean;
}

export type RecoveryAction =
  /** 아무것도 하지 않는다. */
  | 'none'
  /** 재생을 다시 건다 — 같은 문서 안이라 제스처 없이 소리가 난다. */
  | 'resume'
  /** 페이지를 다시 띄운다 — 의도는 재생인데 소리도 안 나고 되살릴 수단이 없을 때. */
  | 'reload';

/**
 * 복구 신호를 받았을 때 무엇을 할지. 순수 함수(테스트 대상).
 *
 * 서버는 "소리가 안 난다" 까지만 안다. 왜 안 나는지는 여기서만 알 수 있으므로
 * 판단은 클라이언트가 한다 — 서버 말을 그대로 따르면 정상 재생 중인 매장을
 * 리로드해버릴 수 있다(서버 판정은 최대 5분 늦다).
 */
export function resolveRecoveryAction(s: RecoveryState): RecoveryAction {
  // 매장 화면이 아니면 관여하지 않는다.
  if (!s.businessMode) return 'none';
  // 사용자/스케줄이 멈춘 것을 마음대로 되살리지 않는다.
  if (!s.playing || s.suppressed) return 'none';
  // 이미 소리가 나고 있다 — 서버 판정이 늦었을 뿐이다. 건드리면 오히려 끊긴다.
  if (s.audioActive) return 'none';
  // 자동재생이 막힌 상태는 play() 로 안 풀린다. 리로드해도 마찬가지고
  // PlaybackBlockedOverlay 가 이미 전체화면 안내를 띄우고 있다 — 사람을 기다린다.
  if (s.autoplayBlocked) return 'none';
  return 'resume';
}

/** 이 신호를 처리한 뒤 SW 에 회신할 값. 회신이 없으면 SW 가 알림을 띄운다. */
export interface RecoveryAck {
  ok: boolean;
  action: RecoveryAction;
}

export interface RecoveryHooks {
  /** 현재 상태 스냅샷. */
  readState: () => RecoveryState;
  /** 재생 재개. */
  resume: () => void;
}

/**
 * SW 메시지 구독. 반환값을 호출하면 해제된다.
 *
 * 회신(ok)의 의미는 "이 창이 살아서 신호를 처리했다" 이지 "소리가 났다" 가 아니다.
 * 창이 살아 있다면 알림으로 사람을 부를 이유가 없고, 소리가 안 나면 5분 뒤
 * 다음 감지에서 다시 신호가 온다.
 */
export function listenForRecoverySignal(hooks: RecoveryHooks): () => void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return () => { /* 미지원 환경 — no-op */ };
  }

  const onMessage = (event: MessageEvent) => {
    const data = event.data as { type?: string } | null;
    if (!data || data.type !== PLAYER_RECOVER_MESSAGE) return;

    let ack: RecoveryAck;
    try {
      const action = resolveRecoveryAction(hooks.readState());
      if (action === 'resume') hooks.resume();
      ack = { ok: true, action };
    } catch {
      // 복구 실패도 "창은 살아있다" 는 사실은 바뀌지 않는다.
      ack = { ok: true, action: 'none' };
    }

    const port = event.ports?.[0];
    if (port) {
      try { port.postMessage(ack); } catch { /* 회신 실패 — SW 가 알림으로 넘어간다 */ }
    }
  };

  navigator.serviceWorker.addEventListener('message', onMessage);
  return () => navigator.serviceWorker.removeEventListener('message', onMessage);
}
