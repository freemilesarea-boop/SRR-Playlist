/**
 * useAudioOutputDevices — Phase 1 hook.
 *
 * enumerateDevices() + devicechange 리스너 조합.
 * 새 polling 도입 0 — 브라우저 native devicechange 이벤트만 사용.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  enumerateAudioOutputs,
  isEnumerateDevicesSupported,
  isSetSinkIdSupported,
  requestDeviceLabelPermission,
  type AudioOutputDevice,
} from '@/lib/audioOutput';

export interface UseAudioOutputDevicesResult {
  devices: AudioOutputDevice[];
  loading: boolean;
  supportEnum: boolean;
  supportSink: boolean;
  needPermission: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  requestLabelPermission: () => Promise<boolean>;
}

export function useAudioOutputDevices(): UseAudioOutputDevicesResult {
  const [devices, setDevices] = useState<AudioOutputDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const supportEnum = isEnumerateDevicesSupported();
  const supportSink = isSetSinkIdSupported();

  // label 이 비어있는 경우 = 마이크 권한 미부여로 label 감춤 (Chrome 정책)
  const needPermission = devices.length > 0 && devices.every((d) => d.label === '(이름 미공개)');

  const refresh = useCallback(async () => {
    if (!supportEnum) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const list = await enumerateAudioOutputs();
      setDevices(list);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [supportEnum]);

  useEffect(() => {
    void refresh();
    if (!supportEnum) return;
    const md = navigator.mediaDevices;
    const onChange = () => { void refresh(); };
    md.addEventListener('devicechange', onChange);
    return () => md.removeEventListener('devicechange', onChange);
  }, [refresh, supportEnum]);

  const requestLabelPermission = useCallback(async () => {
    const ok = await requestDeviceLabelPermission();
    if (ok) await refresh();
    return ok;
  }, [refresh]);

  return { devices, loading, supportEnum, supportSink, needPermission, error, refresh, requestLabelPermission };
}
