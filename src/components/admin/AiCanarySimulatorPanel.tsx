// Phase ALGO-7D — 관리자 AI Canary Readiness Simulator (Shadow) 패널 — Canary Simulation Layer.
// Traffic Plan · Impact Predictor · Safety Gate · Rollback Trigger Simulation · Canary Timeline · Certificate.
// Shadow Only — 실제 Canary/Release/Rollback/Queue/Playback/Scheduler/Streaming 에 어떠한 영향도 주지 않습니다.
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Play, Rocket, TrendingUp, ShieldCheck, Undo2, Award, Clock } from 'lucide-react';
import { AdminSection, AdminCard, AdminButton, AdminBadge, AdminAlert, AdminEmpty, AdminSkeleton, AdminStatCard } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  adminGenerateCanaryPlan, adminGenerateCanaryImpact, adminRunCanarySimulation,
  adminGenerateCanaryCertificate, adminAiCanaryOverview, type CanaryOverview,
} from '@/lib/canaryApi';

const numf = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString());
const dec = (n: number | null | undefined) => (n == null ? '—' : Number(n).toFixed(3));
const gateTone = (s: string | null | undefined): 'success' | 'warning' | 'danger' | 'neutral' => {
  switch (s) {
    case 'pass': return 'success';
    case 'governance_blocked': return 'warning';
    case 'threshold_blocked': return 'danger';
    default: return 'neutral';
  }
};
const riskTone = (r: string | null | undefined): 'success' | 'warning' | 'danger' | 'neutral' => {
  switch (r) { case 'critical': case 'high': return 'danger'; case 'medium': return 'warning'; case 'low': return 'success'; default: return 'neutral'; }
};
const boolBadge = (b: boolean) => (b ? <AdminBadge tone="success">pass</AdminBadge> : <AdminBadge tone="danger">fail</AdminBadge>);
const METRIC_ORDER = ['verified', 'eligible', 'settlement', 'reward', 'prediction', 'risk', 'confidence', 'decision', 'drift'];

export default function AiCanarySimulatorPanel() {
  const [ov, setOv] = useState<CanaryOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setOv(await adminAiCanaryOverview()); }
    catch (e) { setErr(e instanceof Error ? e.message : '조회 실패 (0445 미적용 시 정상 — apply 후 표시)'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // Canary 시뮬레이션 파이프라인: plan → impact → simulation(gate+rollback) → certificate.
  async function runAll() {
    setBusy(true);
    try {
      const p = await adminGenerateCanaryPlan(30);
      await adminGenerateCanaryImpact(p.run_id);
      await adminRunCanarySimulation(p.run_id);
      const c = await adminGenerateCanaryCertificate(p.run_id);
      toast.success(`Canary 시뮬레이션 완료 — max_safe ${c.max_safe_stage}% · overall ${c.overall_gate} (Shadow, 실제 canary 없음)`);
      await load();
    } catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  const p = ov?.plan;
  const sims = ov?.simulations ?? [];
  const impacts = ov?.impacts ?? [];
  const gates = ov?.gates ?? [];
  const rollbacks = ov?.rollback_sims ?? [];
  const cert = ov?.certificate;
  const timeline = ov?.timeline ?? [];
  const stages = sims.map((s) => s.stage);
  // impact pivot: metric x stage
  const impactByMetric = new Map<string, Map<number, number | null>>();
  for (const im of impacts) {
    if (!impactByMetric.has(im.metric)) impactByMetric.set(im.metric, new Map());
    impactByMetric.get(im.metric)!.set(im.stage, im.predicted);
  }

  return (
    <AdminSection
      title="AI Canary Readiness Simulator (ALGO-7D)"
      description="AI Music OS 의 Canary Simulation Layer — ALGO-7C Release Governance 결과를 기반으로 1/5/10/25/50/100% Canary 배포를 완전히 Shadow 로 시뮬레이션합니다. Traffic Planner·Impact Predictor·Safety Gate·Rollback Trigger Simulation·Timeline·Certificate. 실제 Canary/Release/Rollback/Queue/Playback/Scheduler/Streaming 에는 어떠한 영향도 주지 않습니다."
      action={
        <div className="flex flex-wrap items-center gap-2">
          <AdminButton size="sm" variant="subtle" tone="neutral" leftIcon={<RefreshCw size={14} />} onClick={() => void load()}>새로고침</AdminButton>
          <AdminButton size="sm" tone="primary" leftIcon={<Play size={13} />} disabled={busy} onClick={() => void runAll()}>Canary 시뮬레이션 실행</AdminButton>
        </div>
      }
    >
      <AdminAlert tone="info" className="mb-3" title="Canary Simulation — 계산 전용 (Shadow Only)"
        description="stage별 예상 traffic(store/listener/track/event), impact(verified/eligible/settlement/reward/prediction/risk/confidence/decision/drift), safety gate(risk/drift/confidence/sla + governance/approval/policy/rollback), rollback trigger 조건을 모두 결정론적 shadow 추정으로 계산합니다. 어떤 stage 도 실제 배포되지 않으며, governance/approval 미이행 시 gate 는 blocked 로 정직하게 표시됩니다." />

      {loading && !ov ? (
        <AdminSkeleton variant="card" />
      ) : err ? (
        <AdminAlert tone="info" title="데이터 없음 / 미적용" description={err} action={<AdminButton size="sm" onClick={() => void load()}>재시도</AdminButton>} />
      ) : !ov?.has_data ? (
        <AdminEmpty icon={<Rocket size={22} />} title="아직 Canary 시뮬레이션이 없어요" description="상단 'Canary 시뮬레이션 실행'을 누르세요 (plan → impact → gate/rollback → certificate, 전부 Shadow)." />
      ) : (
        <div className="space-y-4">
          {/* Traffic Plan + Certificate summary */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            <AdminStatCard label="Stores" value={numf(p?.store_count)} tone="info" />
            <AdminStatCard label="Listeners" value={numf(p?.listener_count)} tone="info" />
            <AdminStatCard label="Tracks" value={numf(p?.track_count)} tone="info" />
            <AdminStatCard label="Expected Events" value={numf(p?.expected_events)} tone="info" />
            <AdminStatCard label="Max Safe Stage" value={cert?.max_safe_stage != null ? `${cert.max_safe_stage}%` : '—'} tone={(cert?.max_safe_stage ?? 0) >= 50 ? 'success' : 'warning'} icon={<Rocket size={13} />} />
            <AdminStatCard label="Overall Gate" value={cert?.overall_gate ?? '—'} tone={gateTone(cert?.overall_gate)} icon={<ShieldCheck size={13} />} />
          </div>
          {p?.headline && <p className="text-[11px] text-ink-dim">{p.headline} · overall risk <span className="text-ink">{cert?.overall_risk ?? '—'}</span> · rollback 조건 {cert?.rollback_conditions ?? 0} · cert <span className="font-mono">{cert?.hash ?? '—'}</span></p>}

          {/* Simulation traffic per stage */}
          <AdminCard title="Traffic Simulation (per stage)" subtitle="1/5/10/25/50/100% shadow traffic + gate 결과.">
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead className="text-ink-dim"><tr>
                  <th className="px-2 py-1 text-left">stage</th><th className="px-2 py-1 text-right">events</th>
                  <th className="px-2 py-1 text-right">listeners</th><th className="px-2 py-1 text-right">tracks</th>
                  <th className="px-2 py-1 text-left">gate</th><th className="px-2 py-1 text-center">rollback?</th>
                </tr></thead>
                <tbody>
                  {sims.map((sm) => (
                    <tr key={sm.stage} className="border-t border-line/10">
                      <td className="px-2 py-1 text-ink">{sm.stage}%</td>
                      <td className="px-2 py-1 text-right tabular-nums text-ink">{numf(sm.events)}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-ink-dim">{numf(sm.listeners)}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-ink-dim">{numf(sm.tracks)}</td>
                      <td className="px-2 py-1"><AdminBadge tone={gateTone(sm.gate)}>{sm.gate ?? '—'}</AdminBadge></td>
                      <td className="px-2 py-1 text-center">{sm.rollback ? <AdminBadge tone="danger">would rollback</AdminBadge> : <span className="text-ink-dim">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </AdminCard>

          {/* Impact Predictor matrix */}
          <AdminCard title="Impact Predictor" subtitle="metric × stage 예상 변화 (volume=scaled 후보, quality=shadow 추정).">
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead className="text-ink-dim"><tr>
                  <th className="px-2 py-1 text-left">metric</th>
                  {stages.map((st) => <th key={st} className="px-2 py-1 text-right">{st}%</th>)}
                </tr></thead>
                <tbody>
                  {METRIC_ORDER.filter((m) => impactByMetric.has(m)).map((m) => (
                    <tr key={m} className="border-t border-line/10">
                      <td className="px-2 py-1 text-ink">{m}</td>
                      {stages.map((st) => (
                        <td key={st} className="px-2 py-1 text-right tabular-nums text-ink-dim">
                          {(() => { const v = impactByMetric.get(m)!.get(st); return v == null ? '—' : (m === 'verified' || m === 'eligible' || m === 'settlement' ? numf(v) : dec(v)); })()}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-1.5 flex items-center gap-1 text-[11px] text-ink-dim"><TrendingUp size={11} /> risk/drift 은 traffic 비율에 따라 상승, confidence/prediction 은 하락하도록 결정론적으로 모델링.</p>
          </AdminCard>

          {/* Safety Gate */}
          <AdminCard title="Safety Gate" subtitle="risk/drift/confidence/sla 임계 + governance/approval/policy/rollback gate.">
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead className="text-ink-dim"><tr>
                  <th className="px-2 py-1 text-left">stage</th><th className="px-2 py-1 text-center">risk</th>
                  <th className="px-2 py-1 text-center">drift</th><th className="px-2 py-1 text-center">conf</th>
                  <th className="px-2 py-1 text-center">sla</th><th className="px-2 py-1 text-center">gov</th>
                  <th className="px-2 py-1 text-center">appr</th><th className="px-2 py-1 text-center">policy</th>
                  <th className="px-2 py-1 text-left">state</th>
                </tr></thead>
                <tbody>
                  {gates.map((g) => (
                    <tr key={g.stage} className="border-t border-line/10">
                      <td className="px-2 py-1 text-ink">{g.stage}%</td>
                      <td className="px-2 py-1 text-center">{boolBadge(g.risk)}</td>
                      <td className="px-2 py-1 text-center">{boolBadge(g.drift)}</td>
                      <td className="px-2 py-1 text-center">{boolBadge(g.confidence)}</td>
                      <td className="px-2 py-1 text-center">{boolBadge(g.sla)}</td>
                      <td className="px-2 py-1 text-center text-ink-dim">{g.governance ?? '—'}</td>
                      <td className="px-2 py-1 text-center text-ink-dim">{g.approval ?? '—'}</td>
                      <td className="px-2 py-1 text-center text-ink-dim">{g.policy ?? '—'}</td>
                      <td className="px-2 py-1"><AdminBadge tone={gateTone(g.state)}>{g.state ?? '—'}</AdminBadge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </AdminCard>

          {/* Rollback Trigger Simulation */}
          <AdminCard title="Rollback Trigger Simulation" subtitle="조건별 stage 에서 rollback 이 트리거되었을지 — Simulation Only.">
            {rollbacks.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="text-ink-dim"><tr>
                    <th className="px-2 py-1 text-left">condition</th>
                    {stages.map((st) => <th key={st} className="px-2 py-1 text-center">{st}%</th>)}
                  </tr></thead>
                  <tbody>
                    {['risk_spike', 'critical_incident', 'prediction_collapse', 'drift_explosion', 'confidence_collapse'].map((cond) => (
                      <tr key={cond} className="border-t border-line/10">
                        <td className="px-2 py-1 flex items-center gap-1.5 text-ink"><Undo2 size={11} className="text-ink-dim" />{cond}</td>
                        {stages.map((st) => {
                          const row = rollbacks.find((r) => r.condition === cond && r.stage === st);
                          return <td key={st} className="px-2 py-1 text-center">{row?.triggered ? <AdminBadge tone="danger">trigger</AdminBadge> : <span className="text-ink-dim">·</span>}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <AdminEmpty title="rollback sim 없음" description="시뮬레이션을 실행하세요." />}
          </AdminCard>

          {/* Certificate + Timeline */}
          <div className="grid gap-3 lg:grid-cols-2">
            <AdminCard title="Canary Certificate (Shadow — 실제 배포 효력 없음)" subtitle="max safe stage · overall gate · risk · certificate hash.">
              {cert ? (
                <div className="space-y-1.5 text-[11px]">
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-line/15 px-2.5 py-1.5">
                    <span className="flex items-center gap-1.5 text-ink"><Award size={12} className="text-ink-dim" />Max Safe Stage</span>
                    <AdminBadge tone={(cert.max_safe_stage ?? 0) >= 50 ? 'success' : 'warning'}>{cert.max_safe_stage ?? 0}%</AdminBadge>
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-line/15 px-2.5 py-1.5">
                    <span className="text-ink">Overall Gate</span><AdminBadge tone={gateTone(cert.overall_gate)}>{cert.overall_gate ?? '—'}</AdminBadge>
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-line/15 px-2.5 py-1.5">
                    <span className="text-ink">Overall Risk</span><AdminBadge tone={riskTone(cert.overall_risk)}>{cert.overall_risk ?? '—'}</AdminBadge>
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-line/15 px-2.5 py-1.5">
                    <span className="text-ink">Rollback 조건 수</span><span className="tabular-nums text-ink-dim">{cert.rollback_conditions ?? 0}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-line/15 px-2.5 py-1.5">
                    <span className="text-ink">Certificate Hash</span><span className="font-mono text-ink-dim">{cert.hash ?? '—'}</span>
                  </div>
                </div>
              ) : <AdminEmpty title="certificate 없음" description="시뮬레이션을 실행하세요." />}
            </AdminCard>

            <AdminCard title="Canary Timeline (Append Only)" subtitle="plan → simulation → certificate 기록 — 수정/삭제 불가.">
              {timeline.length > 0 ? (
                <div className="space-y-1">
                  {timeline.map((t, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-lg border border-line/10 px-2.5 py-1 text-[11px]">
                      <Clock size={10} className="shrink-0 text-ink-dim" />
                      <AdminBadge tone="neutral">{t.category ?? '—'}</AdminBadge>
                      <span className="flex-1 truncate text-ink">{t.event}</span>
                      {t.detail && <span className="shrink-0 truncate text-ink-dim">{t.detail}</span>}
                    </div>
                  ))}
                </div>
              ) : <AdminEmpty title="timeline 없음" description="시뮬레이션을 실행하세요." />}
            </AdminCard>
          </div>
        </div>
      )}
    </AdminSection>
  );
}
