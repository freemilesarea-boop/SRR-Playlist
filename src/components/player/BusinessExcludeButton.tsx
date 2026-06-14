/**
 * BusinessExcludeButton — X6.72 / Phase 5.
 *
 * 매장(business) 모드에서 재생 중인 트랙을 "우리 매장 안 어울려" 1-click 제외.
 * 1차 클릭: 기본 사유(매장 분위기 부적합) 즉시 등록 + 다음 곡으로 자동 스킵.
 * 길게 누르기/확장 (Alt+click): 사유 dropdown 으로 변경 사유 선택 가능.
 *
 * 권한: business 플랜 사용자만 동작 (RPC 가 검증, RPC 실패 시 친절한 toast).
 * 효과: Phase 3c per-store cluster 학습 데이터 채워짐 + Phase 4d 트리거로 fit_score 자동 recompute.
 */
import { useState } from 'react';
import { Ban, Check } from 'lucide-react';
import {
  businessExcludeTrack,
  deriveStoreTypeSlug,
} from '@/lib/businessExclusion';
import { useBusinessStore } from '@/store/businessStore';
import { usePlayerStore } from '@/store/playerStore';
import { toast } from '@/store/toastStore';

const REASON_OPTIONS = [
  { key: 'store_mismatch', label: '매장 분위기 부적합' },
  { key: 'audio_quality_low', label: '음질 부족' },
  { key: 'duration_invalid', label: '곡 길이 부적절' },
  { key: 'metadata_invalid', label: '메타데이터/장르 오류' },
];

interface Props {
  trackId: string;
  /** 컬러 모드 — expanded(검은 배경 player) / compact(밝은 list inline) */
  variant?: 'expanded' | 'compact';
  /** true(기본): 제외 후 다음 곡 자동. false: 큐 항목 등 현재 재생 외 트랙용. */
  skipAfter?: boolean;
}

export default function BusinessExcludeButton({ trackId, variant = 'expanded', skipAfter = true }: Props) {
  const businessMode = useBusinessStore((s) => s.businessMode);
  const selectedCategory = useBusinessStore((s) => s.selectedCategory);
  const playerNext = usePlayerStore((s) => s.next);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (!businessMode || !selectedCategory) return null;
  const slug = deriveStoreTypeSlug(selectedCategory);
  if (!slug) return null;

  async function doExclude(reasonKey: string) {
    setBusy(true);
    try {
      const res = await businessExcludeTrack(trackId, slug!, reasonKey);
      setDone(true);
      const tail = skipAfter ? ' 다음 곡으로 넘어갑니다.' : '';
      toast.success(`"${selectedCategory}" 매장에서 제외됨 — ${res.reason}.${tail}`);
      setOpen(false);
      if (skipAfter) {
        window.setTimeout(() => {
          playerNext();
          setDone(false);
        }, 800);
      } else {
        // 큐 항목 — 다음곡 호출 안 함. 잠깐 확인 표시 후 복귀.
        window.setTimeout(() => setDone(false), 1500);
      }
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      if (msg.includes('business plan required')) {
        toast.error('매장(business) 플랜에서만 사용 가능합니다.');
      } else {
        toast.error(`제외 실패: ${msg}`);
      }
    } finally {
      setBusy(false);
    }
  }

  const isCompact = variant === 'compact';
  const baseCls = isCompact
    ? 'bg-bg-soft text-ink-mute ring-line/10 hover:text-rose-600 dark:hover:text-rose-300'
    : 'border-0 bg-white/10 backdrop-blur ring-white/15 text-white/90 hover:text-white';
  const sizeCls = isCompact ? 'h-7 w-7' : 'h-9 w-9';
  const iconSize = isCompact ? 12 : 16;

  return (
    <div className="relative inline-flex">
      <button
        type="button"
        disabled={busy || done}
        onClick={(e) => {
          e.stopPropagation();
          if (e.altKey || e.shiftKey) {
            setOpen((v) => !v);
            return;
          }
          void doExclude('store_mismatch');
        }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }}
        title={`이 곡 "${selectedCategory}" 매장 제외 (Shift/Alt+click → 사유 선택)`}
        aria-label="매장에서 이 곡 제외"
        className={`inline-flex items-center justify-center rounded-full ring-1 transition disabled:opacity-50 ${sizeCls} ${baseCls}`}
      >
        {done ? <Check size={iconSize} /> : <Ban size={iconSize} />}
      </button>
      {open && (
        <div
          role="menu"
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 top-full z-50 mt-1 min-w-[180px] rounded-xl bg-bg-card p-1.5 text-xs shadow-2xl ring-1 ring-line/20"
        >
          <p className="mb-1 px-2 py-0.5 text-[10px] font-semibold text-ink-mute">사유 선택</p>
          {REASON_OPTIONS.map((r) => (
            <button
              key={r.key}
              type="button"
              disabled={busy}
              onClick={(e) => { e.stopPropagation(); void doExclude(r.key); }}
              className="block w-full rounded-md px-2 py-1.5 text-left text-ink hover:bg-bg-hover disabled:opacity-40"
            >
              {r.label}
            </button>
          ))}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setOpen(false); }}
            className="mt-0.5 block w-full rounded-md px-2 py-1 text-left text-[11px] text-ink-dim hover:bg-bg-hover"
          >
            취소
          </button>
        </div>
      )}
    </div>
  );
}
