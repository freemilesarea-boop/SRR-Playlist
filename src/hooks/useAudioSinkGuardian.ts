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

// Phase 2-1 QA 확장 — audio element 실제 상태를 함께 출력.
function snapshotAudioState(audio: HTMLAudioElement): Record<string, unknown> {
  return {
    identity: audio,                                              // ref console 접근용 (fold 하면 실체 확인)
    isHTMLAudio: audio instanceof HTMLAudioElement,
    currentSrc: audio.currentSrc,
    src: audio.src,
    readyState: audio.readyState,     // 0 HAVE_NOTHING · 1 HAVE_METADATA · 4 HAVE_ENOUGH_DATA
    networkState: audio.networkState, // 0 EMPTY · 1 IDLE · 2 LOADING · 3 NO_SOURCE
    paused: audio.paused,
    ended: audio.ended,
    muted: audio.muted,
    volume: audio.volume,
    duration: audio.duration,
    currentTime: audio.currentTime,
  };
}

async function applySink(audio: SinkCapableAudio, desired: string, tag: string): Promise<ApplyResult> {
  // Phase 2-2 QA — applySink 진입 여부 자체를 filter/cache 우회하여 확인.
  console.warn('[audio:sink] applySink entered', {
    tag,
    desired,
    audioSinkIdNow: audio.sinkId,
    hasSetSinkId: typeof audio.setSinkId === 'function',
    isHTMLAudio: audio instanceof HTMLAudioElement,
  });
  // 단일 라인 문자열 로그 — DevTools 가 object 를 collapse 해서 안 보이는 경우 대비
  const storeSnapshot = useAudioOutputStore.getState();
  console.warn(
    `[audio:sink:state] tag=${tag} desired=${desired} store=${storeSnapshot.sinkId ?? 'null'} audio=${audio.sinkId ?? '""'} hasHydrated=${storeSnapshot.hasHydrated}`,
  );
  const supported = typeof audio.setSinkId === 'function';
  const beforeSinkId = audio.sinkId;
  const stateBefore = snapshotAudioState(audio);

  // 이미 desired 이면 skip (idempotent)
  if (supported && beforeSinkId === desired) {
    console.warn('[audio:sink]', tag, 'skip (already applied)', { beforeSinkId, requested: desired, supported, ...stateBefore });
    return { requested: desired, beforeSinkId, afterSinkId: beforeSinkId, supported, exception: null, effective: true };
  }

  if (!supported) {
    console.warn('[audio:sink]', tag, 'unsupported', { beforeSinkId, requested: desired, supported, ...stateBefore });
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
    // audio element runtime state
    ...snapshotAudioState(audio),
  });

  return { requested: desired, beforeSinkId, afterSinkId, supported, exception, effective };
}

export function useAudioSinkGuardian(
  audioRef: { current: HTMLAudioElement | null },
): void {
  // Phase 2-1 QA — hook 실행 여부를 filter/cache 우회하여 3중으로 확인.
  // 함수 body 최상단 · React hook rules 준수 · 매 render 마다 실행.
  //   1) console.warn — DevTools console filter 가 warning level 표시할 때
  //   2) console.error — filter 무관 (별도 diag)
  //   3) document.body.dataset.audioSinkGuardian — Elements panel 에서 눈으로 확인
  //   4) localStorage marker — Application → Local Storage 에서 확인
  console.warn('[audio:sink] guardian mounted');
  console.error('[audio:sink] guardian mounted (diag)');
  // audio ref identity 즉시 노출 — instanceof / null 여부 확인용
  console.warn('[audio-ref]', {
    ref: audioRef.current,
    isHTMLAudio: audioRef.current instanceof HTMLAudioElement,
    sinkIdNow: (audioRef.current as SinkCapableAudio | null)?.sinkId,
  });

  const sinkId       = useAudioOutputStore((s) => s.sinkId);
  const markApplied  = useAudioOutputStore((s) => s.markApplied);
  // Phase 2-2 hotfix — hydrate 이전에 apply 하지 않도록 gate
  const hasHydrated  = useAudioOutputStore((s) => s.hasHydrated);

  // DOM/localStorage marker — react-hooks/immutability 회피 위해 useEffect 안에서.
  useEffect(() => {
    try {
      if (typeof document !== 'undefined' && document.body) {
        document.body.dataset.audioSinkGuardian = new Date().toISOString();
      }
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('deudda.audioSink.guardianMount', new Date().toISOString());
      }
    } catch { /* silent */ }
  });

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
    const s = useAudioOutputStore.getState();
    // Phase 2-2 QA — reapply 실제 호출 여부 + audio ref 상태 확인 (call-path trace)
    console.warn('[audio:sink] reapply called', {
      tag,
      reason,
      audioRefExists: !!a,
      audioIsHTMLAudio: a instanceof HTMLAudioElement,
      desiredSinkId: sinkIdRef.current ?? 'default',
      storeSinkId: s.sinkId,
      audioSinkIdNow: a?.sinkId,
      hasHydrated: s.hasHydrated,
    });
    // 단일 라인 문자열 로그 — DevTools 가 object 를 collapse 해도 확인 가능
    console.warn(
      `[audio:sink:state] reapply tag=${tag} reason=${reason} desired=${sinkIdRef.current ?? 'null'} store=${s.sinkId ?? 'null'} audio=${a?.sinkId ?? '""'} hydrated=${s.hasHydrated}`,
    );
    if (!a) return null;
    // Phase 2-2 hotfix — hydrate 이전 apply 를 skip 하지 않고, 대신 sinkIdRef 대신
    // store 의 최신 값을 우선 참조. sinkIdRef 는 effect deps 로 업데이트되지만,
    // 첫 render 에서 hydrate 가 늦으면 stale null 을 잡을 수 있음.
    const desired = s.sinkId ?? sinkIdRef.current ?? 'default';
    const result = await applySink(a, desired, `${tag}:${reason}`);
    if (result.effective) markApplied(desired === 'default' ? null : desired);
    return result;
  }, [audioRef, markApplied, tag]);

  // (1) mount + sinkId 변경 시 즉시 apply (paint 이전 useLayoutEffect)
  //     Phase 2-2 hotfix — hasHydrated 도 deps 에 포함해서 hydrate 완료 시점에 재실행.
  useLayoutEffect(() => {
    const a = audioRef.current as SinkCapableAudio | null;
    const s = useAudioOutputStore.getState();
    // Phase 2-2 QA — layoutEffect 실행 여부 + 3개 sinkId 값 동시 확인
    console.warn('[audio:sink] layoutEffect', {
      tag,
      desiredSinkId: sinkId ?? 'default',
      storeSinkId: s.sinkId,
      audioSinkIdNow: a?.sinkId,
      audioRefExists: !!a,
      sinkIdDeps: sinkId,
      hasHydrated,
    });
    console.warn(
      `[audio:sink:state] layoutEffect tag=${tag} desired=${sinkId ?? 'null'} store=${s.sinkId ?? 'null'} audio=${a?.sinkId ?? '""'} hydrated=${hasHydrated}`,
    );
    // hydrate 이전이면 skip — sinkId 가 null 인 채로 apply 하면 audio.sinkId 가 "" 로
    // 고정되고, hydrate 후 재실행되지 않는 문제 방지.
    if (!hasHydrated) {
      console.warn(`[audio:sink] layoutEffect skipped — waiting for hydration (tag=${tag})`);
      return;
    }
    void reapply('mount/sinkChange');
  }, [reapply, sinkId, audioRef, tag, hasHydrated]);

  // (2) audio element lifecycle 이벤트마다 재확인 — 재생 시작 이전 시점 보장
  useEffect(() => {
    const a = audioRef.current;
    // Phase 2-2 QA — lifecycle listener useEffect 실행 여부 + audio ref 존재 확인
    console.warn('[audio:sink] lifecycle useEffect entered', {
      tag,
      audioRefExists: !!a,
      audioIsHTMLAudio: a instanceof HTMLAudioElement,
    });
    if (!a) {
      console.warn('[audio:sink] listener SKIPPED — audio ref is null', { tag });
      return;
    }
    const onLifecycle = (ev: Event) => {
      // Phase 2-2 QA — lifecycle event 실제 fire 확인 (loadstart/metadata/canplay)
      console.warn(`[audio:sink] ${ev.type} fired`, {
        tag,
        eventType: ev.type,
        target: ev.target === a ? 'same-ref' : 'other',
        currentSrc: a.currentSrc,
        readyState: a.readyState,
      });
      void reapply(ev.type);
    };
    a.addEventListener('loadstart', onLifecycle);
    a.addEventListener('loadedmetadata', onLifecycle);
    a.addEventListener('canplay', onLifecycle);
    // Phase 2-2 QA — 세 리스너가 실제로 등록되었는지 확인
    console.warn('[audio:sink] listener registered', {
      tag,
      audioRefExists: !!a,
      currentSrc: a.currentSrc,
      readyState: a.readyState,
    });
    return () => {
      a.removeEventListener('loadstart', onLifecycle);
      a.removeEventListener('loadedmetadata', onLifecycle);
      a.removeEventListener('canplay', onLifecycle);
    };
  }, [audioRef, reapply, tag]);

  // (3) Phase 2-1 — Deferred User Activation Apply.
  //     audio.sinkId !== desired 이면 Chrome User Activation 정책 실패로 판단하고,
  //     첫 play / pointerdown / click 이벤트 중 가장 먼저 발생하는 시점에 재시도.
  //     이미 성공했으면 리스너 무동작.
  useEffect(() => {
    if (!hasHydrated) return; // Phase 2-2 hotfix — hydrate 이전엔 대기 리스너 등록 X
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
  }, [audioRef, sinkId, reapply, tag, hasHydrated]);
}
