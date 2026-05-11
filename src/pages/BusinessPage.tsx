import { useEffect, useMemo, useState } from 'react';
import { Store, Sparkles } from 'lucide-react';
import { BUSINESS_CATEGORIES } from '@/lib/constants';
import { fetchPlaylists } from '@/lib/api';
import { useBusinessStore } from '@/store/businessStore';
import { useAuthStore } from '@/store/authStore';
import type { PlaylistRow } from '@/types/db';
import PlaylistRow_ from '@/components/PlaylistRow';
import { currentTimeSlot, timeSlotLabel } from '@/lib/format';

export default function BusinessPage() {
  const { businessMode, setBusinessMode, selectedCategory, setCategory } = useBusinessStore();
  const { profile } = useAuthStore();
  const [playlists, setPlaylists] = useState<PlaylistRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetchPlaylists()
      .then((all) => {
        if (alive) setPlaylists(all.filter((p) => p.is_business_only));
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const slot = currentTimeSlot();

  const filtered = useMemo(() => {
    if (!selectedCategory) return playlists;
    return playlists.filter(
      (p) => p.business_category === selectedCategory || p.category === selectedCategory,
    );
  }, [playlists, selectedCategory]);

  const timeRecommended = useMemo(
    () => filtered.filter((p) => p.time_slot === slot),
    [filtered, slot],
  );

  const isBusinessPlan = profile?.subscription_type === 'business';

  return (
    <div className="space-y-8 px-4 pb-8 pt-6 sm:px-6">
      <header className="space-y-4">
        <div className="flex items-center gap-2">
          <Store size={22} className="text-accent" />
          <h1 className="text-2xl font-bold sm:text-3xl">사업자 모드</h1>
        </div>
        <p className="text-sm text-ink-mute">
          매장 분위기에 맞춰 자동으로 흘러가요. 화면이 꺼져도 안정적으로 재생됩니다.
        </p>

        <div className="flex items-center justify-between rounded-2xl bg-bg-card p-4">
          <div>
            <p className="text-sm font-medium">사업자 모드</p>
            <p className="text-xs text-ink-mute">화면 꺼짐 방지 · 장시간 재생 안정화</p>
          </div>
          <button
            onClick={() => setBusinessMode(!businessMode)}
            className={`relative h-7 w-12 rounded-full transition ${
              businessMode ? 'bg-accent' : 'bg-bg-hover'
            }`}
            aria-label="사업자 모드 토글"
          >
            <span
              className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition-all ${
                businessMode ? 'left-5' : 'left-0.5'
              }`}
            />
          </button>
        </div>

        {!isBusinessPlan && (
          <div className="flex items-start gap-2 rounded-xl border border-accent/30 bg-accent/5 p-3 text-xs text-ink-mute">
            <Sparkles size={14} className="mt-0.5 shrink-0 text-accent" />
            <span>
              사업자 플랜에서 모든 업종별 플레이리스트와 안정 재생 기능을 이용할 수 있어요.
            </span>
          </div>
        )}
      </header>

      {/* 업종 선택 */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink-mute">업종을 골라주세요</h2>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          <CategoryChip label="전체" active={!selectedCategory} onClick={() => setCategory(null)} />
          {BUSINESS_CATEGORIES.map((c) => (
            <CategoryChip
              key={c.key}
              label={`${c.emoji} ${c.key}`}
              active={selectedCategory === c.key}
              onClick={() => setCategory(c.key)}
            />
          ))}
        </div>
      </section>

      {loading ? (
        <p className="text-sm text-ink-mute">불러오는 중…</p>
      ) : (
        <>
          {timeRecommended.length > 0 && (
            <PlaylistRow_
              title={`⏰ 지금 ${timeSlotLabel(slot)}에 어울리는`}
              subtitle="시간대 자동 추천"
              playlists={timeRecommended}
            />
          )}

          <PlaylistRow_
            title={selectedCategory ? `${selectedCategory} 추천` : '전체 사업자 플레이리스트'}
            playlists={filtered}
            emptyText="해당 업종의 플레이리스트가 아직 없어요."
          />
        </>
      )}
    </div>
  );
}

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-2 text-xs font-medium transition ${
        active
          ? 'bg-accent text-black'
          : 'bg-bg-card text-ink-mute hover:bg-bg-hover hover:text-ink'
      }`}
    >
      {label}
    </button>
  );
}
