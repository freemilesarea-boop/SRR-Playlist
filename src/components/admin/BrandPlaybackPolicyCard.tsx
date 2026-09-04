// BRAND-DAILY-PLAYLIST-1 (0508) — 브랜드별 재생 정책 + 오늘의 플레이리스트.
//
// 관리자가 브랜드마다 "24시간 상시 재생"인지 "영업시간에만 재생"인지 설정한다.
// 기본값은 24시간(always_on) — 브랜드 플레이어의 기본 계약이다.
//
// 아래쪽에는 매일 09:00 KST 서버가 만든 오늘의 플레이리스트(곡 수 / 신규 발매곡 수 /
// 총 재생시간)를 보여주고, 즉시 재생성도 할 수 있다. 재생성해도 매장에서 나오고 있는
// 곡은 끊기지 않는다 — 플레이어가 현재 곡을 유지한 채 큐만 교체한다.
import { useCallback, useEffect, useState } from 'react';
import { Clock, RefreshCw, Radio } from 'lucide-react';
import { AdminCard, AdminButton, AdminBadge, AdminAlert, AdminSkeleton } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  adminGetBrandPlaybackPolicy, adminSetBrandPlaybackPolicy, adminRegenerateBrandDailyPlaylist,
} from '@/lib/api/brandPlayerApi';
import type { BrandPlaybackPolicy } from '@/types/brand';

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];
const inputCls = 'w-full rounded-lg border border-line/25 bg-bg px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent/50';

/** '09:00:00' / '09:00' → '09:00' (input[type=time] 값). */
function toTimeInput(v: string | null): string {
  if (!v) return '';
  const m = /^(\d{2}):(\d{2})/.exec(v);
  return m ? `${m[1]}:${m[2]}` : '';
}

export default function BrandPlaybackPolicyCard({ brandId }: { brandId: string }) {
  const [policy, setPolicy] = useState<BrandPlaybackPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const [mode, setMode] = useState<'always_on' | 'business_hours'>('always_on');
  const [open, setOpen] = useState('09:00');
  const [close, setClose] = useState('22:00');
  const [days, setDays] = useState<number[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const p = await adminGetBrandPlaybackPolicy(brandId);
      setPolicy(p);
      setMode(p.playback_mode);
      setOpen(toTimeInput(p.open_time) || '09:00');
      setClose(toTimeInput(p.close_time) || '22:00');
      setDays(p.playback_days);
    } catch (e) { setErr(e instanceof Error ? e.message : '조회 실패'); }
    finally { setLoading(false); }
  }, [brandId]);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (mode === 'business_hours' && open === close) {
      toast.error('시작·종료 시각이 같습니다. 24시간이면 "24시간 재생"을 선택하세요.');
      return;
    }
    setSaving(true);
    try {
      const p = await adminSetBrandPlaybackPolicy({
        brandId,
        playbackMode: mode,
        openTime: mode === 'business_hours' ? open : null,
        closeTime: mode === 'business_hours' ? close : null,
        days: mode === 'business_hours' ? days : null,
      });
      setPolicy(p);
      toast.success(mode === 'always_on' ? '24시간 재생으로 저장했어요' : '영업시간 재생으로 저장했어요');
    } catch (e) { toast.error(`저장 실패: ${(e as Error).message}`); }
    finally { setSaving(false); }
  }

  async function regenerate() {
    setRegenerating(true);
    try {
      const r = await adminRegenerateBrandDailyPlaylist(brandId);
      if (r.ok) {
        toast.success(`오늘 플레이리스트를 다시 만들었어요 — ${r.track_count}곡 (신규 ${r.new_release_count}곡)`);
        await load();
      } else {
        toast.error(r.reason === 'empty_playlist'
          ? '정책에 맞는 곡이 없어 기존 플레이리스트를 유지했어요. 음악 정책을 확인해주세요.'
          : '재생성에 실패했어요.');
      }
    } catch (e) { toast.error(`재생성 실패: ${(e as Error).message}`); }
    finally { setRegenerating(false); }
  }

  function toggleDay(d: number) {
    setDays((prev) => {
      const cur = prev ?? [0, 1, 2, 3, 4, 5, 6];
      const next = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort((a, b) => a - b);
      // 전부 선택 = 매일(null) 과 같다 — 서버에도 null 로 보내 의미를 단순하게 유지.
      return next.length === 7 ? null : next;
    });
  }

  const selectedDays = days ?? [0, 1, 2, 3, 4, 5, 6];
  const now = policy?.now;
  const crossesMidnight = mode === 'business_hours' && open > close;

  return (
    <AdminCard
      title="재생 정책 · 오늘의 플레이리스트"
      subtitle="브랜드 플레이어는 24시간 재생이 기본입니다. 영업시간에만 재생하려면 아래에서 시간을 지정하세요."
    >
      {loading ? <AdminSkeleton variant="block" rows={4} />
        : err ? <AdminAlert tone="danger" title="조회 실패" description={err} />
        : (
          <div className="space-y-4">
            {/* 현재 상태 */}
            <div className="flex flex-wrap items-center gap-2">
              <AdminBadge tone={now?.should_play ? 'success' : 'neutral'}>
                {now?.should_play ? '지금 재생 중 구간' : '지금 재생 정지 구간'}
              </AdminBadge>
              {now?.local_time && (
                <span className="text-[11px] text-ink-dim">매장 현지시각 {now.local_time} ({now.timezone ?? 'Asia/Seoul'})</span>
              )}
            </div>

            {/* 모드 선택 */}
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button" onClick={() => setMode('always_on')}
                className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  mode === 'always_on' ? 'border-accent/50 bg-accent/10' : 'border-line/25 bg-bg hover:bg-bg-hover'}`}
              >
                <Radio size={15} className="mt-0.5 shrink-0 text-accent" />
                <span>
                  <span className="block text-sm font-bold text-ink">24시간 재생 <span className="text-[10px] font-semibold text-ink-dim">(기본)</span></span>
                  <span className="block text-[11px] text-ink-mute">매장 화면이 켜져 있는 동안 끊김 없이 계속 재생합니다.</span>
                </span>
              </button>
              <button
                type="button" onClick={() => setMode('business_hours')}
                className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  mode === 'business_hours' ? 'border-accent/50 bg-accent/10' : 'border-line/25 bg-bg hover:bg-bg-hover'}`}
              >
                <Clock size={15} className="mt-0.5 shrink-0 text-accent" />
                <span>
                  <span className="block text-sm font-bold text-ink">영업시간에만 재생</span>
                  <span className="block text-[11px] text-ink-mute">지정한 시간·요일에만 소리가 나고, 그 외에는 조용합니다.</span>
                </span>
              </button>
            </div>

            {mode === 'business_hours' && (
              <div className="space-y-3 rounded-xl border border-line/20 bg-bg-soft/40 p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block space-y-1">
                    <span className="text-[11px] font-semibold text-ink-mute">영업 시작</span>
                    <input className={inputCls} type="time" value={open} onChange={(e) => setOpen(e.target.value)} />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-[11px] font-semibold text-ink-mute">영업 종료</span>
                    <input className={inputCls} type="time" value={close} onChange={(e) => setClose(e.target.value)} />
                  </label>
                </div>
                {crossesMidnight && (
                  <p className="text-[11px] text-ink-mute">자정을 넘기는 영업시간으로 처리합니다 — {open} 부터 다음날 {close} 까지 재생합니다.</p>
                )}
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold text-ink-mute">영업 요일</p>
                  <div className="flex flex-wrap gap-1.5">
                    {DAY_LABELS.map((label, d) => (
                      <button
                        key={d} type="button" onClick={() => toggleDay(d)}
                        className={`h-8 w-8 rounded-lg border text-xs font-bold transition-colors ${
                          selectedDays.includes(d) ? 'border-accent/50 bg-accent/10 text-ink' : 'border-line/25 bg-bg text-ink-dim'}`}
                      >{label}</button>
                    ))}
                  </div>
                  {days === null && <p className="mt-1 text-[11px] text-ink-dim">매일 영업</p>}
                </div>
              </div>
            )}

            <AdminButton tone="primary" size="sm" onClick={() => void save()} disabled={saving}>
              {saving ? '저장 중…' : '재생 정책 저장'}
            </AdminButton>

            {/* 오늘의 플레이리스트 */}
            <div className="rounded-xl border border-line/20 bg-bg-soft/40 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs font-bold text-ink">오늘의 플레이리스트</p>
                <AdminButton tone="neutral" variant="subtle" size="sm" leftIcon={<RefreshCw size={13} />}
                  onClick={() => void regenerate()} disabled={regenerating}>
                  {regenerating ? '재생성 중…' : '지금 다시 만들기'}
                </AdminButton>
              </div>
              {policy?.today ? (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-mute">
                  <span><b className="text-ink">{policy.today.track_count}</b>곡</span>
                  <span>신규 발매 <b className="text-ink">{policy.today.new_release_count}</b>곡</span>
                  <span>총 <b className="text-ink">{policy.today.total_hours}</b>시간 (이후 반복 재생)</span>
                  <span className="text-ink-dim">{policy.today.service_date} 생성</span>
                </div>
              ) : (
                <p className="text-[11px] text-ink-mute">아직 오늘 플레이리스트가 없습니다. 매일 오전 9시에 자동 생성되며, 그 전까지는 정책에 따라 실시간으로 선곡됩니다.</p>
              )}
              <p className="mt-2 text-[11px] text-ink-dim">
                매일 오전 9시(KST) 음악 정책에 맞춰 신규 발매곡을 포함한 플레이리스트가 자동 생성되고, 매장 플레이어는 9시 1분~5분 사이에 자동 반영합니다. 반영 중에도 재생 중인 곡은 끊기지 않습니다.
              </p>
            </div>
          </div>
        )}
    </AdminCard>
  );
}
