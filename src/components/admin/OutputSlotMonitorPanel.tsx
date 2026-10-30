/**
 * OutputSlotMonitorPanel — 매장 상태 > 분리 송출 (0537).
 *
 * 분리 송출 매장은 플레이어 창이 2~3개다. 기존 매장 상태는 매장당 한 줄이라 창들이
 * 서로 덮어써, 공간 하나가 멈춰도 보이지 않았다. 이 화면은 매장 × 공간(1~3번)으로 보여준다.
 * 끊긴 공간이 있는 매장을 위로 올린다.
 */
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Speaker, Megaphone, Music } from 'lucide-react';
import {
  AdminSection, AdminSearch, AdminBadge, AdminButton, AdminEmpty, AdminSkeleton, AdminAlert,
  type AdminToneName,
} from '@/components/admin/ui';
import {
  adminListOutputSlotStatus, slotDisplayState, SLOT_DISPLAY_LABEL,
  type AdminOutputSlotStore, type OutputSlotStatus, type SlotDisplayState,
} from '@/lib/api/outputSlotApi';
import { friendlyError } from '@/lib/errorMessages';

const POLL_MS = 30_000;

const STATE_TONE: Record<SlotDisplayState, AdminToneName> = {
  playing: 'success',
  paused: 'warning',
  idle: 'warning',
  hidden: 'warning',
  offline: 'danger',
  never: 'neutral',
};

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (sec < 60) return '방금';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  return hr < 24 ? `${hr}시간 전` : `${Math.floor(hr / 24)}일 전`;
}

function roleLabel(s: OutputSlotStatus): string {
  if (s.mode === 'brand') return '브랜드';
  return s.source === 'category' && s.category ? `매장 · ${s.category}` : '매장 · 내 스케줄';
}

export default function OutputSlotMonitorPanel() {
  const [rows, setRows] = useState<AdminOutputSlotStore[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      setRows(await adminListOutputSlotStatus(search));
      setError(null);
    } catch (e) {
      setError(friendlyError(e, '불러오지 못했어요'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [search]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(t);
  }, [load]);

  useEffect(() => {
    const t = window.setInterval(() => { if (!document.hidden) void load(); }, POLL_MS);
    return () => window.clearInterval(t);
  }, [load]);

  const troubled = rows.filter((r) => r.offline_count > 0).length;

  return (
    <AdminSection
      title={<span className="flex items-center gap-2"><Speaker size={16} /> 분리 송출 공간별 상태</span>}
      description="분리 송출을 쓰는 매장의 1~3번 공간(플레이어 창)별 상태입니다. 3분 이상 보고가 없으면 연결 끊김으로 봅니다. 30초마다 갱신됩니다."
      badge={troubled > 0
        ? <AdminBadge tone="danger" variant="subtle">끊긴 공간 있는 매장 {troubled}</AdminBadge>
        : <AdminBadge tone="neutral" variant="subtle">매장 {rows.length}</AdminBadge>}
      action={
        <AdminButton
          tone="neutral" variant="subtle" size="sm"
          leftIcon={<RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />}
          onClick={() => void load(true)}
          disabled={loading || refreshing}
        >
          새로고침
        </AdminButton>
      }
    >
      <AdminSearch value={search} onChange={setSearch} placeholder="매장명 또는 이메일" />

      {error && <AdminAlert tone="danger" title="불러오기 실패" description={error} />}

      {loading ? (
        <AdminSkeleton rows={4} />
      ) : rows.length === 0 ? (
        <AdminEmpty
          icon={<Speaker size={20} />}
          title="분리 송출을 쓰는 매장이 없어요"
          description="점주가 내 정보에서 분리 송출을 켜면 여기에 공간별로 나타납니다."
        />
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.store_id} className="rounded-xl bg-bg-card p-3 ring-1 ring-line/10">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{r.store_label ?? '(이름 없음)'}</p>
                  <p className="truncate text-[11px] text-ink-mute">{r.email}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  {!r.enabled && <AdminBadge tone="neutral" variant="subtle">분리 송출 꺼짐</AdminBadge>}
                  {r.announcement_slot && (
                    <AdminBadge tone="info" variant="subtle" icon={<Megaphone size={10} />}>
                      안내방송 {r.announcement_slot}번
                    </AdminBadge>
                  )}
                </div>
              </div>

              <div className="mt-2 grid gap-1.5 sm:grid-cols-3">
                {r.slots.map((s) => {
                  const state = slotDisplayState(s);
                  return (
                    <div key={s.slot} className="rounded-lg bg-bg-soft p-2">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-bold">{s.slot}번 · {roleLabel(s)}</span>
                        <AdminBadge tone={STATE_TONE[state]} variant="subtle">{SLOT_DISPLAY_LABEL[state]}</AdminBadge>
                      </div>
                      {s.track_title && (
                        <p className="mt-1 flex items-center gap-1 truncate text-[11px]">
                          <Music size={11} className="shrink-0 text-ink-mute" />
                          <span className="truncate">{s.track_title}{s.track_artist ? ` — ${s.track_artist}` : ''}</span>
                        </p>
                      )}
                      <p className="mt-0.5 truncate text-[11px] text-ink-mute">
                        {s.sink_label ?? '기본 스피커'} · 보고 {timeAgo(s.last_heartbeat_at)}
                      </p>
                      {s.reported_mode && s.reported_mode !== s.mode && (
                        <p className="mt-0.5 text-[11px] text-amber-600 dark:text-amber-400">
                          설정과 다른 플레이어가 열려 있음 — 창을 다시 열어야 해요
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </AdminSection>
  );
}
