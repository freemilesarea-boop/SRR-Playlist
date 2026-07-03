/**
 * useAudioSinkGuardian — Audio Output Phase 2 + 2-1.
 *
 * audio element 가 mount 되면 즉시 setSinkId 를 적용하고, lifecycle 이벤트
 * (loadstart / loadedmetadata / canplay) 마다 재확인. 재생 로직 무변경.
 *
 * Phase 2-1 확장:
 *   • console.debug 진단 로그 — before/requested/after/exception/support
 *   • audio.sinkId !== requestedSinkId 이면 User Activation 정책 실패로 판단
 *   • 첫 play / pointerdown / click 이벤트 중 가장 먼저 발생하는 시점에
 *     setSinkId 를 한 번 더 시도 (deferred apply)
 *   • 이미 성공(audio.sinkId === desired) 이면 재적용 skip
 *
 * 원리:
 *   • useLayoutEffect 는 paint 이전 실행 → useEffect 보다 이른 타이밍
 *   • lifecycle 이벤트는 브라우저가 audio 를 재초기화하는 순간마다 fire
 *   • deferred gesture 리스너는 Chrome 의 speaker-selection user
 *     activation 요구를 만족시키기 위한 안전망
 */
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useAudioOutputStore } from '@/store/audioOutputStore';

type SinkCapableAudio = HTMLAudioElement & {
  setSinkId?: (deviceId: string) => Promise<void>;
  sinkId?: string;
};

interface ApplyResult {
  requested: string;
  beforeSinkId: string | undefined;
  afterSinkId: string | undefined;
  supported: boolean;
  exception: string | null;
  /** setSinkId 호출 후 audio.sinkId 가 요청값과 일치하는지. */
  effective: boolean;
}

async function applySink(audio: SinkCapableAudio, desired: string, tag: string): Promise<ApplyResult> {
  const supported = typeof audio.setSinkId === 'function';
  const beforeSinkId = audio.sinkId;

  // 이미 desired 이면 skip (idempotent)
  if (supported && beforeSinkId === desired) {
    console.warn('[audio:sink]', tag, 'skip (already applied)', { beforeSinkId, requested: desired, supported });
    return { requested: desired, beforeSinkId, afterSinkId: beforeSinkId, supported, exception: null, effective: true };
  }

  if (!supported) {
    console.warn('[audio:sink]', tag, 'unsupported', { beforeSinkId, requested: desired, supported });
    return { requested: desired, beforeSinkId, afterSinkId: beforeSinkId, supported, exception: null, effective: false };
  }

  let exception: string | null = null;
  try {
    await audio.setSinkId!(desired);
  } catch (e) {
    const err = e as { name?: string; message?: string };
    exception = err.name ? `${err.name}: ${err.message ?? ''}` : String(err.message ?? err);
  }

  const afterSinkId = audio.sinkId;
  const effective = afterSinkId === desired;

  console.warn('[audio:sink]', tag, effective ? 'ok' : 'MISMATCH', {
    beforeSinkId,
    requested: desired,
    afterSinkId,
    supported,
    exception,
    userActivationHint: !effective && !exception
      ? 'audio.sinkId != requested — Chrome User Activation 정책 가능성. 첫 gesture 대기.'
      : undefined,
  });

  return { requested: desired, beforeSinkId, afterSinkId, supported, exception, effective };
}

export function useAudioSinkGuardian(
  audioRef: { current: HTMLAudioElement | null },
): void {
  // Phase 2-1 QA — hook 이 실제로 mount 되는지 즉시 확인.
  // 함수 body 최상단 · React hook rules 준수 · 매 render 마다 출력.
  console.warn('[audio:sink] guardian mounted');

  const sinkId       = useAudioOutputStore((s) => s.sinkId);
  const markApplied  = useAudioOutputStore((s) => s.markApplied);

  // sinkId 를 ref 로 보관 — 이벤트 리스너가 stale 값 잡지 않도록.
  const sinkIdRef = useRef<string | null>(sinkId);
  useEffect(() => { sinkIdRef.current = sinkId; }, [sinkId]);

  // 각 audio element 인스턴스 별로 태그 부여 (로그 구분용)
  const tagRef = useRef<string>('');
  if (!tagRef.current) {
    // Phase 2-1: audio ref 기반 안정 태그 (id 나 tagname 을 유사 hash)
    tagRef.current = `A${Math.random().toString(36).slice(2, 6)}`;
  }
  const tag = tagRef.current;

  // 재적용 콜백
  const reapply = useCallback(async (reason: string): Promise<ApplyResult | null> => {
    const a = audioRef.current as SinkCapableAudio | null;
    if (!a) return null;
    const desired = sinkIdRef.current ?? 'default';
    const result = await applySink(a, desired, `${tag}:${reason}`);
    if (result.effective) markApplied(sinkIdRef.current ?? null);
    return result;
  }, [audioRef, markApplied, tag]);

  // (1) mount + sinkId 변경 시 즉시 apply (paint 이전 useLayoutEffect)
  useLayoutEffect(() => {
    void reapply('mount/sinkChange');
  }, [reapply, sinkId]);

  // (2) audio element lifecycle 이벤트마다 재확인 — 재생 시작 이전 시점 보장
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onLifecycle = (ev: Event) => { void reapply(ev.type); };
    a.addEventListener('loadstart', onLifecycle);
    a.addEventListener('loadedmetadata', onLifecycle);
    a.addEventListener('canplay', onLifecycle);
    return () => {
      a.removeEventListener('loadstart', onLifecycle);
      a.removeEventListener('loadedmetadata', onLifecycle);
      a.removeEventListener('canplay', onLifecycle);
    };
  }, [audioRef, reapply]);

  // (3) Phase 2-1 — Deferred User Activation Apply.
  //     audio.sinkId !== desired 이면 Chrome User Activation 정책 실패로 판단하고,
  //     첫 play / pointerdown / click 이벤트 중 가장 먼저 발생하는 시점에 재시도.
  //     이미 성공했으면 리스너 무동작.
  useEffect(() => {
    const desired = sinkId ?? 'default';
    const a = audioRef.current as SinkCapableAudio | null;
    if (!a) return;
    if (typeof a.setSinkId !== 'function') return;
    // 이미 성공 상태면 대기 리스너 등록 안 함
    if (a.sinkId === desired) return;

    let done = false;
    const onGesture = async (ev: Event) => {
      if (done) return;
      done = true;
      const result = await reapply(`gesture:${ev.type}`);
      if (result?.effective) {
        console.warn('[audio:sink]', tag, 'deferred apply succeeded on first user activation', { event: ev.type });
      } else {
        console.warn('[audio:sink]', tag, 'deferred apply still failing', { event: ev.type, result });
      }
      cleanup();
    };
    const cleanup = () => {
      a.removeEventListener('play', onGesture);
      document.removeEventListener('pointerdown', onGesture, { capture: true } as EventListenerOptions);
      document.removeEventListener('click', onGesture, { capture: true } as EventListenerOptions);
    };

    a.addEventListener('play', onGesture);
    document.addEventListener('pointerdown', onGesture, { capture: true });
    document.addEventListener('click', onGesture, { capture: true });

    console.warn('[audio:sink]', tag, 'deferred apply armed', {
      currentSinkId: a.sinkId, desired,
    });

    return cleanup;
    // sinkId 변경 시 재무장, lastAppliedAt 은 성공 여부에 따라 갱신되므로 deps 로.
  }, [audioRef, sinkId, reapply, tag]);
}
