/**
 * OutputSlotBar — 분리 송출 창 맨 위의 "N번 플레이어 · 출력 장치" 바.
 *
 * 창마다 스피커를 고르는 곳이다. 선택은 이 PC·이 번호 창에만 저장된다(audioOutputStore 가
 * 슬롯별 키를 쓴다). 슬롯 창이 아니면 아무것도 그리지 않는다.
 *
 * 크롬은 마이크 권한을 한 번 허용하기 전까지 스피커 목록을 숨긴다(기본 스피커만 보임).
 * 그래서 목록이 비어 있으면 "스피커 목록 불러오기" 를 크게 띄운다 — 마이크는 쓰지 않는다.
 * 다른 번호 플레이어도 이 바에서 바로 열 수 있다(플레이어 창이 설정 화면을 가려도 된다).
 */
import { useEffect, useRef, useState } from 'react';
import { Speaker, Volume2, Plus, Settings } from 'lucide-react';
import { getOutputSlot, listenOutputSlotPresence } from '@/lib/outputSlot';
import { normalizeMultiOutputConfig, openSlotPlayer } from '@/lib/multiOutput';
import { useAudioOutputDevices } from '@/hooks/useAudioOutputDevices';
import { useAudioOutputStore } from '@/store/audioOutputStore';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/toastStore';
import { playTestTone, type TestToneHandle } from '@/lib/audioOutput';
import { useOutputSlotHeartbeat } from '@/hooks/useOutputSlotHeartbeat';

export default function OutputSlotBar({ kind }: { kind: 'brand' | 'store' }) {
  const slot = getOutputSlot();
  const { devices, supportSink, needPermission, requestLabelPermission } = useAudioOutputDevices();
  const sinkId = useAudioOutputStore((s) => s.sinkId);
  const setSink = useAudioOutputStore((s) => s.setSink);
  const resetToDefault = useAudioOutputStore((s) => s.resetToDefault);
  const rawConfig = useAuthStore((s) => s.profile?.multi_output_config);
  const [testing, setTesting] = useState(false);
  const [asking, setAsking] = useState(false);
  const toneRef = useRef<TestToneHandle | null>(null);

  useEffect(() => () => toneRef.current?.stop(), []);
  // 다른 창의 "N번 열려 있나?" 질문에 답한다 — 이미 열린 창을 다시 불러와 끊지 않게.
  useEffect(() => (slot ? listenOutputSlotPresence(slot) : undefined), [slot]);
  // 공간별 상태 보고(관리자·점주 모니터링) — 슬롯 창이 아니면 no-op.
  useOutputSlotHeartbeat(kind);

  if (!slot) return null;

  const physical = devices.filter((d) => d.kind !== 'communications' && d.kind !== 'default');
  const others = normalizeMultiOutputConfig(rawConfig).slots.filter((s) => s.mode !== 'off' && s.slot !== slot);
  // 권한 전에는 장치가 아예 없거나 이름·ID 가 비어 있다 — 고를 수 있는 스피커가 없다.
  const noRealDevices = needPermission || physical.every((d) => !d.deviceId);

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

  async function onAsk() {
    setAsking(true);
    try {
      const ok = await requestLabelPermission();
      if (!ok) {
        toast.warning(
          '스피커 목록을 못 불러왔어요. 주소창 왼쪽 자물쇠 → 마이크 "허용" 후 새로고침하세요. '
          + '마이크가 하나도 없는 PC 는 크롬이 목록을 안 보여줘서, 아무 마이크(이어폰 마이크 등)를 꽂아야 합니다.',
        );
      }
    } finally { setAsking(false); }
  }

  return (
    <div className="fixed left-1/2 top-2 z-[95] flex w-max max-w-[calc(100vw-16px)] -translate-x-1/2 flex-col items-stretch gap-1.5 rounded-2xl bg-black/75 px-3 py-2 text-xs text-white ring-1 ring-white/15 backdrop-blur">
      <div className="flex items-center gap-2">
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
              {physical.filter((d) => d.deviceId).map((d) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label || '이름 없는 장치'}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={onTest}
              disabled={testing}
              aria-label="테스트음"
              title="이 스피커로 테스트음"
              className="shrink-0 rounded-md bg-white/10 p-1 disabled:opacity-50"
            >
              <Volume2 size={13} />
            </button>
          </>
        ) : (
          <span className="text-amber-300">이 브라우저는 스피커 선택 불가 — 크롬·엣지 사용</span>
        )}
        <a href="/profile" target="_blank" rel="noopener" title="분리 송출 설정" className="shrink-0 rounded-md bg-white/10 p-1">
          <Settings size={13} />
        </a>
      </div>

      {supportSink && noRealDevices && (
        <div className="flex items-center gap-2 rounded-lg bg-amber-400/15 px-2 py-1.5 ring-1 ring-amber-300/30">
          <p className="min-w-0 flex-1 text-[11px] leading-snug text-amber-100">
            스피커가 안 보이면 눌러 주세요. 크롬이 <b>마이크 권한</b>을 묻는데 <b>허용</b>하면 연결된 스피커가 다 보입니다.
            (마이크는 쓰지 않아요 · 한 번만)
          </p>
          <button
            type="button"
            onClick={() => void onAsk()}
            disabled={asking}
            className="shrink-0 whitespace-nowrap rounded-md bg-amber-300 px-2 py-1 font-bold text-black disabled:opacity-60"
          >
            스피커 목록 불러오기
          </button>
        </div>
      )}

      {others.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-white/60">다른 공간</span>
          {others.map((s) => (
            <button
              key={s.slot}
              type="button"
              onClick={() => void openSlotPlayer(s)}
              className="flex items-center gap-1 whitespace-nowrap rounded-md bg-white/10 px-2 py-0.5 hover:bg-white/20"
            >
              <Plus size={11} />
              {s.slot}번 {s.mode === 'brand' ? '브랜드' : '매장'} 창 열기
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
