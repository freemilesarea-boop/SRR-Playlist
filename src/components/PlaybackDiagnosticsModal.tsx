import { useState } from 'react';
import { readDiagLog, clearDiagLog, diagLogText } from '@/lib/playbackDiag';
import { readPerfLog, clearPerfLog } from '@/lib/perfPlayback';
import { toast } from '@/store/toastStore';
import { X, Copy, Trash2 } from 'lucide-react';

/**
 * 재생 진단 보기 — 숨은 화면.
 *
 * 릴리스 APK 에는 개발자 도구가 없고, 매장 태블릿에 ADB 를 꽂을 수도 없다.
 * 그런데 정작 기기에서만 나는 실패가 있다. 그래서 기록을 눈으로 보고
 * 복사할 수 있는 통로를 하나 둔다.
 *
 * 일반 사용자 동선에는 없다 — 프로필 화면의 앱 버전을 일곱 번 눌러야 열린다.
 * 재생 동작에는 전혀 관여하지 않는다(읽기만 한다).
 */
export default function PlaybackDiagnosticsModal({ onClose }: { onClose: () => void }) {
  const [, forceRender] = useState(0);
  const diag = readDiagLog();
  const perf = readPerfLog();
  const empty = diag.length === 0 && perf.length === 0;

  async function copyAll() {
    const text = [...perf, '', diagLogText()].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast.success('진단 기록을 복사했어요.');
    } catch {
      // 클립보드가 막힌 WebView — 선택해서 복사할 수 있게 안내만 한다.
      toast.info('복사가 막혀 있어요. 아래 내용을 길게 눌러 복사해주세요.');
    }
  }

  function clearAll() {
    clearDiagLog();
    clearPerfLog();
    forceRender((n) => n + 1);
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-bg pt-safe pb-safe">
      <header className="flex items-center justify-between border-b border-line/15 px-4 py-3">
        <div>
          <h2 className="text-base font-bold text-ink">재생 진단</h2>
          <p className="text-[11px] text-ink-mute">
            지연 {perf.length}건 · 실패 {diag.length}건
          </p>
        </div>
        <button onClick={onClose} aria-label="닫기" className="app-tap p-2 text-ink-mute">
          <X size={20} />
        </button>
      </header>

      <div className="flex gap-2 border-b border-line/10 px-4 py-2">
        <button
          onClick={() => void copyAll()}
          disabled={empty}
          className="app-tap inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-40"
        >
          <Copy size={14} /> 로그 복사
        </button>
        <button
          onClick={clearAll}
          disabled={empty}
          className="app-tap inline-flex items-center gap-1.5 rounded-xl bg-ink/10 px-3 py-2 text-[13px] font-semibold text-ink disabled:opacity-40"
        >
          <Trash2 size={14} /> 초기화
        </button>
      </div>

      <div className="flex-1 overflow-auto px-4 py-3">
        {empty ? (
          <p className="text-[13px] text-ink-mute">
            아직 기록이 없어요. 플레이리스트를 재생해보면 지연 측정이 쌓이고,
            재생이 실패하면 그 내용도 여기 남습니다.
          </p>
        ) : (
          <pre className="whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed text-ink-dim">
            {[...perf, '', diagLogText()].join('\n')}
          </pre>
        )}
      </div>
    </div>
  );
}
