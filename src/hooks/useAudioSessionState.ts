/**
 * useAudioSessionState — Phase 6-1 Audio Session State Machine.
 *
 * 목적:
 *   Player 에 분산된 상태 (playing / crossfading / recovery / preload / health /
 *   longrun) 를 하나의 관찰 가능한 SessionState 로 통합. **재생 로직은 변경하지
 *   않고**, 관측 · Recovery · Health · Dashboard 가 동일한 상태를 참조하도록
 *   상태 모델만 추가한다.
 *
 * 10 종 상태:
 *   idle            — 큐 비어있음/트랙 없음
 *   preparing       — playing 의도 있으나 아직 첫 재생 시작 X (metadata 로딩 등)
 *   playing         — active audio 실제 재생 중
 *   crossfading     — crossfade rAF 진행 중
 *   paused          — 사용자가 정지 상태 (current 있음)
 *   recovering      — Recovery Manager 진행 중
 *   waiting-network — playing 의도인데 networkState=LOADING + readyState<HAVE_FUTURE_DATA
 *   waiting-decode  — playing 의도인데 readyState<HAVE_FUTURE_DATA (네트워크 대기 아님)
 *   ended           — active.ended=true (자연 종료)
 *   error           — errored 플래그 또는 active.error != null
 *
 * 우선순위 (높은 것이 승):
 *   error > recovering > crossfading > ended
 *     > waiting-network > waiting-decode
 *     > (playing 의도 시) playing/preparing
 *     > paused > idle
 *
 * 규칙:
 *   • 신규 setInterval / polling / rAF 없음. 이벤트 진입 시점에 recordTransition 호출.
 *   • 모든 로그는 audioDebugWarn 로만 (Production 콘솔 침묵).
 *   • Player 재생 흐름 · queue · crossfade · heartbeat · announcement · sinkId
 *     · Recovery priority · Health 판단 · Preload 로직 완전 무변경.
 */
import { type MutableRefObject, useCallback, useRef } from 'react';
import { audioDebugWarn } from '@/lib/audioDebug';

export type AudioSessionState =
  | 'idle'
  | 'preparing'
  | 'playing'
  | 'crossfading'
  | 'paused'
  | 'recovering'
  | 'waiting-network'
  | 'waiting-decode'
  | 'ended'
  | 'error';

export interface SessionTransition {
  ts: number;
  from: AudioSessionState;
  to: AudioSessionState;
  reason: string;
  trackId: string | null;
  activeIdx: 0 | 1;
}

export interface SessionSummary {
  currentState: AudioSessionState;
  previousState: AudioSessionState | null;
  lastTransitionTs: number;
  currentStateDurationMs: number;
  transitionCount: number;
  recentTransitions: SessionTransition[];
}

export interface SessionStateInputs {
  audioARef: MutableRefObject<HTMLAudioElement | null>;
  audioBRef: MutableRefObject<HTMLAudioElement | null>;
  getActiveIdx: () => 0 | 1;
  getPlaying: () => boolean;
  getCrossfading: () => boolean;
  getCurrentTrackId: () => string | null;
  getErrored: () => boolean;
  /** Recovery Manager 진행 중 여부. 미제공 시 false 로 간주. */
  getRecovering?: () => boolean;
}

export interface SessionStateHandle {
  /** 현재 시점의 SessionState 계산 (side-effect 없음). */
  getCurrentSessionState: () => AudioSessionState;
  /** Dashboard/log 용 스냅샷. */
  getSessionSummary: () => SessionSummary;
  /**
   * 상태 변화 가능 시점에서 호출. 이전 상태와 다르면 history 에 push +
   * [audio:session:transition] 로그. 반환값은 계산된 현재 상태.
   */
  recordTransition: (reason: string) => AudioSessionState;
}

const HISTORY_MAX = 20;
/** HTMLMediaElement.HAVE_FUTURE_DATA */
const HAVE_FUTURE_DATA = 3;
/** HTMLMediaElement.NETWORK_LOADING */
const NETWORK_LOADING = 2;

function computeSessionState(inputs: SessionStateInputs): AudioSessionState {
  const activeIdx = inputs.getActiveIdx();
  const active =
    activeIdx === 0 ? inputs.audioARef.current : inputs.audioBRef.current;
  const playing = inputs.getPlaying();
  const crossfading = inputs.getCrossfading();
  const errored = inputs.getErrored();
  const recovering = inputs.getRecovering ? inputs.getRecovering() === true : false;
  const trackId = inputs.getCurrentTrackId();

  // 1. error — errored flag 또는 active.error 존재
  if (errored) return 'error';
  if (active && active.error !== null) return 'error';

  // 2. recovering — Recovery Manager 진행 중
  if (recovering) return 'recovering';

  // 3. crossfading — rAF 진행 중
  if (crossfading) return 'crossfading';

  // 4. ended — active.ended (자연 종료)
  if (active && active.ended) return 'ended';

  // 5. playing 의도가 있는 경우
  if (playing) {
    if (!active) return 'preparing'; // audio ref 아직 없음
    if (active.readyState < HAVE_FUTURE_DATA) {
      // 네트워크 로딩 중이면 waiting-network, 아니면 waiting-decode
      if (active.networkState === NETWORK_LOADING) return 'waiting-network';
      return 'waiting-decode';
    }
    // readyState >= HAVE_FUTURE_DATA
    if (active.paused) return 'preparing'; // 아직 play() 시작 안 됨
    return 'playing';
  }

  // 6. playing=false
  if (!trackId) return 'idle';
  return 'paused';
}

export function useAudioSessionState(inputs: SessionStateInputs): SessionStateHandle {
  // getter 들이 매 렌더 새로 만들어져도 stale closure 방지용 ref 저장.
  const inputsRef = useRef(inputs);
  inputsRef.current = inputs;

  const currentStateRef = useRef<AudioSessionState>('idle');
  const previousStateRef = useRef<AudioSessionState | null>(null);
  const lastTransitionTsRef = useRef<number>(performance.now());
  const transitionCountRef = useRef<number>(0);
  const historyRef = useRef<SessionTransition[]>([]);

  const getCurrentSessionState = useCallback((): AudioSessionState => {
    return computeSessionState(inputsRef.current);
  }, []);

  const recordTransition = useCallback((reason: string): AudioSessionState => {
    const next = computeSessionState(inputsRef.current);
    const prev = currentStateRef.current;
    if (next === prev) return next;
    const ts = performance.now();
    const trackId = inputsRef.current.getCurrentTrackId();
    const activeIdx = inputsRef.current.getActiveIdx();
    const entry: SessionTransition = { ts, from: prev, to: next, reason, trackId, activeIdx };
    historyRef.current.push(entry);
    if (historyRef.current.length > HISTORY_MAX) {
      historyRef.current.splice(0, historyRef.current.length - HISTORY_MAX);
    }
    previousStateRef.current = prev;
    currentStateRef.current = next;
    lastTransitionTsRef.current = ts;
    transitionCountRef.current += 1;
    audioDebugWarn('[audio:session:transition]', {
      from: prev,
      to: next,
      reason,
      trackId,
      activeIdx,
    });
    return next;
  }, []);

  const getSessionSummary = useCallback((): SessionSummary => {
    const now = performance.now();
    return {
      currentState: currentStateRef.current,
      previousState: previousStateRef.current,
      lastTransitionTs: lastTransitionTsRef.current,
      currentStateDurationMs: Math.max(0, now - lastTransitionTsRef.current),
      transitionCount: transitionCountRef.current,
      recentTransitions: historyRef.current.slice(),
    };
  }, []);

  return { getCurrentSessionState, getSessionSummary, recordTransition };
}
