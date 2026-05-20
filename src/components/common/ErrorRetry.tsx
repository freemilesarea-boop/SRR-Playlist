import { AlertCircle, RotateCw } from 'lucide-react';

/**
 * 페이지/섹션 데이터 로드 실패 시 표준 에러 + 재시도 UI.
 * 무한 "불러오는 중…" 대신 명확한 실패 상태 + 자체 retry 제공 (새로고침 불필요).
 */
export default function ErrorRetry({
  message,
  onRetry,
  className,
}: {
  message?: string | null;
  onRetry: () => void;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 rounded-2xl bg-bg-card/60 p-8 text-center ring-1 ring-line/10 ${className ?? ''}`}
    >
      <AlertCircle size={28} className="text-ink-dim" />
      <div>
        <p className="text-sm font-semibold">데이터를 불러오지 못했어요</p>
        {message && <p className="mt-1 line-clamp-2 text-xs text-ink-mute">{message}</p>}
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-bold text-white ring-1 ring-white/15 transition hover:bg-accent-soft"
      >
        <RotateCw size={14} /> 다시 시도
      </button>
    </div>
  );
}
