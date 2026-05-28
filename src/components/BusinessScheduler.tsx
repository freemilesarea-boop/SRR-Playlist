import { useEffect, useState } from 'react';
import {
  Calendar,
  Save,
  Radio,
  Sunrise,
  Sun,
  Moon,
  ListMusic,
} from 'lucide-react';
import {
  TEMPLATE_KEYS,
  createSchedule,
  effectiveDays,
  formatSlotTime,
  getCurrentSchedule,
  upsertBusinessProfile,
  type BusinessProfile,
  type BusinessSchedule,
} from '@/lib/businessSchedulerApi';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/authStore';
import { useBusinessScheduleStore } from '@/store/businessScheduleStore';
import { useBusinessStore } from '@/store/businessStore';
import { toast } from '@/store/toastStore';
import type { PlaylistRow } from '@/types/db';
import { Clock } from 'lucide-react';

type Category = 'all' | 'weekday' | 'weekend';
type SlotName = '오전' | '오후' | '저녁';
const SLOT_NAMES: readonly SlotName[] = ['오전', '오후', '저녁'] as const;
interface SimpleSlot {
  start: string; // HH:MM
  end: string;
  playlist_id: string | null;
}

function categoryToDays(c: Category): number[] {
  return c === 'all' ? [0, 1, 2, 3, 4, 5, 6] : c === 'weekday' ? [1, 2, 3, 4, 5] : [0, 6];
}
function categoryFromDays(days: number[]): Category {
  const set = new Set(days);
  if (set.size === 7) return 'all';
  if (set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d))) return 'weekday';
  if (set.size === 2 && set.has(0) && set.has(6)) return 'weekend';
  return 'all';
}

/** 영업시간(있으면) 3등분 / 없으면 디폴트 09–12 / 12–18 / 18–22 */
function defaultSlots(profile: BusinessProfile | null): Record<SlotName, SimpleSlot> {
  function toMin(t: string): number {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + (m || 0);
  }
  function toHHMM(min: number): string {
    const h = Math.floor(min / 60) % 24;
    const m = min % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  const open = profile?.open_time?.slice(0, 5) ?? '';
  const close = profile?.close_time?.slice(0, 5) ?? '';
  let t1 = '09:00', t2 = '12:00', t3 = '18:00', t4 = '22:00';
  if (open && close) {
    const o = toMin(open);
    const c = toMin(close);
    if (c > o && c - o >= 180) {
      const third = Math.round((c - o) / 3);
      t1 = open;
      t2 = toHHMM(o + third);
      t3 = toHHMM(o + third * 2);
      t4 = close;
    }
  }
  return {
    오전: { start: t1, end: t2, playlist_id: null },
    오후: { start: t2, end: t3, playlist_id: null },
    저녁: { start: t3, end: t4, playlist_id: null },
  };
}

const SLOT_KEYWORDS: Record<SlotName, string[]> = {
  오전: ['오전', '산뜻', '카페', '오픈'],
  오후: ['오후', '라운지', '잔잔', '집중'],
  저녁: ['저녁', '와인', '재즈', '감성'],
};
function autoMatchPlaylist(name: SlotName, playlists: PlaylistRow[]): string | null {
  const businessOnly = playlists.filter((p) => p.is_business_only);
  const all = [...businessOnly, ...playlists.filter((p) => !p.is_business_only)];
  for (const k of SLOT_KEYWORDS[name]) {
    const m = all.find(
      (p) =>
        p.title.includes(k) ||
        p.category?.includes(k) ||
        (p.business_category ?? '').includes(k),
    );
    if (m) return m.id;
  }
  return all[0]?.id ?? null;
}

export default function BusinessScheduler() {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const profileSub = useAuthStore((s) => s.profile?.subscription_type);
  const storeProfile = useBusinessScheduleStore((s) => s.profile);
  const schedules = useBusinessScheduleStore((s) => s.schedules);
  const playlists = useBusinessScheduleStore((s) => s.playlists);
  const loading = useBusinessScheduleStore((s) => s.loading);
  const tick = useBusinessScheduleStore((s) => s.tick);
  const refresh = useBusinessScheduleStore((s) => s.refresh);
  const setLastSwitchedScheduleId = useBusinessScheduleStore((s) => s.setLastSwitchedScheduleId);
  const businessMode = useBusinessStore((s) => s.businessMode);

  // 매장 정보 — 로컬 편집 버퍼 (store.profile 으로 동기화)
  const [profile, setProfile] = useState<BusinessProfile | null>(storeProfile);
  useEffect(() => {
    setProfile(storeProfile);
  }, [storeProfile]);
  const [savingProfile, setSavingProfile] = useState(false);

  // 모드: unified(매일 같음) — 카테고리 1개 + 3슬롯
  //       split(주중·주말 별도) — 주중 3슬롯 + 주말 3슬롯 (총 6슬롯)
  const [mode, setMode] = useState<'unified' | 'split'>('unified');
  const [category, setCategory] = useState<Category>('all');
  const [slots, setSlots] = useState<Record<SlotName, SimpleSlot>>(() => defaultSlots(null));
  const [weekdaySlots, setWeekdaySlots] = useState<Record<SlotName, SimpleSlot>>(() => defaultSlots(null));
  const [weekendSlots, setWeekendSlots] = useState<Record<SlotName, SimpleSlot>>(() => defaultSlots(null));
  const [savingSimple, setSavingSimple] = useState(false);
  const [synced, setSynced] = useState(false);

  // schedules → 폼 prefill (최초 + profile 시간/플리 변경시)
  // split mode 감지: 같은 slot_name 으로 weekday row + weekend row 모두 있는 경우
  useEffect(() => {
    if (loading) return;
    const base = defaultSlots(storeProfile);

    function pickFor(daySet: Set<number>, name: SlotName): SimpleSlot {
      const row = schedules.find(
        (s) =>
          s.slot_name === name &&
          (() => {
            const ds = effectiveDays(s);
            // row 의 days 가 daySet 의 부분집합이면 매칭 (정확 일치 우선이지만 호환)
            return ds.length > 0 && ds.every((d) => daySet.has(d));
          })(),
      );
      if (row) {
        return {
          start: row.start_time.slice(0, 5),
          end: row.end_time.slice(0, 5),
          playlist_id: row.playlist_id,
        };
      }
      return { ...base[name], playlist_id: autoMatchPlaylist(name, playlists) };
    }

    const weekdaySet = new Set([1, 2, 3, 4, 5]);
    const weekendSet = new Set([0, 6]);

    // split 감지: 같은 슬롯에서 weekday + weekend 행이 둘 다 존재하는지
    const hasWeekday = SLOT_NAMES.some((n) =>
      schedules.some(
        (s) =>
          s.slot_name === n &&
          effectiveDays(s).length > 0 &&
          effectiveDays(s).every((d) => weekdaySet.has(d)) &&
          !effectiveDays(s).some((d) => weekendSet.has(d)),
      ),
    );
    const hasWeekend = SLOT_NAMES.some((n) =>
      schedules.some(
        (s) =>
          s.slot_name === n &&
          effectiveDays(s).length > 0 &&
          effectiveDays(s).every((d) => weekendSet.has(d)) &&
          !effectiveDays(s).some((d) => weekdaySet.has(d)),
      ),
    );
    const isSplit = hasWeekday && hasWeekend;
    setMode(isSplit ? 'split' : 'unified');

    if (isSplit) {
      setWeekdaySlots({
        오전: pickFor(weekdaySet, '오전'),
        오후: pickFor(weekdaySet, '오후'),
        저녁: pickFor(weekdaySet, '저녁'),
      });
      setWeekendSlots({
        오전: pickFor(weekendSet, '오전'),
        오후: pickFor(weekendSet, '오후'),
        저녁: pickFor(weekendSet, '저녁'),
      });
    }

    // unified 분기는 기존 그대로 (split 라도 일단 unified state 도 채워둠 — 모드 전환 시 시드 값)
    const morning = schedules.find((s) => s.slot_name === '오전');
    const afternoon = schedules.find((s) => s.slot_name === '오후');
    const evening = schedules.find((s) => s.slot_name === '저녁');
    const first = morning || afternoon || evening;
    if (!isSplit && first) {
      setCategory(categoryFromDays(effectiveDays(first)));
    }
    setSlots({
      오전: morning
        ? { start: morning.start_time.slice(0, 5), end: morning.end_time.slice(0, 5), playlist_id: morning.playlist_id }
        : { ...base.오전, playlist_id: autoMatchPlaylist('오전', playlists) },
      오후: afternoon
        ? { start: afternoon.start_time.slice(0, 5), end: afternoon.end_time.slice(0, 5), playlist_id: afternoon.playlist_id }
        : { ...base.오후, playlist_id: autoMatchPlaylist('오후', playlists) },
      저녁: evening
        ? { start: evening.start_time.slice(0, 5), end: evening.end_time.slice(0, 5), playlist_id: evening.playlist_id }
        : { ...base.저녁, playlist_id: autoMatchPlaylist('저녁', playlists) },
    });
    setSynced(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, schedules, storeProfile?.open_time, storeProfile?.close_time, playlists.length]);

  void tick; // current는 store.tick 변경에 따라 재평가 — NOW 카드와 동일 source

  async function saveProfile() {
    if (!userId || !profile) return;
    setSavingProfile(true);
    try {
      const saved = await upsertBusinessProfile({
        user_id: userId,
        store_name: profile.store_name,
        business_type: profile.business_type,
        timezone: profile.timezone || 'Asia/Seoul',
        open_time: profile.open_time,
        close_time: profile.close_time,
      });
      // 스토어 갱신
      await refresh(userId);
      setProfile(saved);
      toast.success('매장 정보를 저장했어요.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '저장 실패');
    } finally {
      setSavingProfile(false);
    }
  }

  /** 시간대 저장 — mode 에 따라 3행(unified) 또는 6행(split) insert */
  async function saveSimpleSchedule() {
    if (!userId || savingSimple) return;
    // 검증: unified or split 의 각 슬롯 시간 정합성
    const groups: Array<{ label: string; src: Record<SlotName, SimpleSlot> }> =
      mode === 'split'
        ? [
            { label: '주중', src: weekdaySlots },
            { label: '주말', src: weekendSlots },
          ]
        : [{ label: '', src: slots }];
    for (const g of groups) {
      for (const name of SLOT_NAMES) {
        const s = g.src[name];
        if (s.start >= s.end) {
          toast.info(`${g.label ? g.label + ' ' : ''}${name} 종료 시간은 시작 시간보다 늦어야 해요.`);
          return;
        }
      }
    }

    const hasOldData = schedules.length > 0;
    const totalNew = mode === 'split' ? 6 : 3;
    const msg = hasOldData
      ? `기존 시간대 ${schedules.length}개를 모두 새 ${totalNew}개 슬롯(${
          mode === 'split' ? '주중·주말 × 오전·오후·저녁' : '오전·오후·저녁'
        })으로 교체할까요?`
      : `${mode === 'split' ? '주중·주말 별도' : '오전·오후·저녁'} ${totalNew}개 시간대를 저장할까요?`;
    if (!confirm(msg)) return;

    setSavingSimple(true);
    try {
      const { error: delError } = await supabase
        .from('business_music_schedules')
        .delete()
        .eq('user_id', userId);
      if (delError) throw delError;

      if (mode === 'split') {
        const inserts: Array<Promise<unknown>> = [];
        const weekdayDays = [1, 2, 3, 4, 5];
        const weekendDays = [0, 6];
        for (const name of SLOT_NAMES) {
          inserts.push(
            createSchedule({
              user_id: userId,
              days_of_week: weekdayDays,
              slot_name: name,
              start_time: `${weekdaySlots[name].start}:00`,
              end_time: `${weekdaySlots[name].end}:00`,
              playlist_id: weekdaySlots[name].playlist_id,
              is_active: true,
            }),
          );
          inserts.push(
            createSchedule({
              user_id: userId,
              days_of_week: weekendDays,
              slot_name: name,
              start_time: `${weekendSlots[name].start}:00`,
              end_time: `${weekendSlots[name].end}:00`,
              playlist_id: weekendSlots[name].playlist_id,
              is_active: true,
            }),
          );
        }
        await Promise.all(inserts);
      } else {
        const days = categoryToDays(category);
        await Promise.all(
          SLOT_NAMES.map((name) =>
            createSchedule({
              user_id: userId,
              days_of_week: days,
              slot_name: name,
              start_time: `${slots[name].start}:00`,
              end_time: `${slots[name].end}:00`,
              playlist_id: slots[name].playlist_id,
              is_active: true,
            }),
          ),
        );
      }

      // 자동 전환 리셋 → 다음 사이클에 새 플리로 부드럽게 전환
      setLastSwitchedScheduleId(null);
      await refresh(userId);
      toast.success(`시간대 ${totalNew}개를 적용했어요.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '저장 실패');
    } finally {
      setSavingSimple(false);
    }
  }

  if (!userId) return null;

  const isBusinessPlan = profileSub === 'business';
  const businessOnly = playlists.filter((p) => p.is_business_only);
  const otherPlaylists = playlists.filter((p) => !p.is_business_only);
  const hasLegacyOnly =
    synced && schedules.length > 0 && !SLOT_NAMES.some((n) => schedules.find((s) => s.slot_name === n));
  const current = getCurrentSchedule(schedules);

  return (
    <section className="space-y-5 rounded-3xl bg-bg-card p-5 shadow-card ring-1 ring-line/10">
      {/* 헤더 */}
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/15 text-accent ring-1 ring-accent/20">
            <Calendar size={16} />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-extrabold tracking-tight">매장 자동 스케줄러</h2>
              {!isBusinessPlan && (
                <span className="rounded-full bg-yellow-500/15 px-2 py-0.5 text-[10px] font-bold text-yellow-200 ring-1 ring-yellow-300/30">
                  사업자 플랜
                </span>
              )}
            </div>
            <p className="text-xs text-ink-mute">
              여기서 설정한 3개 시간대가 NOW 카드와 자동 전환의 단일 source 입니다.
            </p>
          </div>
        </div>
      </header>

      {/* 프로필 + 영업시간 */}
      <section className="space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-ink-mute">매장 정보</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            value={profile?.store_name ?? ''}
            onChange={(e) =>
              setProfile((p) => ({
                ...(p ?? { user_id: userId, timezone: 'Asia/Seoul', store_name: null, business_type: null, open_time: null, close_time: null }),
                store_name: e.target.value,
              }))
            }
            placeholder="매장명 (예: 라벤더 카페 강남점)"
            className="input text-sm"
          />
          <select
            value={profile?.business_type ?? ''}
            onChange={(e) =>
              setProfile((p) => ({
                ...(p ?? { user_id: userId, timezone: 'Asia/Seoul', store_name: null, business_type: null, open_time: null, close_time: null }),
                business_type: e.target.value || null,
              }))
            }
            className="input text-sm"
          >
            <option value="">업종 선택</option>
            {TEMPLATE_KEYS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <input
            type="time"
            value={profile?.open_time?.slice(0, 5) ?? ''}
            onChange={(e) =>
              setProfile((p) => ({
                ...(p ?? { user_id: userId, timezone: 'Asia/Seoul', store_name: null, business_type: null, open_time: null, close_time: null }),
                open_time: e.target.value || null,
              }))
            }
            onClick={openTimePicker}
            onFocus={openTimePicker}
            className="input text-sm"
            placeholder="영업 시작"
          />
          <input
            type="time"
            value={profile?.close_time?.slice(0, 5) ?? ''}
            onChange={(e) =>
              setProfile((p) => ({
                ...(p ?? { user_id: userId, timezone: 'Asia/Seoul', store_name: null, business_type: null, open_time: null, close_time: null }),
                close_time: e.target.value || null,
              }))
            }
            onClick={openTimePicker}
            onFocus={openTimePicker}
            className="input text-sm"
            placeholder="영업 종료"
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={saveProfile}
            disabled={savingProfile || !profile?.business_type}
            className="btn-primary text-sm"
          >
            <Save size={14} />
            {savingProfile ? '저장 중…' : '매장 정보 저장'}
          </button>
        </div>
      </section>

      {/* 간단 시간대 설정 — 카테고리 1개 + 3 슬롯 */}
      <section className="space-y-4">
        <header>
          <h3 className="text-xs font-bold uppercase tracking-wider text-ink-mute">시간대 설정</h3>
          <p className="mt-0.5 text-[11px] text-ink-dim">
            저장하면 즉시 NOW 카드 + 자동 전환에 반영됩니다.
          </p>
        </header>

        {hasLegacyOnly && (
          <div className="rounded-xl bg-yellow-500/10 p-3 text-[11px] text-yellow-200 ring-1 ring-yellow-400/30">
            ⚠️ 기존에 만든 시간대 {schedules.length}개가 있어요. 저장하면 모두 새 3개 슬롯(오전·오후·저녁)으로 교체됩니다.
          </div>
        )}

        {/* 운영 모드 토글 — 매일 같음 vs 주중·주말 별도 */}
        <div className="space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-dim">운영 모드</p>
          <div className="grid grid-cols-2 gap-2">
            <CategoryButton
              label="매일 같음"
              sub="단일 3슬롯"
              active={mode === 'unified'}
              onClick={() => setMode('unified')}
            />
            <CategoryButton
              label="주중·주말 별도"
              sub="2×3슬롯 = 6"
              active={mode === 'split'}
              onClick={() => setMode('split')}
            />
          </div>
        </div>

        {mode === 'unified' ? (
          <>
            {/* unified: 카테고리 라디오 (매일/주중/주말 중 택1) */}
            <div className="space-y-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-dim">적용 요일</p>
              <div className="grid grid-cols-3 gap-2">
                <CategoryButton label="매일" sub="일~토" active={category === 'all'} onClick={() => setCategory('all')} />
                <CategoryButton label="주중만" sub="월~금" active={category === 'weekday'} onClick={() => setCategory('weekday')} />
                <CategoryButton label="주말만" sub="토·일" active={category === 'weekend'} onClick={() => setCategory('weekend')} />
              </div>
            </div>

            <div className="space-y-2">
              {SLOT_NAMES.map((name) => (
                <SimpleSlotCard
                  key={name}
                  name={name}
                  data={slots[name]}
                  businessOnly={businessOnly}
                  otherPlaylists={otherPlaylists}
                  isCurrent={current?.slot_name === name}
                  isPlaying={businessMode && current?.slot_name === name}
                  onChange={(patch) =>
                    setSlots((prev) => ({ ...prev, [name]: { ...prev[name], ...patch } }))
                  }
                  onAutoMatch={() => {
                    const pid = autoMatchPlaylist(name, playlists);
                    setSlots((prev) => ({
                      ...prev,
                      [name]: { ...prev[name], playlist_id: pid },
                    }));
                    const matched = playlists.find((p) => p.id === pid);
                    toast.success(matched ? `${name}: ${matched.title}` : `${name}: 매칭된 플리 없음`);
                  }}
                />
              ))}
            </div>
          </>
        ) : (
          <>
            {/* split: 주중 + 주말 각각 3슬롯 */}
            <SplitSlotGroup
              label="주중"
              sub="월요일 ~ 금요일"
              data={weekdaySlots}
              setData={setWeekdaySlots}
              businessOnly={businessOnly}
              otherPlaylists={otherPlaylists}
              isWeekday
              playlists={playlists}
              current={current}
              businessMode={businessMode}
            />
            <SplitSlotGroup
              label="주말"
              sub="토요일 · 일요일"
              data={weekendSlots}
              setData={setWeekendSlots}
              businessOnly={businessOnly}
              otherPlaylists={otherPlaylists}
              isWeekday={false}
              playlists={playlists}
              current={current}
              businessMode={businessMode}
            />
          </>
        )}

        <button
          onClick={() => void saveSimpleSchedule()}
          disabled={savingSimple || !synced}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-accent py-3.5 text-sm font-bold text-bg shadow-card transition hover:opacity-95 disabled:opacity-60"
        >
          <Save size={16} />
          {savingSimple
            ? '적용 중…'
            : mode === 'split'
              ? '저장 (주중·주말 6개 시간대 적용)'
              : '저장 (3개 시간대 적용)'}
        </button>
      </section>

      {loading && <p className="text-xs text-ink-dim">불러오는 중…</p>}
    </section>
  );
}

/** Split mode 의 한 그룹(주중 또는 주말) 렌더 — 라벨 헤더 + 3슬롯 카드. */
function SplitSlotGroup({
  label,
  sub,
  data,
  setData,
  businessOnly,
  otherPlaylists,
  isWeekday,
  playlists,
  current,
  businessMode,
}: {
  label: string;
  sub: string;
  data: Record<SlotName, SimpleSlot>;
  setData: React.Dispatch<React.SetStateAction<Record<SlotName, SimpleSlot>>>;
  businessOnly: PlaylistRow[];
  otherPlaylists: PlaylistRow[];
  isWeekday: boolean;
  playlists: PlaylistRow[];
  current: BusinessSchedule | null;
  businessMode: boolean;
}) {
  // 오늘이 이 그룹에 속하는지 판단 (NOW 강조)
  const todayDay = new Date().getDay();
  const groupHasToday = isWeekday ? todayDay >= 1 && todayDay <= 5 : todayDay === 0 || todayDay === 6;
  return (
    <div className="space-y-2 rounded-2xl bg-bg-soft/40 p-3 ring-1 ring-line/10">
      <div className="flex items-center justify-between gap-2 px-1">
        <div>
          <p className="text-sm font-bold tracking-tight">
            {label}
            {groupHasToday && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-accent/15 px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-[0.18em] text-accent">
                오늘
              </span>
            )}
          </p>
          <p className="text-[10px] text-ink-dim">{sub}</p>
        </div>
      </div>
      <div className="space-y-2">
        {SLOT_NAMES.map((name) => (
          <SimpleSlotCard
            key={name}
            name={name}
            data={data[name]}
            businessOnly={businessOnly}
            otherPlaylists={otherPlaylists}
            isCurrent={groupHasToday && current?.slot_name === name}
            isPlaying={groupHasToday && businessMode && current?.slot_name === name}
            onChange={(patch) =>
              setData((prev) => ({ ...prev, [name]: { ...prev[name], ...patch } }))
            }
            onAutoMatch={() => {
              const pid = autoMatchPlaylist(name, playlists);
              setData((prev) => ({
                ...prev,
                [name]: { ...prev[name], playlist_id: pid },
              }));
              const matched = playlists.find((p) => p.id === pid);
              toast.success(matched ? `${label} ${name}: ${matched.title}` : `${label} ${name}: 매칭된 플리 없음`);
            }}
          />
        ))}
      </div>
    </div>
  );
}

function CategoryButton({
  label,
  sub,
  active,
  onClick,
}: {
  label: string;
  sub: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex flex-col items-center gap-0.5 rounded-2xl py-3 text-sm font-bold transition ${
        active
          ? 'bg-accent text-bg ring-1 ring-accent shadow-card'
          : 'bg-bg-soft text-ink-mute ring-1 ring-line/10 hover:text-ink hover:ring-line/20'
      }`}
    >
      <span>{label}</span>
      <span className={`text-[10px] font-medium ${active ? 'text-bg/70' : 'text-ink-dim'}`}>{sub}</span>
    </button>
  );
}

function SimpleSlotCard({
  name,
  data,
  businessOnly,
  otherPlaylists,
  isCurrent,
  isPlaying,
  onChange,
  onAutoMatch,
}: {
  name: SlotName;
  data: SimpleSlot;
  businessOnly: PlaylistRow[];
  otherPlaylists: PlaylistRow[];
  isCurrent: boolean;
  isPlaying: boolean;
  onChange: (patch: Partial<SimpleSlot>) => void;
  onAutoMatch: () => void;
}) {
  const Icon = name === '오전' ? Sunrise : name === '오후' ? Sun : Moon;
  const tone =
    name === '오전' ? 'text-amber-300' : name === '오후' ? 'text-orange-300' : 'text-indigo-300';
  return (
    <div
      className={`relative overflow-hidden rounded-2xl p-3.5 ring-1 transition duration-smooth ease-emphasized ${
        isCurrent ? 'bg-accent/[0.08] ring-accent/40' : 'bg-bg-soft ring-line/10'
      }`}
    >
      {isCurrent && (
        <div className="pointer-events-none absolute inset-y-0 left-0 w-0.5 bg-accent" />
      )}
      <div className="flex items-center gap-2">
        <Icon size={18} className={tone} />
        <h4 className="text-sm font-bold tracking-tight">{name}</h4>
        {isCurrent && (
          <span className="ml-1 inline-flex items-center gap-1 font-mono text-[9px] font-medium uppercase tracking-[0.22em] text-accent">
            {isPlaying && <Radio size={9} className="animate-pulse" />} NOW
          </span>
        )}
        <span className="ml-auto font-mono text-[10px] text-ink-dim">
          <Clock size={10} className="-mt-0.5 mr-1 inline" />
          {data.start} ~ {data.end}
        </span>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_1fr]">
        <input
          type="time"
          value={data.start}
          onChange={(e) => onChange({ start: e.target.value })}
          onClick={openTimePicker}
          onFocus={openTimePicker}
          className="input py-1.5 text-sm font-mono"
        />
        <span className="hidden items-center justify-center text-ink-dim sm:flex">~</span>
        <input
          type="time"
          value={data.end}
          onChange={(e) => onChange({ end: e.target.value })}
          onClick={openTimePicker}
          onFocus={openTimePicker}
          className="input py-1.5 text-sm font-mono"
        />
      </div>

      <div className="mt-2 flex gap-2">
        <select
          value={data.playlist_id ?? ''}
          onChange={(e) => onChange({ playlist_id: e.target.value || null })}
          className="input flex-1 py-1.5 text-xs"
        >
          <option value="">플레이리스트 선택…</option>
          {businessOnly.length > 0 && (
            <optgroup label="사업자 전용">
              {businessOnly.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </optgroup>
          )}
          {otherPlaylists.length > 0 && (
            <optgroup label="일반">
              {otherPlaylists.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <button
          onClick={onAutoMatch}
          title="이 시간대에 맞는 플레이리스트 자동 추천"
          className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-bg-hover px-2.5 py-1.5 text-[11px] font-semibold text-ink-mute ring-1 ring-line/10 hover:text-ink"
        >
          <ListMusic size={12} /> 자동
        </button>
      </div>
    </div>
  );
}

/** 외부에서 import 가능한 CurrentBadge — NOW 카드 보조 표시용 */
export function CurrentBadge({
  label,
  schedule,
  playlists,
  playing,
  highlight,
}: {
  label: string;
  schedule: BusinessSchedule | null;
  playlists: PlaylistRow[];
  playing?: boolean;
  highlight?: boolean;
}) {
  const playlist = schedule?.playlist_id
    ? playlists.find((p) => p.id === schedule.playlist_id)
    : null;
  return (
    <div
      className={`relative overflow-hidden rounded-2xl p-3.5 ring-1 transition duration-smooth ease-emphasized ${
        highlight ? 'bg-accent/[0.08] ring-accent/30 shadow-card' : 'bg-bg-soft ring-line/10'
      }`}
    >
      {highlight && playing && (
        <div className="pointer-events-none absolute inset-y-0 left-0 w-0.5 bg-accent" />
      )}
      <div className="flex items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.22em] text-ink-dim">
        {highlight && playing && <Radio size={10} className="animate-pulse text-accent" />}
        <span className={highlight ? 'text-accent' : ''}>{label}</span>
      </div>
      {schedule ? (
        <div className="mt-1.5 space-y-1">
          <p className="truncate text-[15px] font-bold tracking-tight">{schedule.slot_name}</p>
          <p className="flex items-center gap-1.5 font-mono text-[11px] text-ink-mute">
            <Clock size={11} /> {formatSlotTime(schedule.start_time, schedule.end_time)}
          </p>
          <p className="truncate text-[12px] text-ink-mute">
            {playlist?.title ?? <span className="text-ink-dim">플리 미지정</span>}
          </p>
        </div>
      ) : (
        <p className="mt-1.5 text-xs text-ink-mute">없음</p>
      )}
    </div>
  );
}

/** 시간 input 클릭 즉시 picker — 작은 시계 아이콘만 동작하는 기본 UX 보완. */
function openTimePicker(
  e: React.MouseEvent<HTMLInputElement> | React.FocusEvent<HTMLInputElement>,
) {
  const el = e.currentTarget;
  if (
    'showPicker' in el &&
    typeof (el as HTMLInputElement & { showPicker?: () => void }).showPicker === 'function'
  ) {
    try {
      (el as HTMLInputElement & { showPicker: () => void }).showPicker();
    } catch {
      /* picker 표시 거절 시 무시 — 기본 동작 fallback */
    }
  }
}
