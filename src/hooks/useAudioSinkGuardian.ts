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
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAudioOutputStore } from '@/store/audioOutputStore';
import { toast } from '@/store/toastStore';
import { getAudioObjectId } from '@/lib/audioOutput';

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

// ============================================================
// Phase 2-3 — Post-setSinkId playback recovery
// ============================================================
// Chrome 은 재생 중 audio 에 setSinkId 를 걸면 파이프라인을 잠깐 끊었다 다시
// 붙이는데, 특정 조합 (crossfade dual audio, PWA context, USB sink switch)
// 에서 audio.paused=false 이지만 실제 output 은 무음 상태로 정지하는 케이스가
// 관찰된다. 표준 대처는 setSinkId promise resolve 후 audio 가 원래 재생 중
// 이었으면 play() 를 한 번 재호출하는 것.
//
// 규칙:
//   • wasPlaying=true 일 때만 recovery (paused/ended 였으면 손대지 않음)
//   • 같은 audio element 에 대해 1초 안에 중복 recovery 금지 (loop guard)
//   • audio.load() / src 재설정 금지 (재생 로직 무변경)
//   • 200ms 후 currentTime 이 진행 안 하면 stall 로 판단 → play() 1회 retry
//   • retry 실패 시 toast 1회
const RECOVERY_COOLDOWN_MS = 1000;
const RECOVERY_VERIFY_DELAY_MS = 200;
const recoveryLastAt = new WeakMap<HTMLAudioElement, number>();

function recoverPlaybackAfterSinkChange(
  audio: SinkCapableAudio,
  desired: string,
  tag: string,
  ctBefore: number,
): void {
  const now = Date.now();
  const lastAt = recoveryLastAt.get(audio) ?? 0;
  if (now - lastAt < RECOVERY_COOLDOWN_MS) {
    console.warn(`[audio:sink:recovery] skip cooldown tag=${tag} elapsed=${now - lastAt}ms`);
    return;
  }
  recoveryLastAt.set(audio, now);

  const snapshot = {
    tag,
    requested: desired,
    afterSinkId: audio.sinkId,
    wasPlaying: !audio.paused && !audio.ended,
    paused: audio.paused,
    currentTime: audio.currentTime,
    readyState: audio.readyState,
    networkState: audio.networkState,
    muted: audio.muted,
    volume: audio.volume,
    ctBefore,
  };
  console.warn('[audio:sink:recovery]', snapshot);
  console.warn(
    `[audio:sink:recovery] entry tag=${tag} requested=${desired} after=${audio.sinkId ?? '""'} wasPlaying=${!audio.paused && !audio.ended} paused=${audio.paused} ct=${audio.currentTime} ctBefore=${ctBefore} readyState=${audio.readyState} networkState=${audio.networkState}`,
  );

  // 즉시 play() 재호출 — 수동 장치 변경은 user gesture context 안이므로
  // autoplay 정책 통과. 실패 시 warn 만 하고 swallow (crossfade 경합 등)
  audio.play().then(() => {
    console.warn(`[audio:sink:recovery] immediate play ok tag=${tag}`);
  }).catch((e) => {
    const err = e as { name?: string; message?: string };
    console.warn(`[audio:sink:recovery] immediate play failed tag=${tag} err=${err.name ?? String(err.message ?? err)}`);
  });

  // 200ms 후 verify — 무음 stall (paused=false 인데 currentTime 안 움직임) 감지
  window.setTimeout(() => {
    if (audio.sinkId !== desired) {
      console.warn(`[audio:sink:recovery] verify abort — sink changed tag=${tag} audio=${audio.sinkId ?? '""'}`);
      return;
    }
    if (audio.paused || audio.ended) {
      console.warn(`[audio:sink:recovery] verify skip — paused/ended tag=${tag} paused=${audio.paused} ended=${audio.ended}`);
      return;
    }
    if (audio.currentTime > ctBefore + 0.05) {
      console.warn(`[audio:sink:recovery] verify ok — progressing tag=${tag} ct=${audio.currentTime}`);
      return;
    }
    // paused=false but no progress → silent stall → 1회 retry (cooldown 이미 write 됨)
    console.warn(`[audio:sink:recovery] verify stall — retry play tag=${tag} ct=${audio.currentTime} ctBefore=${ctBefore}`);
    audio.play().then(() => {
      console.warn(`[audio:sink:recovery] retry play ok tag=${tag}`);
    }).catch((e) => {
      const err = e as { name?: string; message?: string };
      console.warn(`[audio:sink:recovery] retry play failed tag=${tag} err=${err.name ?? String(err.message ?? err)}`);
      try {
        toast.warning('출력 장치 전환 후 재생을 다시 시작해 주세요.');
      } catch { /* silent */ }
    });
  }, RECOVERY_VERIFY_DELAY_MS);
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
  // Phase 2-6 진단 로그 C-1 — setSinkId 시도 직전 audio object identity + 실제 상태.
  // 시간축을 따라 audio 객체가 재생 대상 audio 와 일치하는지 추적하기 위함.
  const audioObjectId = getAudioObjectId(audio);
  console.warn('[audio:sink:apply-audit]', {
    tag,
    reason: tag,
    desiredSinkId: desired,
    beforeSinkId: audio.sinkId,
    audioObjectId,
    audioSrc: audio.currentSrc,
    paused: audio.paused,
    readyState: audio.readyState,
    networkState: audio.networkState,
  });
  // Phase 2-3 — recovery 판정을 위해 setSinkId 이전 재생 상태 capture
  const wasPlaying = !audio.paused && !audio.ended;
  const ctBefore = audio.currentTime;
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
    wasPlayingBefore: wasPlaying,
    // audio element runtime state
    ...snapshotAudioState(audio),
  });
  // Phase 2-6 진단 로그 C-2 — setSinkId 결과 요약 (Guardian apply 로 실제 audio 가
  // desired 로 라우팅됐는지 여부와 audio object identity 를 같이 기록).
  console.warn('[audio:sink:apply-result]', {
    tag,
    reason: tag,
    desiredSinkId: desired,
    afterSinkId,
    effective,
    audioObjectId,
    exception,
  });

  // Phase 2-3 — sink 실제로 바뀌었고 재생 중이었으면 파이프라인 recovery.
  //   • beforeSinkId !== afterSinkId 확인 → 같은 sink 재적용은 recovery 대상 X
  //   • wasPlaying=true 만 대상 (paused 였으면 사용자가 정지 상태 유지 원함)
  //   • 중복 recovery 는 module-level WeakMap cooldown 으로 방지
  if (effective && wasPlaying && beforeSinkId !== afterSinkId) {
    recoverPlaybackAfterSinkChange(audio, desired, tag, ctBefore);
  }

  return { requested: desired, beforeSinkId, afterSinkId, supported, exception, effective };
}

/**
 * Guardian 이 노출하는 first-play sink gate API.
 *   • sinkReady — 현재 audio.sinkId 가 store 의 desired 와 일치하는지 (idempotent tracker).
 *     desired 가 null 이면 브라우저 기본 출력이므로 항상 true.
 *   • ensureSinkReady(reason) — 첫 play 직전 호출. sinkReady 이면 즉시 true 반환.
 *     아니면 setSinkId 적용 + 200ms 후 verify. 성공 true, 실패 false (play 자체는 막지 않음).
 */
export interface SinkGuardianHandle {
  sinkReady: boolean;
  ensureSinkReady: (reason: string) => Promise<boolean>;
}

const ENSURE_VERIFY_DELAY_MS = 200;

export function useAudioSinkGuardian(
  audioRef: { current: HTMLAudioElement | null },
  audioMountRevision: number = 0,
): SinkGuardianHandle {
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

  // Phase 2-4 hotfix — first-play sink gate.
  //   • sinkReady=false → play() 이전 ensureSinkReady() 필요
  //   • setSinkId 성공 (혹은 이미 desired) 시 true 로 승격
  //   • sinkId 변경 시 리셋
  //   • Phase 2-5 — audioMountRevision 변경 시에도 리셋 (audio element 교체)
  const [sinkReady, setSinkReady] = useState(false);
  useEffect(() => { setSinkReady(false); }, [sinkId, audioMountRevision]);

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
      audioMountRevision,
    });
    // 단일 라인 문자열 로그 — DevTools 가 object 를 collapse 해도 확인 가능
    console.warn(
      `[audio:sink:state] reapply tag=${tag} reason=${reason} desired=${sinkIdRef.current ?? 'null'} store=${s.sinkId ?? 'null'} audio=${a?.sinkId ?? '""'} hydrated=${s.hasHydrated} mountRev=${audioMountRevision}`,
    );
    // Phase 2-5 hotfix — audioRef.current null 이면 절대 sinkReady 승격 X.
    // audio 없는 상태에서 setSinkId 를 성공으로 처리하지 말고, mount revision 이 바뀌면
    // effect 가 다시 실행되면서 재시도한다.
    if (!a) {
      console.warn('[audio:sink] no audio ref yet', {
        tag, reason, desiredSinkId: sinkIdRef.current ?? 'default', audioMountRevision,
      });
      setSinkReady(false);
      return null;
    }
    // Phase 2-2 hotfix — hydrate 이전 apply 를 skip 하지 않고, 대신 sinkIdRef 대신
    // store 의 최신 값을 우선 참조. sinkIdRef 는 effect deps 로 업데이트되지만,
    // 첫 render 에서 hydrate 가 늦으면 stale null 을 잡을 수 있음.
    const desired = s.sinkId ?? sinkIdRef.current ?? 'default';
    const result = await applySink(a, desired, `${tag}:${reason}`);
    if (result.effective) {
      markApplied(desired === 'default' ? null : desired);
      // Phase 2-4 — audio.sinkId === desired 확인된 시점만 sinkReady 승격
      setSinkReady(true);
      console.warn('[audio:sink:ready]', {
        tag,
        desiredSinkId: desired,
        currentSinkId: a.sinkId,
        sinkReady: true,
        audioMountRevision,
      });
    }
    return result;
  }, [audioRef, markApplied, tag, audioMountRevision]);

  // Phase 2-4 hotfix — 첫 play 직전에 호출. sinkReady 이면 즉시 true, 아니면
  // setSinkId 적용 + 200ms 후 실제 audio.sinkId 재확인.
  // Phase 2-5 hotfix — audio ref null 일 때는 true 반환 X (오승격 방지). Player 는
  // false 를 받으면 warn 후 fallback 재생 허용.
  const ensureSinkReady = useCallback(async (reason: string): Promise<boolean> => {
    const a = audioRef.current as SinkCapableAudio | null;
    const s = useAudioOutputStore.getState();
    const desired = s.sinkId ?? 'default';

    // Phase 2-5 — audio ref 없음 → 절대 true 반환 X · sinkReady 승격 X
    if (!a) {
      console.warn('[audio:sink:ensure] no audio ref', {
        tag, reason, desiredSinkId: desired, audioMountRevision,
      });
      setSinkReady(false);
      return false;
    }
    // 브라우저 미지원 → fallback 허용 (sinkReady=true)
    if (typeof a.setSinkId !== 'function') {
      console.warn(`[audio:sink:ensure] unsupported browser tag=${tag} reason=${reason} → default fallback ok`);
      setSinkReady(true);
      return true;
    }
    // 이미 desired 이면 즉시 승격
    if (a.sinkId === desired) {
      console.warn(`[audio:sink:ensure] already applied tag=${tag} reason=${reason} desired=${desired}`);
      setSinkReady(true);
      console.warn('[audio:sink:ready]', {
        tag, desiredSinkId: desired, currentSinkId: a.sinkId, sinkReady: true, audioMountRevision,
      });
      return true;
    }
    // Phase 2-5 확장 진단 — setSinkId 시도 직전 상태 snapshot
    console.warn('[audio:sink:ensure]', {
      tag,
      reason,
      desiredSinkId: desired,
      beforeSinkId: a.sinkId,
      audioMountRevision,
      readyState: a.readyState,
      networkState: a.networkState,
    });
    const result = await applySink(a, desired, `${tag}:ensure:${reason}`);
    if (result.effective) {
      markApplied(desired === 'default' ? null : desired);
      setSinkReady(true);
      console.warn('[audio:sink:ready]', {
        tag, desiredSinkId: desired, currentSinkId: a.sinkId, sinkReady: true, audioMountRevision,
      });
      return true;
    }
    // 200ms 후 verify — setSinkId 는 promise resolve 후에도 audio.sinkId 반영이
    // async 하게 늦어지는 케이스가 관찰됨.
    await new Promise((r) => window.setTimeout(r, ENSURE_VERIFY_DELAY_MS));
    if (a.sinkId === desired) {
      console.warn(`[audio:sink:ensure] verify ok tag=${tag} reason=${reason} desired=${desired}`);
      markApplied(desired === 'default' ? null : desired);
      setSinkReady(true);
      console.warn('[audio:sink:ready]', {
        tag, desiredSinkId: desired, currentSinkId: a.sinkId, sinkReady: true, audioMountRevision,
      });
      return true;
    }
    // fallback — play 는 허용하되 sinkReady 는 false 유지
    console.warn(`[audio:sink:ensure] verify failed tag=${tag} reason=${reason} desired=${desired} audio=${a.sinkId ?? '""'} → default fallback allowed`);
    return false;
  }, [audioRef, markApplied, tag, audioMountRevision]);

  // (1) mount + sinkId 변경 시 즉시 apply (paint 이전 useLayoutEffect)
  //     Phase 2-2 hotfix — hasHydrated 도 deps 에 포함해서 hydrate 완료 시점에 재실행.
  //     Phase 2-5 hotfix — audioMountRevision 도 deps 에 포함해서 audio ref 연결
  //     시점에 자동 재실행.
  useLayoutEffect(() => {
    const a = audioRef.current as SinkCapableAudio | null;
    const s = useAudioOutputStore.getState();
    // Phase 2-5 — ref 연결 상태 진단. audio 없으면 sinkReady 승격 X.
    console.warn('[audio:sink:ref-ready]', {
      tag,
      audioMountRevision,
      exists: Boolean(a),
      desiredSinkId: sinkId ?? (s.sinkId ?? 'default'),
      currentSinkId: a?.sinkId,
    });
    // Phase 2-2 QA — layoutEffect 실행 여부 + 3개 sinkId 값 동시 확인
    console.warn('[audio:sink] layoutEffect', {
      tag,
      desiredSinkId: sinkId ?? 'default',
      storeSinkId: s.sinkId,
      audioSinkIdNow: a?.sinkId,
      audioRefExists: !!a,
      sinkIdDeps: sinkId,
      hasHydrated,
      audioMountRevision,
    });
    console.warn(
      `[audio:sink:state] layoutEffect tag=${tag} desired=${sinkId ?? 'null'} store=${s.sinkId ?? 'null'} audio=${a?.sinkId ?? '""'} hydrated=${hasHydrated} mountRev=${audioMountRevision}`,
    );
    // hydrate 이전이면 skip — sinkId 가 null 인 채로 apply 하면 audio.sinkId 가 "" 로
    // 고정되고, hydrate 후 재실행되지 않는 문제 방지.
    if (!hasHydrated) {
      console.warn(`[audio:sink] layoutEffect skipped — waiting for hydration (tag=${tag})`);
      return;
    }
    // Phase 2-5 — audio ref 아직 없으면 skip (mount revision 변경 시 재실행)
    if (!a) {
      console.warn(`[audio:sink] layoutEffect skipped — audio ref null (tag=${tag} mountRev=${audioMountRevision})`);
      setSinkReady(false);
      return;
    }
    void reapply('mount/sinkChange');
  }, [reapply, sinkId, audioRef, tag, hasHydrated, audioMountRevision]);

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
  }, [audioRef, reapply, tag, audioMountRevision]);

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
  }, [audioRef, sinkId, reapply, tag, hasHydrated, audioMountRevision]);

  return { sinkReady, ensureSinkReady };
}
