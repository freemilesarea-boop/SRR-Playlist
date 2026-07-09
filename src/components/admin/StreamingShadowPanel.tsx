// Phase ALGO-2E — 관리자 Streaming Shadow Calibration & Verified Pipeline 패널.
// Verified Funnel · Identity Mapping · Completion · Drop Analysis · Verification Delay · Candidate Generation 관측.
// 운영 미반영 — 실제 stream_ingest_v2/stream_sessions_v2 이벤트/funnel/정산 수정 없이 후보만 계산합니다.
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Filter, Fingerprint, GitCompareArrows, AlertTriangle } from 'lucide-react';
import { AdminSection, AdminCard, AdminButton, AdminBadge, AdminAlert, AdminEmpty, AdminSkeleton, AdminStatCard } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  adminRunStreamShadowCalibration, adminGenerateIdentityMapping, adminGenerateVerifiedCandidates,
  adminGenerateFunnelSummary, adminStreamShadowOverview, type StreamShadowOverview,
} from '@/lib/streamShadowApi';

const numf = (n: number | null | undefined) => (n == null ? '—' : Number(n).toFixed(1));
const pctf = (n: number | null | undefined) => (n == null ? '—' : `${(Number(n) * 100).toFixed(0)}%`);

const dropTone = (r: string | null): 'warning' | 'danger' | 'neutral' | 'success' => {
  switch (r) {
    case 'verification_delay': return 'danger';
    case 'identity_mismatch': return 'danger';
    case 'heartbeat_missing': return 'warning';
    case 'no_session': return 'warning';
    case 'completion_missing': return 'warning';
    case 'preview_excluded': case 'track_not_settlement_eligible': case 'insufficient_verified_seconds': return 'neutral';
    default: return 'neutral';
  }
};

export default function StreamingShadowPanel() {
  const [overview, setOverview] = useState<StreamShadowOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setOverview(await adminStreamShadowOverview()); }
    catch (e) { setErr(e instanceof Error ? e.message : '조회 실패 (0441 미적용 시 정상 — apply 후 표시)'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // 전체 파이프라인: calibration → identity → candidates → funnel/drop report.
  async function runCalibration() {
    setBusy(true);
    try {
      const c = await adminRunStreamShadowCalibration(30);
      await adminGenerateIdentityMapping(c.run_id);
      await adminGenerateVerifiedCandidates(c.run_id);
      await adminGenerateFunnelSummary(c.run_id);
      toast.success(`Shadow Calibration 완료 — verified 현행 ${c.verified_actual} → candidate ${c.verified_candidate} (top: ${c.top_drop_reason ?? '—'})`);
      await load();
    } catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  const s = overview?.summary;
  const funnel = overview?.funnel;
  const identity = overview?.identity;
  const drops = overview?.drop_analysis ?? [];
  const cand = overview?.candidates ?? {};
  const items = overview?.items ?? [];

  return (
    <AdminSection
      title="Streaming Shadow Calibration (ALGO-2E)"
      description="ALGO-2D 모니터링에서 확인된 Shadow Funnel 병목(verified=0)을 Shadow 로 재현·보정합니다. play_30s milestone × session 조인으로 Verified/Eligible/Settlement/Learning/Prediction 후보를 계산하고 Identity Mapping·Completion·Drop 분석을 생성합니다. 실제 stream_ingest_v2/stream_sessions_v2 이벤트·funnel·정산은 수정하지 않습니다."
      action={
        <div className="flex flex-wrap items-center gap-2">
          <AdminButton size="sm" variant="subtle" tone="neutral" leftIcon={<RefreshCw size={14} />} onClick={() => void load()}>새로고침</AdminButton>
          <AdminButton size="sm" tone="primary" leftIcon={<Filter size={13} />} disabled={busy} onClick={() => void runCalibration()}>Calibration 실행</AdminButton>
        </div>
      }
    >
      <AdminAlert tone="info" className="mb-3" title="Shadow Calibration — 실제 이벤트/정산 미반영"
        description="근본원인 (a) 검증 타이밍: play_30s milestone 이 fire 시점 verified_seconds<30·heartbeat_verified=false 로 고정되고 session 이 이후 120~130s 확정해도 back-fill 안 됨. (b) 세션 정체성: session.player_type=USER 인데 milestone=ARTIST_PREVIEW 라벨. 본 Calibration 은 session 을 authoritative 로 삼아 후보를 재계산할 뿐 실제 데이터를 수정하지 않습니다." />

      {loading && !overview ? (
        <AdminSkeleton variant="card" />
      ) : err ? (
        <AdminAlert tone="info" title="데이터 없음 / 미적용" description={err} action={<AdminButton size="sm" onClick={() => void load()}>재시도</AdminButton>} />
      ) : !overview?.has_data ? (
        <AdminEmpty icon={<Filter size={22} />} title="아직 Calibration 이 없어요" description="상단 'Calibration 실행'을 누르세요 (identity → candidates → funnel/drop, 전부 Shadow)." />
      ) : (
        <div className="space-y-4">
          {/* Verified funnel: actual vs candidate */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <AdminStatCard label="Verified (현행)" value={String(s?.verified_actual ?? 0)} tone={(s?.verified_actual ?? 0) > 0 ? 'success' : 'danger'} />
            <AdminStatCard label="Verified (Candidate)" value={String(s?.verified_candidate ?? 0)} tone={(s?.verified_candidate ?? 0) > 0 ? 'success' : 'neutral'} icon={<GitCompareArrows size={13} />} />
            <AdminStatCard label="Eligible Candidate" value={String(s?.eligible_candidate ?? 0)} tone="info" />
            <AdminStatCard label="Settlement Candidate" value={String(s?.settlement_candidate ?? 0)} tone="info" />
          </div>

          {/* Funnel chain */}
          <AdminCard title="Verified Pipeline Funnel (Shadow Candidate)" subtitle="raw → play_30s → verified → eligible → settlement → learning → prediction. 후보 계산만.">
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              {([
                ['raw', funnel?.raw_events],
                ['play_30s', s?.play30s_count],
                ['verified', funnel?.verified_candidate],
                ['eligible', funnel?.eligible_candidate],
                ['settlement', funnel?.settlement_candidate],
                ['learning', funnel?.learning_candidate],
                ['prediction', funnel?.prediction_candidate],
              ] as Array<[string, number | undefined]>).map(([label, v], i, arr) => (
                <span key={label} className="flex items-center gap-1.5">
                  <span className="rounded-lg border border-line/15 px-2 py-1"><span className="text-ink-dim">{label}</span> <span className="font-medium text-ink tabular-nums">{v ?? 0}</span></span>
                  {i < arr.length - 1 && <span className="text-ink-dim">→</span>}
                </span>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-ink-dim">현행 verified <span className="text-ink">{funnel?.verified_events_actual ?? 0}</span> → calibrated candidate <span className="text-ink">{funnel?.verified_candidate ?? 0}</span> · conversion {pctf(funnel?.verified_conversion_rate)} · drop {pctf(funnel?.verified_drop_rate)}</p>
          </AdminCard>

          {/* Drop analysis + Identity */}
          <div className="grid gap-3 lg:grid-cols-2">
            <AdminCard title="Drop Reason Analysis" subtitle="현행 pipeline 이 drop 하는 사유 + 권고.">
              {drops.length > 0 ? (
                <div className="space-y-1.5">
                  {drops.map((d, i) => (
                    <div key={(d.reason ?? '') + i} className="rounded-lg border border-line/15 px-2.5 py-1.5 text-[11px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-ink"><AlertTriangle size={11} className="text-ink-dim" />{d.reason}</span>
                        <span className="flex items-center gap-1.5"><AdminBadge tone={dropTone(d.reason)}>{d.count} · {pctf(d.pct)}</AdminBadge></span>
                      </div>
                      <p className="mt-0.5 text-ink-dim">{d.recommendation}</p>
                    </div>
                  ))}
                </div>
              ) : <AdminEmpty title="drop 없음" description="calibration 을 실행하세요." />}
            </AdminCard>

            <AdminCard title="Identity Mapping" subtitle="session.player_type(authoritative) vs milestone.player_type.">
              <div className="mb-2 flex items-center gap-2 text-[11px]">
                <AdminBadge tone={(identity?.mismatches ?? 0) > 0 ? 'danger' : 'success'} icon={<Fingerprint size={10} />}>mismatch {identity?.mismatches ?? 0}</AdminBadge>
                {Object.entries(identity?.breakdown ?? {}).map(([k, v]) => <AdminBadge key={k} tone="neutral">{k}: {v}</AdminBadge>)}
              </div>
              {identity?.list && identity.list.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead className="text-ink-dim"><tr>
                      <th className="px-2 py-1 text-left">token</th><th className="px-2 py-1 text-left">session</th>
                      <th className="px-2 py-1 text-left">milestone</th><th className="px-2 py-1 text-left">→ true</th>
                    </tr></thead>
                    <tbody>
                      {identity.list.map((r, i) => (
                        <tr key={(r.token ?? '') + i} className="border-t border-line/10">
                          <td className="px-2 py-1 font-mono text-ink-dim">{r.token ?? '—'}</td>
                          <td className="px-2 py-1 text-ink">{r.session ?? '—'}</td>
                          <td className="px-2 py-1">{r.mismatch ? <AdminBadge tone="danger">{r.milestone}</AdminBadge> : <span className="text-ink-dim">{r.milestone ?? '—'}</span>}</td>
                          <td className="px-2 py-1 text-ink">{r.true ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="text-[11px] text-ink-dim">mapping 없음.</p>}
            </AdminCard>
          </div>

          {/* Candidate stage counts */}
          <AdminCard title="Candidate Generation (Stage)" subtitle="stage 별 shadow 후보 수.">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {['verified', 'eligible', 'settlement', 'learning', 'prediction'].map((st) => (
                <AdminStatCard key={st} label={st} value={String(cand[st] ?? 0)} tone={(cand[st] ?? 0) > 0 ? 'success' : 'neutral'} />
              ))}
            </div>
          </AdminCard>

          {/* Per-item detail: verification delay evidence */}
          <AdminCard title="Verification Delay 증거 (play_30s milestone × session)" subtitle="milestone verified_seconds vs session verified_seconds — back-fill 필요.">
            {items.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="text-ink-dim"><tr>
                    <th className="px-2 py-1 text-left">token</th><th className="px-2 py-1 text-left">true type</th>
                    <th className="px-2 py-1 text-right">m_vsec</th><th className="px-2 py-1 text-right">s_vsec</th>
                    <th className="px-2 py-1 text-right">hb</th><th className="px-2 py-1 text-center">verified</th>
                    <th className="px-2 py-1 text-center">→ cand</th><th className="px-2 py-1 text-left">drop</th>
                  </tr></thead>
                  <tbody>
                    {items.map((it, i) => (
                      <tr key={(it.token ?? '') + i} className="border-t border-line/10">
                        <td className="px-2 py-1 font-mono text-ink-dim">{it.token ?? '—'}</td>
                        <td className="px-2 py-1 text-ink">{it.true_ptype ?? '—'}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-ink-dim">{numf(it.m_vsec)}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-ink">{numf(it.s_vsec)}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-ink-dim">{it.hb ?? 0}</td>
                        <td className="px-2 py-1 text-center">{it.actual_verified ? <span className="text-accent">✓</span> : <span className="text-ink-dim">✗</span>}</td>
                        <td className="px-2 py-1 text-center">{it.verified_cand ? <AdminBadge tone="success">verified</AdminBadge> : <span className="text-ink-dim">—</span>}</td>
                        <td className="px-2 py-1">{it.drop_reason ? <AdminBadge tone={dropTone(it.drop_reason)}>{it.drop_reason}</AdminBadge> : <span className="text-ink-dim">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <AdminEmpty title="item 없음" description="calibration 을 실행하세요." />}
          </AdminCard>
        </div>
      )}
    </AdminSection>
  );
}
