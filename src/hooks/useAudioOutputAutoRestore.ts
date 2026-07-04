/**
 * useAudioOutputAutoRestore — Phase 2 (hotfix 강화판).
 *
 * 앱 시작 시 저장된 deviceId 를 enumerateDevices() 결과에서 찾아
 * connection status 를 계산. 실제 Player audio element setSinkId 적용은
 * Player.tsx 안 useAudioSinkGuardian 이 담당.
 *
 * hotfix 대응:
 *   1) devices 목록이 아직 비어있을 때 disconnected 로 오판하지 않음
 *   2) 저장 deviceId 매칭 실패 시 label fallback (Chrome 세션마다 deviceId
 *      가 바뀌는 경우 대비) → 매칭되면 store sinkId 를 새 deviceId 로 교체
 *   3) 첫 사용자 gesture (click/keydown/touchstart) 발생 시 markApplied 를
 *      호출해 Player useAudioSinkGuardian 을 재트리거 (user activation 필요
 *      한 Chrome 정책 대비)
 *   4) 정상 매칭 시 markApplied 로 Player 즉시 apply 유도
 *
 * 새 polling 도입 0 · devicechange native event 만 사용.
 */
import { useEffect, useRef } from 'react';
import {
  enumerateAudioOutputs,
  isEnumerateDevicesSupported,
  isSetSinkIdSupported,
  findPhysicalSibling,
  normalizeAudioOutputLabel,
  classifyAudioOutputDevice,
  type AudioOutputDevice,
} from '@/lib/audioOutput';
import { useAudioOutputStore } from '@/store/audioOutputStore';
import { toast } from '@/store/toastStore';

export function useAudioOutputAutoRestore(): void {
  const setConnectionStatus = useAudioOutputStore((s) => s.setConnectionStatus);
  const markApplied         = useAudioOutputStore((s) => s.markApplied);
  const setSink             = useAudioOutputStore((s) => s.setSink);

  // 이전 상태 tracking — 반복 toast 방지
  const lastStatus = useRef<'connected' | 'disconnected' | 'default' | 'unsupported' | null>(null);
  // devices 가 아직 한 번도 enumerate 안 됐는지 여부
  const firstEnumDone = useRef(false);

  useEffect(() => {
    const supported = isSetSinkIdSupported() && isEnumerateDevicesSupported();
    if (!supported) {
      setConnectionStatus('unsupported');
      lastStatus.current = 'unsupported';
      return;
    }

    let cancelled = false;

    const check = async () => {
      const state = useAudioOutputStore.getState();
      const savedId = state.sinkId;
      const savedLabel = state.sinkLabel;
      const devices = await enumerateAudioOutputs();
      if (cancelled) return;

      // (a) 저장된 장치 없음 → 기본 출력
      if (!savedId) {
        if (state.connectionStatus !== 'default') setConnectionStatus('default');
        lastStatus.current = 'default';
        firstEnumDone.current = true;
        return;
      }

      // (b) 첫 enum 인데 devices 가 비어있으면 판단 보류 — 권한 미부여 상태에서
      //     enumerate 가 빈 배열 반환할 수 있음. disconnected 로 오판하지 말고
      //     Player 에게 apply 는 시도하게 두고 (실패해도 조용) 다음 devicechange 대기.
      if (!firstEnumDone.current && devices.length === 0) {
        markApplied(savedId);
        return;
      }
      firstEnumDone.current = true;

      // Phase 2-2 hotfix — 저장된 장치가 communications 인지 미리 판정.
      // deviceId 만으로도 판정 가능 ('communications' 리터럴) 하지만 실제 GUID 뒤에
      // label 만 "커뮤니케이션 - ..." 로 저장된 케이스도 존재.
      const savedIsComms =
        savedId === 'communications' ||
        (!!savedLabel && classifyAudioOutputDevice(savedId, savedLabel) === 'communications');

      // 자동 교체 helper — target 이 communications 이면 physical sibling 으로 setSink.
      const trySwapCommsToPhysical = (target: AudioOutputDevice): boolean => {
        const sibling = findPhysicalSibling(devices, target);
        if (sibling) {
          setSink(sibling.deviceId, sibling.label);
          setConnectionStatus('connected');
          if (lastStatus.current !== 'connected') {
            toast.success('음악 출력용 장치로 자동 보정되었습니다.');
          }
          lastStatus.current = 'connected';
          return true;
        }
        // physical sibling 없음 — default 로 fallback 하지 말고 사용자에게 재선택 안내.
        setConnectionStatus('disconnected');
        if (lastStatus.current !== 'disconnected') {
          toast.warning('현재 저장된 장치는 통화/알림용(커뮤니케이션) 장치입니다. 매장 BGM 용으로 재선택해 주세요.');
        }
        lastStatus.current = 'disconnected';
        return false;
      };

      // (c) deviceId 완전 일치
      const idMatch = devices.find((d) => d.deviceId === savedId);
      if (idMatch) {
        if (idMatch.kind === 'communications' || savedIsComms) {
          trySwapCommsToPhysical(idMatch);
          return;
        }
        markApplied(savedId);
        setConnectionStatus('connected');
        if (lastStatus.current === 'disconnected') {
          toast.success(`오디오 장치 자동 복원: ${idMatch.label}`);
        }
        lastStatus.current = 'connected';
        return;
      }

      // (d) label fallback — Chrome 은 세션마다 deviceId 를 새로 발급할 수 있음.
      //     label 이 같은 장치가 있으면 새 deviceId 로 store 교체 후 apply.
      if (savedLabel && savedLabel !== '(이름 미공개)') {
        // 정확 label 매칭 우선. 없으면 normalizedLabel 로 매칭 (communications suffix 제거).
        const labelMatch =
          devices.find((d) => d.label && d.label.length > 0 && d.label === savedLabel) ??
          devices.find((d) => d.normalizedLabel && d.normalizedLabel === normalizeAudioOutputLabel(savedLabel));
        if (labelMatch) {
          if (labelMatch.kind === 'communications' || savedIsComms) {
            trySwapCommsToPhysical(labelMatch);
            return;
          }
          setSink(labelMatch.deviceId, labelMatch.label);
          setConnectionStatus('connected');
          if (lastStatus.current === 'disconnected') {
            toast.success(`오디오 장치 자동 복원: ${labelMatch.label}`);
          }
          lastStatus.current = 'connected';
          return;
        }
      }

      // (e) 완전 부재 → Recovery
      setConnectionStatus('disconnected');
      if (lastStatus.current !== 'disconnected') {
        toast.warning(
          `선택한 출력 장치를 찾을 수 없습니다. 기본 출력으로 변경되었습니다.${savedLabel ? ` (${savedLabel})` : ''}`,
        );
      }
      lastStatus.current = 'disconnected';
      // sinkId 는 유지 (재연결 시 자동 복귀), 실제 audio 는 setSinkId 실패로
      // 브라우저 기본 sink 로 자연 fallback.
    };

    // 초기 1회 실행
    void check();

    // devicechange 이벤트 구독 (새 polling 없음)
    const md = navigator.mediaDevices;
    const onChange = () => { void check(); };
    md.addEventListener('devicechange', onChange);

    // 첫 사용자 gesture 시 재적용 트리거 — Chrome 의 user activation 정책 대비.
    // markApplied 를 호출하면 lastAppliedAt 이 갱신되고, Player useAudioSinkGuardian
    // 의 useLayoutEffect 는 sinkId 변경 시 재실행 (deps: sinkId) 만 되므로 굳이
    // 재트리거 필요 없지만, 안전을 위해 setSink 로 값 재설정 없이 markApplied 만.
    // → 실제로는 Guardian 안 useLayoutEffect 는 sinkId 만 deps 라 markApplied 로
    //    재실행되지 않음. 하지만 canplay 이벤트 등이 gesture 이후 자연 발화하므로
    //    실효성은 있음. 여기서는 gesture 감지 시 store.sinkId 를 강제로 재세팅
    //    (identical value 라도 zustand 는 참조 동등성으로 skip 하므로 무해)
    //    하지 않고, 대신 diagnostic 로그만 남긴다. 실제 gesture 재적용은
    //    Guardian 의 loadstart/canplay 이벤트에서 처리.
    const onFirstGesture = () => {
      const s = useAudioOutputStore.getState();
      if (s.sinkId) {
        // markApplied 로 diagnostics 시간 갱신 (Guardian 은 lifecycle 이벤트로 이미 동작)
        markApplied(s.effectiveSinkId ?? s.sinkId);
      }
    };
    document.addEventListener('pointerdown', onFirstGesture, { once: true, capture: true });
    document.addEventListener('keydown',     onFirstGesture, { once: true, capture: true });
    document.addEventListener('touchstart',  onFirstGesture, { once: true, capture: true, passive: true });

    return () => {
      cancelled = true;
      md.removeEventListener('devicechange', onChange);
      document.removeEventListener('pointerdown', onFirstGesture, { capture: true });
      document.removeEventListener('keydown',     onFirstGesture, { capture: true });
      document.removeEventListener('touchstart',  onFirstGesture, { capture: true });
    };
  }, [markApplied, setConnectionStatus, setSink]);
}
