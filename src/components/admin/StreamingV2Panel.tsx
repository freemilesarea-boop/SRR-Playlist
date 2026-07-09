// Phase ALGO-2A — 관리자 Streaming v2 (Shadow) 패널.
// v2 shadow 파이프라인 관측 전용. 정산/차트 무관. flag OFF 기본.
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Radio } from 'lucide-react';
import { AdminSection, AdminCard, AdminButton, AdminBadge, AdminAlert, AdminEmpty, AdminSkeleton, AdminStatCard } from '@/components/admin/ui';
import { adminStreamV2Overview, type StreamV2Overview } from '@/lib/streamingV2Api';

const RANGES = [{ d: 1, label: '24h' }, { d: 7, label: '7d' }, { d: 30, label: '30d' }] as const;

export default function StreamingV2Panel() {
  const [days, setDays] = useState<number>(7);
  const [data, setData] = useState<StreamV2Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setData(await adminStreamV2Overview(days)); }
    catch (e) { setErr(e instanceof Error ? e.message : '조회 실패'); }
    finally { setLoading(false); }
  }, [days]);
  useEffect(() => { void load(); }, [load]);

  const f = data?.funnel;

  return (
    <AdminSection
      title="스트리밍 v2 (Shadow)"
      description="Streaming v2 shadow 파이프라인 관측 전용입니다. 정산·차트는 여전히 v1을 사용하며 이 데이터는 반영되지 않습니다. (ALGO-2A)"
      action={
        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-full bg-bg-card p-1 text-xs">
            {RANGES.map((r) => (
              <button key={r.d} onClick={() => setDays(r.d)}
                className={`rounded-full px-3 py-1 font-semibold transition ${days === r.d ? 'bg-accent text-black' : 'text-ink-mute hover:bg-bg-hover'}`}>{r.label}</button>
            ))}
          </div>
          <AdminButton size="sm" variant="subtle" tone="neutral" leftIcon={<RefreshCw size={14} />} onClick={() => void load()}>새로고침</AdminButton>
        </div>
      }
    >
      <AdminAlert tone="info" className="mb-3" title="Shadow Mode — 정산/차트 미반영"
        description="이 지표는 record_stream_event_v2 로 병행 기록된 shadow 데이터입니다. streaming_v2_shadow_enabled 플래그가 OFF면 신규 기록이 없습니다. 실제 정산 전환은 ALGO-3에서 검증 후 진행합니다." />

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

          <div className="grid gap-2 sm:grid-cols-2">
            <AdminStatCard label="Fraud Watch (score ≥ 60)" value={String(data.fraud_watch)} tone={data.fraud_watch > 0 ? 'warning' : 'neutral'} />
            <AdminStatCard label="Disputed" value={String(data.disputed)} tone={data.disputed > 0 ? 'warning' : 'neutral'} />
          </div>

          {/* Breakdown */}
          <div className="grid gap-3 sm:grid-cols-2">
            <AdminCard title="Rejected / Reason (play_30s)">
              <BreakdownList data={data.rejected_breakdown} emptyLabel="이벤트 없음" />
            </AdminCard>
            <AdminCard title="Player Type">
              <BreakdownList data={data.player_type_breakdown} emptyLabel="이벤트 없음" />
            </AdminCard>
          </div>

          {/* Reconciliation */}
          <AdminCard title="v1 vs v2 Reconciliation" subtitle="일별(KST) v1 milestone/eligible 대비 v2 파이프라인. 정산 전환 판단 지표.">
            {data.reconciliation.length === 0 ? (
              <AdminEmpty icon={<Radio size={22} />} title="데이터 없음" description="shadow 기록이 아직 없습니다 (flag OFF 또는 트래픽 없음)." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="text-ink-dim"><tr>
                    <th className="px-2 py-1 text-left">일자</th>
                    <th className="px-2 py-1 text-right">v1 30s</th><th className="px-2 py-1 text-right">v1 eligible</th>
                    <th className="px-2 py-1 text-right">v2 raw</th><th className="px-2 py-1 text-right">v2 verified</th>
                    <th className="px-2 py-1 text-right">v2 eligible</th><th className="px-2 py-1 text-right">v2 settle</th>
                    <th className="px-2 py-1 text-right">Δ(v2settle−v1elig)</th>
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
    </AdminSection>
  );
}

function BreakdownList({ data, emptyLabel }: { data: Record<string, number>; emptyLabel: string }) {
  const entries = Object.entries(data ?? {}).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return <p className="text-xs text-ink-dim">{emptyLabel}</p>;
  return (
    <div className="space-y-1">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between border-b border-line/5 pb-1 text-xs">
          <span className="text-ink-mute">{k}</span>
          <span className="font-semibold text-ink">{v}</span>
        </div>
      ))}
    </div>
  );
}
