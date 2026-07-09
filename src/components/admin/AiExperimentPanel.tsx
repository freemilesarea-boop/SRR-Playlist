// Phase ALGO-5A — 관리자 AI Experiment Engine & Model Registry (MLOps, Shadow) 패널.
// Model Registry · Champion/Challenger Shadow A/B · Promotion Gate · Rollback Plan · Audit Log 관측.
// 운영 미반영 — traffic_split 은 Shadow 계산 비율이며, Promotion 은 상태 판정만(자동 승격/적용 없음).
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, FlaskConical, Play, GitCompare, ShieldCheck, Boxes } from 'lucide-react';
import { AdminSection, AdminCard, AdminButton, AdminBadge, AdminAlert, AdminEmpty, AdminSkeleton, AdminStatCard } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  adminRegisterAiModel, adminCreateAiExperiment, adminRunAiExperiment, adminCompareAiExperiment,
  adminMarkExperimentCandidate, adminAiExperimentOverview,
  type AiExperimentOverview, type AiCompareResult, type AiExperimentSummary,
} from '@/lib/experimentApi';

const numf = (n: number | null | undefined) => (n == null ? '—' : Number(n).toFixed(3));

const stateTone = (s: string | null | undefined): 'success' | 'warning' | 'danger' | 'info' | 'neutral' => {
  switch (s) {
    case 'ready_for_promotion': return 'success';
    case 'ready_for_shadow_expansion': return 'info';
    case 'ready_for_review': return 'warning';
    case 'blocked_by_risk': return 'danger';
    case 'insufficient_data': return 'neutral';
    default: return 'neutral';
  }
};
const statusTone = (s: string | null | undefined): 'success' | 'warning' | 'danger' | 'info' | 'neutral' => {
  switch (s) {
    case 'candidate': return 'success';
    case 'completed': return 'info';
    case 'blocked': return 'danger';
    case 'running': return 'warning';
    default: return 'neutral';
  }
};

// Shadow 데모 metric 스냅샷 — champion(v1) 대비 challenger(v2) 가 전 지표 우위.
const CHAMPION_METRICS = {
  calibration_score: 0.80, expected_completion: 0.60, expected_skip: 0.35, expected_revenue: 0.50,
  risk_score: 0.15, prediction_accuracy: 0.70, ndcg: 0.50, mrr: 0.40, queue_overlap: 0.30,
  diversity_score: 0.60, freshness_score: 0.70, stability_score: 0.80,
};
const CHALLENGER_METRICS = {
  calibration_score: 0.85, expected_completion: 0.64, expected_skip: 0.28, expected_revenue: 0.55,
  risk_score: 0.12, prediction_accuracy: 0.75, ndcg: 0.55, mrr: 0.45, queue_overlap: 0.35,
  diversity_score: 0.62, freshness_score: 0.72, stability_score: 0.82,
};

export default function AiExperimentPanel() {
  const [overview, setOverview] = useState<AiExperimentOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<AiExperimentSummary | null>(null);
  const [compare, setCompare] = useState<AiCompareResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setOverview(await adminAiExperimentOverview()); }
    catch (e) { setErr(e instanceof Error ? e.message : '조회 실패 (0434 미적용 시 정상 — apply 후 표시)'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // 데모 실험 시드: prediction_model champion(v1)/challenger(v2) 등록 → 실험 생성.
  async function seedDemoExperiment() {
    setBusy(true);
    try {
      const champ = await adminRegisterAiModel({
        modelKey: 'prediction_model', modelType: 'prediction', version: 1, status: 'champion',
        parameters: { w_completion: 0.35, w_skip: 0.25 }, metrics: CHAMPION_METRICS,
      });
      const chall = await adminRegisterAiModel({
        modelKey: 'prediction_model', modelType: 'prediction', version: 2, status: 'challenger',
        parameters: { w_completion: 0.37, w_skip: 0.26 }, metrics: CHALLENGER_METRICS, parentVersion: 1,
      });
      await adminCreateAiExperiment({
        experimentKey: 'exp_prediction_v1_v2', name: 'Prediction v1 vs v2', modelType: 'prediction',
        championVersionId: champ.model_version_id, challengerVersionId: chall.model_version_id,
        trafficSplit: 0.5, evalWindow: 14, minSample: 30,
      });
      toast.success('데모 실험 시드 완료 — champion v1 / challenger v2 등록 · 실험 생성');
      await load();
    } catch (e) { toast.error(`시드 실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  async function runExperiment(exp: AiExperimentSummary) {
    setBusy(true);
    try {
      const r = await adminRunAiExperiment(exp.id, 100);
      toast.success(`Shadow A/B 실행 — 승자 ${r.winner} (challenger ${r.challenger_wins} : champion ${r.champion_wins})`);
      setSelected(exp);
      setCompare(await adminCompareAiExperiment(exp.id));
      await load();
    } catch (e) { toast.error(`실행 실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  async function showCompare(exp: AiExperimentSummary) {
    setBusy(true);
    try { setSelected(exp); setCompare(await adminCompareAiExperiment(exp.id)); }
    catch (e) { toast.error(`비교 실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  async function markCandidate(exp: AiExperimentSummary) {
    setBusy(true);
    try {
      const r = await adminMarkExperimentCandidate(exp.id);
      toast.success(`Promotion Gate 판정 — ${r.promotion_state}${r.rollback_plan_id ? ' · rollback plan 기록됨' : ''}`);
      await load();
    } catch (e) { toast.error(`판정 실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  const models = overview?.models ?? [];
  const experiments = overview?.experiments ?? [];
  const candidates = overview?.candidates ?? [];
  const audit = overview?.recent_audit ?? [];

  return (
    <AdminSection
      title="AI Experiments (Shadow MLOps)"
      description="ALGO-4 Shadow AI 모델을 버전 관리하고 Champion/Challenger Shadow A/B 로 비교·후보 판정하는 MLOps 레이어입니다. 실제 Queue/Playback/Scheduler/Exposure/Prediction/Settlement 에 반영하지 않습니다. (ALGO-5A)"
      action={
        <div className="flex flex-wrap items-center gap-2">
          <AdminButton size="sm" variant="subtle" tone="neutral" leftIcon={<RefreshCw size={14} />} onClick={() => void load()}>새로고침</AdminButton>
          <AdminButton size="sm" tone="primary" leftIcon={<FlaskConical size={13} />} disabled={busy} onClick={() => void seedDemoExperiment()}>데모 실험 시드</AdminButton>
        </div>
      }
    >
      <AdminAlert tone="info" className="mb-3" title="Shadow MLOps — 운영 미반영"
        description="traffic_split 은 실제 트래픽 분배가 아니라 Shadow 계산 비율입니다. Promotion Gate 는 상태 판정만 하며 자동 승격/적용은 없습니다: calibration ≥ champion+0.03, skip ≤ champion−0.05, completion ≥ champion+0.03, risk ≤ 0.2, sample ≥ min. 후보 판정 시 Rollback Plan 을 자동 기록합니다." />

      {loading && !overview ? (
        <AdminSkeleton variant="card" />
      ) : err ? (
        <AdminAlert tone="info" title="데이터 없음 / 미적용" description={err} action={<AdminButton size="sm" onClick={() => void load()}>재시도</AdminButton>} />
      ) : !overview?.has_data ? (
        <AdminEmpty icon={<FlaskConical size={22} />} title="아직 실험이 없어요" description="상단 '데모 실험 시드'를 눌러 champion/challenger 모델을 등록하고 Shadow A/B 실험을 만드세요." />
      ) : (
        <div className="space-y-4">
          {/* Overview stats */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <AdminStatCard label="Registered Models" value={String(models.length)} />
            <AdminStatCard label="Experiments" value={String(experiments.length)} tone="info" />
            <AdminStatCard label="Promotion Candidates" value={String(candidates.length)} tone={candidates.length > 0 ? 'success' : 'neutral'} />
            <AdminStatCard label="Rollback Plans" value={String(overview?.rollback_plans ?? 0)} tone="neutral" />
          </div>

          {/* Model Registry */}
          <AdminCard title="Model Registry" subtitle="버전 관리되는 AI 모델(metric 스냅샷). Champion = 현행 기준 버전.">
            {models.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="text-ink-dim"><tr>
                    <th className="px-2 py-1 text-left">model_key</th><th className="px-2 py-1 text-left">type</th>
                    <th className="px-2 py-1 text-right">versions</th><th className="px-2 py-1 text-right">champion</th>
                  </tr></thead>
                  <tbody>
                    {models.map((m) => (
                      <tr key={m.model_key} className="border-t border-line/10">
                        <td className="px-2 py-1 font-mono text-ink flex items-center gap-1.5"><Boxes size={12} className="text-ink-dim" />{m.model_key}</td>
                        <td className="px-2 py-1 text-ink-dim">{m.model_type}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{m.versions}</td>
                        <td className="px-2 py-1 text-right">{m.champion == null ? '—' : <AdminBadge tone="success">v{m.champion}</AdminBadge>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <AdminEmpty title="등록된 모델 없음" description="데모 실험 시드로 모델을 등록하세요." />}
          </AdminCard>

          {/* Experiments — Champion/Challenger + actions */}
          <AdminCard title="Active Experiments" subtitle="Champion vs Challenger Shadow A/B. Run → Compare → Promotion Gate 판정.">
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead className="text-ink-dim"><tr>
                  <th className="px-2 py-1 text-left">experiment</th><th className="px-2 py-1 text-center">champ→chall</th>
                  <th className="px-2 py-1 text-left">status</th><th className="px-2 py-1 text-left">winner</th>
                  <th className="px-2 py-1 text-left">promotion</th><th className="px-2 py-1 text-right">actions</th>
                </tr></thead>
                <tbody>
                  {experiments.map((e) => (
                    <tr key={e.id} className="border-t border-line/10">
                      <td className="px-2 py-1">
                        <div className="font-medium text-ink">{e.name ?? e.key}</div>
                        <div className="font-mono text-[10px] text-ink-dim">{e.key}</div>
                      </td>
                      <td className="px-2 py-1 text-center tabular-nums text-ink-dim">v{e.champion_v ?? '—'} → v{e.challenger_v ?? '—'}</td>
                      <td className="px-2 py-1"><AdminBadge tone={statusTone(e.status)}>{e.status ?? '—'}</AdminBadge></td>
                      <td className="px-2 py-1">{e.winner ? <AdminBadge tone={e.winner === 'challenger' ? 'info' : 'neutral'}>{e.winner}</AdminBadge> : <span className="text-ink-dim">—</span>}</td>
                      <td className="px-2 py-1">{e.promotion_state ? <AdminBadge tone={stateTone(e.promotion_state)}>{e.promotion_state}</AdminBadge> : <span className="text-ink-dim">—</span>}</td>
                      <td className="px-2 py-1">
                        <div className="flex items-center justify-end gap-1">
                          <AdminButton size="sm" variant="subtle" tone="primary" leftIcon={<Play size={11} />} disabled={busy} onClick={() => void runExperiment(e)}>Run</AdminButton>
                          <AdminButton size="sm" variant="ghost" tone="neutral" leftIcon={<GitCompare size={11} />} disabled={busy} onClick={() => void showCompare(e)}>Compare</AdminButton>
                          <AdminButton size="sm" variant="subtle" tone="success" leftIcon={<ShieldCheck size={11} />} disabled={busy} onClick={() => void markCandidate(e)}>Gate</AdminButton>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </AdminCard>

          {/* Shadow A/B result — per-metric compare of selected experiment */}
          {selected && compare?.has_data && (
            <AdminCard
              title={`Shadow A/B Results — ${selected.name ?? selected.key}`}
              subtitle={`winner: ${compare.winner ?? '—'} · champion(v${selected.champion_v ?? '—'}) vs challenger(v${selected.challenger_v ?? '—'}). 계산 비교만 — 실반영 없음.`}
            >
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="text-ink-dim"><tr>
                    <th className="px-2 py-1 text-left">metric</th><th className="px-2 py-1 text-left">dir</th>
                    <th className="px-2 py-1 text-right">champion</th><th className="px-2 py-1 text-right">challenger</th>
                    <th className="px-2 py-1 text-right">Δ</th><th className="px-2 py-1 text-left">better</th>
                  </tr></thead>
                  <tbody>
                    {(compare.metrics ?? []).map((m) => (
                      <tr key={m.metric} className="border-t border-line/10">
                        <td className="px-2 py-1 font-mono text-ink">{m.metric}</td>
                        <td className="px-2 py-1 text-ink-dim">{m.direction === 'lower' ? '↓ lower' : '↑ higher'}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{numf(m.champion)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{numf(m.challenger)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{numf(m.delta)}</td>
                        <td className="px-2 py-1">
                          <AdminBadge tone={m.better === 'challenger' ? 'info' : m.better === 'champion' ? 'neutral' : 'warning'}>{m.better}</AdminBadge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </AdminCard>
          )}

          {/* Promotion candidates + Audit log */}
          <div className="grid gap-3 lg:grid-cols-2">
            <AdminCard title="Promotion Candidates" subtitle="Promotion Gate 통과 대기 — 자동 승격 없음(상태만).">
              {candidates.length > 0 ? (
                <div className="space-y-1.5">
                  {candidates.map((c) => (
                    <div key={c.key} className="flex items-center justify-between rounded-lg border border-line/15 px-2.5 py-1.5">
                      <span className="font-mono text-[11px] text-ink">{c.key}</span>
                      <AdminBadge tone={stateTone(c.promotion_state)}>{c.promotion_state}</AdminBadge>
                    </div>
                  ))}
                </div>
              ) : <AdminEmpty title="후보 없음" description="실험 Run 후 Gate 판정을 실행하세요." />}
            </AdminCard>

            <AdminCard title="Audit Log" subtitle="모델 등록/실험/판정 감사 로그(최근 15건).">
              {audit.length > 0 ? (
                <div className="max-h-64 space-y-1 overflow-y-auto">
                  {audit.map((a, i) => (
                    <div key={a.action + a.at + i} className="flex items-center gap-2 text-[11px]">
                      <AdminBadge tone="neutral">{a.action}</AdminBadge>
                      <span className="text-ink-dim">{new Date(a.at).toLocaleString('ko-KR')}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-[11px] text-ink-dim">감사 로그가 없습니다.</p>}
            </AdminCard>
          </div>
        </div>
      )}
    </AdminSection>
  );
}
