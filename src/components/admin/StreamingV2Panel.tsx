// Phase ALGO-2A/2B — 관리자 Streaming v2 (Shadow) 패널.
// v2 shadow 파이프라인 관측 전용. 정산/차트 무관. flag OFF 기본.
// 2B: 필터(player_type/track/store/brand) · 차이율 · Health Score · Replay/Timeline.
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Radio, Activity, Play } from 'lucide-react';
import { AdminSection, AdminCard, AdminButton, AdminBadge, AdminAlert, AdminEmpty, AdminSkeleton, AdminStatCard, AdminModal } from '@/components/admin/ui';
import type { AdminToneName } from '@/components/admin/ui';
import {
  adminStreamV2Overview, adminStreamV2Health, adminStreamV2Replay,
  type StreamV2Overview, type StreamV2Health, type StreamV2ReplayEvent, type StreamV2OverviewFilters,
} from '@/lib/streamingV2Api';

const RANGES = [{ d: 1, label: '24h' }, { d: 7, label: '7d' }, { d: 30, label: '30d' }] as const;
const PLAYER_TYPES = ['', 'USER', 'STORE', 'BRAND', 'ENTERPRISE', 'ADMIN_PREVIEW', 'ARTIST_PREVIEW', 'SYSTEM'];
const inputCls = 'w-full rounded-lg border border-line/25 bg-bg px-2.5 py-1.5 text-xs text-ink outline-none focus:border-accent/50';

export default function StreamingV2Panel() {
  const [days, setDays] = useState<number>(7);
  const [playerType, setPlayerType] = useState('');
  const [trackId, setTrackId] = useState('');
  const [storeId, setStoreId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [data, setData] = useState<StreamV2Overview | null>(null);
  const [health, setHealth] = useState<StreamV2Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [replayOpen, setReplayOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    const filters: StreamV2OverviewFilters = {
      playerType: playerType || null, trackId: trackId.trim() || null,
      storeId: storeId.trim() || null, brandId: brandId.trim() || null,
    };
    try {
      const [ov, h] = await Promise.all([
        adminStreamV2Overview(days, filters),
        adminStreamV2Health(storeId.trim() ? 'store' : brandId.trim() ? 'brand' : 'global', storeId.trim() || brandId.trim() || null, days),
      ]);
      setData(ov); setHealth(h);
    } catch (e) { setErr(e instanceof Error ? e.message : '조회 실패'); }
    finally { setLoading(false); }
  }, [days, playerType, trackId, storeId, brandId]);
  useEffect(() => { void load(); }, [load]);

  const f = data?.funnel; const diff = data?.difference;

  return (
    <AdminSection
      title="스트리밍 v2 (Shadow)"
      description="Streaming v2 shadow 파이프라인 관측 전용입니다. 정산·차트는 여전히 v1을 사용하며 이 데이터는 반영되지 않습니다. (ALGO-2A/2B)"
      action={
        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-full bg-bg-card p-1 text-xs">
            {RANGES.map((r) => (
              <button key={r.d} onClick={() => setDays(r.d)}
                className={`rounded-full px-3 py-1 font-semibold transition ${days === r.d ? 'bg-accent text-black' : 'text-ink-mute hover:bg-bg-hover'}`}>{r.label}</button>
            ))}
          </div>
          <AdminButton size="sm" variant="subtle" tone="neutral" leftIcon={<Play size={14} />} onClick={() => setReplayOpen(true)}>Replay</AdminButton>
          <AdminButton size="sm" variant="subtle" tone="neutral" leftIcon={<RefreshCw size={14} />} onClick={() => void load()}>새로고침</AdminButton>
        </div>
      }
    >
      <AdminAlert tone="info" className="mb-3" title="Shadow Mode — 정산/차트 미반영"
        description="record_stream_event_v2 로 병행 기록된 shadow 데이터입니다. streaming_v2_shadow_enabled 플래그가 OFF면 신규 기록이 없습니다. 정산 전환은 ALGO-3에서 검증 후 진행합니다." />

      {/* 필터 */}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="block space-y-1"><span className="text-[11px] text-ink-dim">player_type</span>
          <select className={inputCls} value={playerType} onChange={(e) => setPlayerType(e.target.value)}>
            {PLAYER_TYPES.map((p) => <option key={p} value={p}>{p === '' ? '전체' : p}</option>)}
          </select>
        </label>
        <label className="block space-y-1"><span className="text-[11px] text-ink-dim">track_id</span><input className={inputCls} value={trackId} onChange={(e) => setTrackId(e.target.value)} placeholder="uuid" /></label>
        <label className="block space-y-1"><span className="text-[11px] text-ink-dim">store_id</span><input className={inputCls} value={storeId} onChange={(e) => setStoreId(e.target.value)} placeholder="uuid" /></label>
        <label className="block space-y-1"><span className="text-[11px] text-ink-dim">brand_id</span><input className={inputCls} value={brandId} onChange={(e) => setBrandId(e.target.value)} placeholder="uuid" /></label>
      </div>

      {loading && !data ? (
        <AdminSkeleton variant="card" />
      ) : err ? (
        <AdminAlert tone="danger" title="조회 실패" description={err} action={<AdminButton size="sm" onClick={() => void load()}>재시도</AdminButton>} />
      ) : data ? (
        <div className="space-y-4">
          {/* Funnel */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <AdminStatCard label="Raw" value={String(f?.raw ?? 0)} />
            <AdminStatCard label="play_30s" value={String(f?.play_30s ?? 0)} tone="neutral" />
            <AdminStatCard label="Verified" value={String(f?.verified ?? 0)} tone="info" />
            <AdminStatCard label="Eligible" value={String(f?.eligible ?? 0)} tone="success" />
            <AdminStatCard label="Settlement Eligible" value={String(f?.settlement_eligible ?? 0)} tone="success" />
          </div>

          {/* v1 대비 차이 */}
          {diff && (
            <AdminCard title="v1 대비 차이 (Shadow Reconciliation)" subtitle="v2 settlement_eligible − v1 eligible_for_payout. 목표: v2 ≤ v1, 0~5% 정상.">
              <div className="flex flex-wrap items-center gap-3">
                <AdminStatCard label="v1 eligible" value={String(data.v1?.eligible_for_payout ?? 0)} />
                <AdminStatCard label="v2 settlement" value={String(f?.settlement_eligible ?? 0)} tone="info" />
                <AdminStatCard label="차이" value={String(diff.settlement_minus_v1)} tone={diff.settlement_minus_v1 > 0 ? 'warning' : 'neutral'} />
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-ink">{diff.rate_pct == null ? '—' : `${diff.rate_pct}%`}</span>
                  <AdminBadge tone={zoneTone(diff.zone)}>{diff.zone}</AdminBadge>
                </div>
              </div>
              <p className="mt-2 text-[11px] text-ink-dim">zone: normal(≤5%) · watch(≤15%) · investigate(&gt;15%). shadow 초기엔 데이터 부족으로 큰 차이가 정상입니다.</p>
            </AdminCard>
          )}

          {/* Health */}
          {health && (
            <AdminCard title={`Streaming Health Score — ${health.scope}`} subtitle="verified×40 + eligible×30 + heartbeat×20 + (1−fraud)×10. 관측 지표(정산 미반영).">
              <div className="mb-2 flex items-center gap-3">
                <Activity size={22} className={healthText(health.overall_health)} />
                <p className={`text-2xl font-extrabold ${healthText(health.overall_health)}`}>{health.overall_health}<span className="text-xs text-ink-dim"> / 100</span></p>
                <span className="text-[11px] text-ink-dim">play_30s {health.play_30s_count}건 기준</span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <AdminStatCard label="Verified Rate" value={pct(health.verified_rate)} />
                <AdminStatCard label="Eligible Rate" value={pct(health.eligible_rate)} />
                <AdminStatCard label="Heartbeat Rate" value={pct(health.heartbeat_success_rate)} />
                <AdminStatCard label="Fraud Rate" value={pct(health.fraud_rate)} tone={health.fraud_rate > 0 ? 'warning' : 'neutral'} />
                <AdminStatCard label="Rejected Rate" value={pct(health.rejected_rate)} tone={health.rejected_rate > 0.5 ? 'warning' : 'neutral'} />
              </div>
              {health.top_rejection_reasons && Object.keys(health.top_rejection_reasons).length > 0 && (
                <div className="mt-2"><p className="mb-1 text-[11px] font-semibold text-ink-dim">Top Rejection Reasons</p><BreakdownList data={health.top_rejection_reasons} emptyLabel="—" /></div>
              )}
            </AdminCard>
          )}

          <div className="grid gap-2 sm:grid-cols-2">
            <AdminStatCard label="Fraud Watch (score ≥ 60)" value={String(data.fraud_watch)} tone={data.fraud_watch > 0 ? 'warning' : 'neutral'} />
            <AdminStatCard label="Disputed" value={String(data.disputed)} tone={data.disputed > 0 ? 'warning' : 'neutral'} />
          </div>

          {/* Breakdown */}
          <div className="grid gap-3 sm:grid-cols-2">
            <AdminCard title="Rejected / Reason (play_30s)"><BreakdownList data={data.rejected_breakdown} emptyLabel="이벤트 없음" /></AdminCard>
            <AdminCard title="Player Type"><BreakdownList data={data.player_type_breakdown} emptyLabel="이벤트 없음" /></AdminCard>
          </div>

          {/* Reconciliation */}
          <AdminCard title="v1 vs v2 Reconciliation (일별 KST)" subtitle="정산 전환 판단 지표.">
            {data.reconciliation.length === 0 ? (
              <AdminEmpty icon={<Radio size={22} />} title="데이터 없음" description="shadow 기록이 아직 없습니다 (flag OFF 또는 트래픽 없음)." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="text-ink-dim"><tr>
                    <th className="px-2 py-1 text-left">일자</th>
                    <th className="px-2 py-1 text-right">v1 30s</th><th className="px-2 py-1 text-right">v1 elig</th>
                    <th className="px-2 py-1 text-right">v2 raw</th><th className="px-2 py-1 text-right">v2 verif</th>
                    <th className="px-2 py-1 text-right">v2 elig</th><th className="px-2 py-1 text-right">v2 settle</th>
                    <th className="px-2 py-1 text-right">Δ</th>
                  </tr></thead>
                  <tbody>
                    {data.reconciliation.map((r) => (
                      <tr key={r.day} className="border-t border-line/10">
                        <td className="px-2 py-1 whitespace-nowrap text-ink-mute">{r.day}</td>
                        <td className="px-2 py-1 text-right">{r.v1_milestone_30s}</td>
                        <td className="px-2 py-1 text-right">{r.v1_eligible}</td>
                        <td className="px-2 py-1 text-right">{r.v2_raw}</td>
                        <td className="px-2 py-1 text-right">{r.v2_verified}</td>
                        <td className="px-2 py-1 text-right">{r.v2_eligible}</td>
                        <td className="px-2 py-1 text-right font-semibold text-ink">{r.v2_settlement_eligible}</td>
                        <td className="px-2 py-1 text-right"><AdminBadge tone={r.diff_settlement_vs_v1 === 0 ? 'neutral' : Math.abs(r.diff_settlement_vs_v1) <= 2 ? 'info' : 'warning'}>{r.diff_settlement_vs_v1 > 0 ? '+' : ''}{r.diff_settlement_vs_v1}</AdminBadge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </AdminCard>
        </div>
      ) : null}

      {replayOpen && <ReplayModal onClose={() => setReplayOpen(false)} initialTrackId={trackId.trim()} />}
    </AdminSection>
  );
}

// ── Replay / Timeline ────────────────────────────────────────────────
function ReplayModal({ onClose, initialTrackId }: { onClose: () => void; initialTrackId: string }) {
  const [sessionToken, setSessionToken] = useState('');
  const [trackId, setTrackId] = useState(initialTrackId);
  const [events, setEvents] = useState<StreamV2ReplayEvent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    if (!sessionToken.trim() && !trackId.trim()) { setErr('session_token 또는 track_id 를 입력하세요.'); return; }
    setLoading(true); setErr(null);
    try { setEvents(await adminStreamV2Replay({ sessionToken: sessionToken.trim() || null, trackId: trackId.trim() || null, limit: 300 })); }
    catch (e) { setErr(e instanceof Error ? e.message : '조회 실패'); }
    finally { setLoading(false); }
  }

  const finalEligible = events?.filter((e) => e.event_type === 'play_30s').some((e) => e.eligible_snapshot);

  return (
    <AdminModal open onClose={onClose} title="Streaming Replay / Timeline" size="xl"
      footer={<AdminButton tone="neutral" variant="subtle" onClick={onClose}>닫기</AdminButton>}>
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <label className="block space-y-1"><span className="text-[11px] text-ink-dim">session_token</span><input className={inputCls} value={sessionToken} onChange={(e) => setSessionToken(e.target.value)} placeholder="세션 토큰" /></label>
          <label className="block space-y-1"><span className="text-[11px] text-ink-dim">track_id</span><input className={inputCls} value={trackId} onChange={(e) => setTrackId(e.target.value)} placeholder="uuid" /></label>
          <div className="flex items-end"><AdminButton size="sm" tone="primary" leftIcon={<Play size={13} />} disabled={loading} onClick={() => void run()}>{loading ? '조회 중…' : 'Replay'}</AdminButton></div>
        </div>
        {err && <AdminAlert tone="danger" title="오류" description={err} />}
        {events && (
          events.length === 0 ? <AdminEmpty title="이벤트 없음" description="해당 조건의 v2 이벤트가 없습니다." /> : (
            <>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-ink-dim">결과:</span>
                <AdminBadge tone={finalEligible ? 'success' : 'neutral'}>{finalEligible ? 'eligible=true' : 'eligible=false'}</AdminBadge>
                <span className="text-ink-dim">{events.length} events</span>
              </div>
              <div className="max-h-[55vh] overflow-y-auto">
                <table className="w-full text-[11px]">
                  <thead className="sticky top-0 bg-bg-card text-ink-dim"><tr>
                    <th className="px-2 py-1 text-left">시각</th><th className="px-2 py-1 text-left">event</th>
                    <th className="px-2 py-1 text-left">type</th><th className="px-2 py-1 text-right">verif_s</th>
                    <th className="px-2 py-1 text-left">hb</th><th className="px-2 py-1 text-right">vol</th>
                    <th className="px-2 py-1 text-left">vis</th><th className="px-2 py-1 text-left">eligible</th>
                    <th className="px-2 py-1 text-left">reason</th>
                  </tr></thead>
                  <tbody>
                    {events.map((e, i) => (
                      <tr key={i} className="border-t border-line/10">
                        <td className="px-2 py-1 whitespace-nowrap text-ink-dim">{fmtTime(e.created_at)}</td>
                        <td className="px-2 py-1 font-semibold text-ink">{e.event_type}</td>
                        <td className="px-2 py-1 text-ink-mute">{e.player_type}</td>
                        <td className="px-2 py-1 text-right">{e.verified_seconds ?? '—'}</td>
                        <td className="px-2 py-1">{e.heartbeat_verified ? '✓' : '—'}</td>
                        <td className="px-2 py-1 text-right">{e.player_muted ? 'mute' : (e.player_volume ?? '—')}</td>
                        <td className="px-2 py-1 text-ink-mute">{e.visibility_state ?? '—'}</td>
                        <td className="px-2 py-1">{e.event_type === 'play_30s' ? <AdminBadge tone={e.eligible_snapshot ? 'success' : 'neutral'}>{e.eligible_snapshot ? 'Y' : 'N'}</AdminBadge> : '—'}</td>
                        <td className="px-2 py-1 text-ink-dim">{e.ineligible_reason ?? (e.eligible_reason ?? '—')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )
        )}
      </div>
    </AdminModal>
  );
}

// ── helpers ──────────────────────────────────────────────────────────
function BreakdownList({ data, emptyLabel }: { data: Record<string, number>; emptyLabel: string }) {
  const entries = Object.entries(data ?? {}).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return <p className="text-xs text-ink-dim">{emptyLabel}</p>;
  return (
    <div className="space-y-1">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between border-b border-line/5 pb-1 text-xs">
          <span className="text-ink-mute">{k}</span><span className="font-semibold text-ink">{v}</span>
        </div>
      ))}
    </div>
  );
}
function zoneTone(zone: string): AdminToneName {
  return zone === 'normal' ? 'success' : zone === 'watch' ? 'warning' : zone === 'investigate' ? 'danger' : 'neutral';
}
function healthText(score: number): string {
  return score >= 80 ? 'text-ink' : score >= 50 ? 'text-ink-mute' : 'text-ink-dim';
}
function pct(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${Math.round(n * 1000) / 10}%`;
}
function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'medium' });
}
