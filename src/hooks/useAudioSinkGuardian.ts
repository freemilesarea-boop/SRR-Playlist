/**
 * useAudioSinkGuardian — Audio Output Phase 2 hotfix.
 *
 * audio element 가 mount 되면 즉시 setSinkId 를 적용하고,
 * loadstart / loadedmetadata / canplay 이벤트마다 재확인.
 *
 * 원인: 새로고침 후 Player 의 useEffect 가 setSinkId 를 시도해도
 *   1) user activation 없이 실패할 수 있고 (Chrome 정책),
 *   2) audio.src 세팅과의 순서가 애매하면 재생 시작 시점에 sink 가
 *      default 로 남아 있을 수 있음.
 *
 * 해결:
 *   • useLayoutEffect 로 mount 시점에 즉시 적용 (paint 전, useEffect 보다 빠름)
 *   • audio element 이벤트 (loadstart/loadedmetadata/canplay) 마다 재확인
 *   • 이미 sinkId 가 desired 와 같으면 skip (idempotent)
 *   • 실패 시 warn 만, 재생 로직에는 절대 영향 없음
 */
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useAudioOutputStore } from '@/store/audioOutputStore';

type SinkCapableAudio = HTMLAudioElement & {
  setSinkId?: (deviceId: string) => Promise<void>;
  sinkId?: string;
};

async function applySink(audio: SinkCapableAudio, desired: string): Promise<boolean> {
  if (typeof audio.setSinkId !== 'function') return false;
  if (audio.sinkId === desired) return true; // 이미 적용됨
  try {
    await audio.setSinkId(desired);
    return true;
  } catch (e) {
    console.warn('[audio] setSinkId failed', { desired, err: e });
    return false;
  }
}

export function useAudioSinkGuardian(
  audioRef: { current: HTMLAudioElement | null },
): void {
  const sinkId       = useAudioOutputStore((s) => s.sinkId);
  const markApplied  = useAudioOutputStore((s) => s.markApplied);

  // sinkId 를 ref 로 보관 — 이벤트 리스너가 stale 값 잡지 않도록.
  const sinkIdRef = useRef<string | null>(sinkId);
  useEffect(() => { sinkIdRef.current = sinkId; }, [sinkId]);

  // 재적용 콜백 — audio element + 현재 sinkId 로 시도
  const reapply = useCallback(async () => {
    const a = audioRef.current as SinkCapableAudio | null;
    if (!a) return;
    const desired = sinkIdRef.current ?? 'default';
    const ok = await applySink(a, desired);
    if (ok) markApplied(sinkIdRef.current ?? null);
  }, [audioRef, markApplied]);

  // (1) mount + sinkId 변경 시 즉시 apply (paint 이전 useLayoutEffect)
  useLayoutEffect(() => {
    void reapply();
  }, [reapply, sinkId]);

  // (2) audio element lifecycle 이벤트마다 재확인 — 재생 시작 이전 시점 보장
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const handler = () => { void reapply(); };
    // loadstart: src 세팅 직후 (재생 시작 전 매우 이른 시점)
    // loadedmetadata: metadata 로드 완료 (재생 준비)
    // canplay: 재생 가능 상태 (사용자 gesture 직후 play() 호출 직전 최종 방어선)
    a.addEventListener('loadstart', handler);
    a.addEventListener('loadedmetadata', handler);
    a.addEventListener('canplay', handler);
    return () => {
      a.removeEventListener('loadstart', handler);
      a.removeEventListener('loadedmetadata', handler);
      a.removeEventListener('canplay', handler);
    };
  }, [audioRef, reapply]);
}
