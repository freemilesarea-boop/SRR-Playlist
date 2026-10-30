/**
 * OutputSlotBar — 분리 송출 창 맨 위의 "N번 플레이어 · 출력 장치" 바.
 *
 * 창마다 스피커를 고르는 곳이다. 선택은 이 PC·이 번호 창에만 저장된다(audioOutputStore 가
 * 슬롯별 키를 쓴다). 슬롯 창이 아니면 아무것도 그리지 않는다.
 */
import { useEffect, useRef, useState } from 'react';
import { Speaker, Volume2 } from 'lucide-react';
import { getOutputSlot } from '@/lib/outputSlot';
import { useAudioOutputDevices } from '@/hooks/useAudioOutputDevices';
import { useAudioOutputStore } from '@/store/audioOutputStore';
import { playTestTone, type TestToneHandle } from '@/lib/audioOutput';

export default function OutputSlotBar({ kind }: { kind: 'brand' | 'store' }) {
  const slot = getOutputSlot();
  const { devices, supportSink, needPermission, requestLabelPermission } = useAudioOutputDevices();
  const sinkId = useAudioOutputStore((s) => s.sinkId);
  const setSink = useAudioOutputStore((s) => s.setSink);
  const resetToDefault = useAudioOutputStore((s) => s.resetToDefault);
  const [testing, setTesting] = useState(false);
  const toneRef = useRef<TestToneHandle | null>(null);

  useEffect(() => () => toneRef.current?.stop(), []);

  if (!slot) return null;

  const physical = devices.filter((d) => d.kind !== 'communications');

  function onChange(id: string) {
    if (!id) { resetToDefault(); return; }
    const dev = physical.find((d) => d.deviceId === id);
    setSink(id, dev?.label ?? null);
  }

  function onTest() {
    toneRef.current?.stop();
    setTesting(true);
    const h = playTestTone(sinkId, 1500);
    toneRef.current = h;
    void h.finished.finally(() => setTesting(false));
  }

  return (
    <div className="fixed left-1/2 top-2 z-[95] flex max-w-[calc(100vw-16px)] -translate-x-1/2 items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-xs text-white ring-1 ring-white/15 backdrop-blur">
      <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 font-bold text-black">{slot}번</span>
      <span className="shrink-0 font-semibold">{kind === 'brand' ? '브랜드' : '매장'} 플레이어</span>
      <Speaker size={14} className="shrink-0 text-white/70" />
      {supportSink ? (
        <>
          <select
            value={sinkId ?? ''}
            onChange={(e) => onChange(e.target.value)}
            aria-label={`${slot}번 플레이어 출력 장치`}
            className="min-w-0 max-w-[14rem] truncate rounded-md bg-white/10 px-1.5 py-0.5 text-xs text-white outline-none"
          >
            <option value="">기본 스피커</option>
            {physical.filter((d) => d.kind !== 'default').map((d) => (
              <option key={d.deviceId} value={d.deviceId}>{d.label || '이름 없는 장치'}</option>
            ))}
          </select>
          {needPermission && (
            <button type="button" onClick={() => void requestLabelPermission()} className="shrink-0 underline">
              장치 이름 보기
            </button>
          )}
          <button
            type="button"
            onClick={onTest}
            disabled={testing}
            aria-label="테스트음"
            className="shrink-0 rounded-md bg-white/10 p-1 disabled:opacity-50"
          >
            <Volume2 size={13} />
          </button>
        </>
      ) : (
        <span className="text-amber-300">이 브라우저는 스피커 선택 불가 — 크롬·엣지 사용</span>
      )}
    </div>
  );
}
