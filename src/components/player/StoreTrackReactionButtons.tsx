/**
 * StoreTrackReactionButtons — X6.84 / Phase 9 (1차).
 *
 * 매장용 플레이어에 👍 좋음 / 👎 별로 버튼 노출.
 * 일반 사용자 페이지에는 사용하지 않음 (StorePlayerPage / 매장 전용 wrapper 한정).
 *
 * 정책:
 *   - 같은 store + track 은 1행. reaction_type 만 갱신.
 *   - 같은 버튼 재클릭은 no-op (이번 PR 에서 삭제 기능 없음).
 *   - 저장 실패 시 플레이어 재생 중단 X — toast 만.
 *   - 모바일 터치 영역 ≥ 44px.
 *
 * 비교 — BusinessExcludeButton (X6.72):
 *   - dislike = 학습 신호 (다음 추천 점수 조정)
 *   - 제외 = 앞으로 재생 차단 (guardrail)
 */
import { useCallback, useEffect, useState } from 'react';
import { ThumbsUp, ThumbsDown } from 'lucide-react';
import {
  getStoreTrackReaction,
  upsertStoreTrackReaction,
  type StoreTrackReactionType,
} from '@/lib/api/storeTrackReactionsApi';
import { toast } from '@/store/toastStore';

interface Props {
  storeId: string;
  trackId: string;
  businessId?: string | null;
  playlistId?: string | null;
  disabled?: boolean;
  /** compact=true → 작은 사이즈 (인라인용). 기본 false → 매장 키오스크 큰 버튼. */
  compact?: boolean;
}

export default function StoreTrackReactionButtons({
  storeId,
  trackId,
  businessId = null,
  playlistId = null,
  disabled = false,
  compact = false,
}: Props) {
  const [current, setCurrent] = useState<StoreTrackReactionType | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // 현재 반응 조회 (트랙 변경 시 재조회)
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getStoreTrackReaction({ storeId, trackId })
      .then((r) => {
        if (!cancelled) setCurrent(r?.reaction_type ?? null);
      })
      .catch((e) => {
        // 조회 실패는 silent (UI 만 빈 상태 유지)
        console.warn('[StoreTrackReactionButtons] fetch failed', e);
        if (!cancelled) setCurrent(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [storeId, trackId]);

  const handleReact = useCallback(
    async (reactionType: StoreTrackReactionType) => {
      if (saving || disabled) return;
      // 같은 버튼 재클릭은 no-op (삭제 기능은 별도 PR)
      if (current === reactionType) return;
      setSaving(true);
      try {
        const row = await upsertStoreTrackReaction({
          storeId, trackId, reactionType, playlistId, businessId,
        });
        setCurrent(row.reaction_type);
        if (reactionType === 'like') {
          toast.success('좋아요. 이 매장 취향 학습에 반영할게요.');
        } else {
          toast.success('알겠습니다. 비슷한 곡 추천을 줄일게요.');
        }
      } catch (e) {
        // 절대 player 재생을 막지 않음
        console.error('[StoreTrackReactionButtons] save failed', e);
        toast.error('반응 저장에 실패했어요. 재생은 계속됩니다.');
      } finally {
        setSaving(false);
      }
    },
    [saving, disabled, current, storeId, trackId, playlistId, businessId],
  );

  const sizeCls = compact ? 'h-9 px-3 text-xs' : 'h-11 px-4 text-sm';
  const iconSize = compact ? 14 : 18;
  const baseBtn =
    'inline-flex items-center justify-center gap-1.5 rounded-full ring-1 transition ' +
    'disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div className="inline-flex items-center gap-2" role="group" aria-label="매장 곡 반응">
      <button
        type="button"
        disabled={loading || saving || disabled}
        onClick={() => void handleReact('like')}
        aria-pressed={current === 'like'}
        aria-label="이 곡 좋음 (매장 취향 학습)"
        title="좋음 — 매장 취향 학습 신호"
        className={`${baseBtn} ${sizeCls} ${
          current === 'like'
            ? 'bg-emerald-500 text-white ring-emerald-500 shadow'
            : 'bg-white/10 text-white/90 ring-white/20 hover:bg-white/15 backdrop-blur'
        }`}
      >
        <ThumbsUp size={iconSize} /> 좋음
      </button>
      <button
        type="button"
        disabled={loading || saving || disabled}
        onClick={() => void handleReact('dislike')}
        aria-pressed={current === 'dislike'}
        aria-label="이 곡 별로 (학습 신호, 제외와 다름)"
        title="별로 — 학습 신호 (제외와 다름: 비슷한 곡 추천 감소)"
        className={`${baseBtn} ${sizeCls} ${
          current === 'dislike'
            ? 'bg-amber-500 text-black ring-amber-500 shadow'
            : 'bg-white/10 text-white/90 ring-white/20 hover:bg-white/15 backdrop-blur'
        }`}
      >
        <ThumbsDown size={iconSize} /> 별로
      </button>
    </div>
  );
}
