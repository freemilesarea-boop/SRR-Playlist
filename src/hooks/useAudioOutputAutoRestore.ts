/**
 * useAudioOutputAutoRestore — Phase 2.
 *
 * 앱 시작 시 저장된 deviceId 를 enumerateDevices() 결과에서 찾아
 * setSinkId 자동 적용. devicechange 이벤트로 auto-reconnect 지원.
 *
 * 새 polling 도입 0. Player 재생 로직 무영향.
 * AppShell 에서 1회 mount.
 */
import { useEffect, useRef } from 'react';
import {
  enumerateAudioOutputs,
  isEnumerateDevicesSupported,
  isSetSinkIdSupported,
} from '@/lib/audioOutput';
import { useAudioOutputStore } from '@/store/audioOutputStore';
import { toast } from '@/store/toastStore';

export function useAudioOutputAutoRestore(): void {
  const setConnectionStatus = useAudioOutputStore((s) => s.setConnectionStatus);
  const resetToDefault      = useAudioOutputStore((s) => s.resetToDefault);
  const markApplied         = useAudioOutputStore((s) => s.markApplied);

  // 이전 상태 tracking — 반복 toast 방지
  const lastStatus = useRef<'connected' | 'disconnected' | 'default' | 'unsupported' | null>(null);

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

      // 저장된 장치 없음 → 기본 출력
      if (!savedId) {
        if (state.connectionStatus !== 'default') setConnectionStatus('default');
        lastStatus.current = 'default';
        return;
      }

      // 저장된 장치가 현재 목록에 존재
      const match = devices.find((d) => d.deviceId === savedId);
      if (match) {
        markApplied(savedId);
        setConnectionStatus('connected');
        // 이전 상태가 disconnected 였다면 auto-reconnect 알림
        if (lastStatus.current === 'disconnected') {
          toast.success(`오디오 장치 자동 복원: ${match.label}`);
        }
        lastStatus.current = 'connected';
        return;
      }

      // 저장된 장치가 없음 → Recovery
      setConnectionStatus('disconnected');
      if (lastStatus.current !== 'disconnected') {
        toast.warning(
          `선택한 출력 장치를 찾을 수 없습니다. 기본 출력으로 변경되었습니다.${savedLabel ? ` (${savedLabel})` : ''}`,
        );
        // Store 의 sinkId 는 유지 (재연결 시 자동 복귀 위해).
        // Player 에는 effectiveSinkId=null 로 알림.
        markApplied(null);
      }
      lastStatus.current = 'disconnected';
    };

    // 초기 1회 실행
    void check();

    // devicechange 이벤트 구독 (새 polling 없음)
    const md = navigator.mediaDevices;
    const onChange = () => { void check(); };
    md.addEventListener('devicechange', onChange);
    return () => {
      cancelled = true;
      md.removeEventListener('devicechange', onChange);
    };
    // resetToDefault 는 UI 액션용, 재구독 트리거 아님

  }, [markApplied, resetToDefault, setConnectionStatus]);
}
