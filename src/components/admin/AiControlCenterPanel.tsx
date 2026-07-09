// Phase ALGO-7A — 관리자 AI Control Center (Unified AI Operations Dashboard) 패널.
// ALGO-1~6 의 모든 AI Engine 을 하나의 화면에서 Overview·Health·Pipeline·Metrics·Incident·Timeline 으로 관측합니다.
// Shadow Only — Queue/Playback/Streaming/Settlement/Prediction/RL/Decision/Governance Runtime 에 어떠한 영향도 주지 않습니다.
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Play, Activity, GitBranch, Gauge, AlertTriangle, Clock } from 'lucide-react';
import { AdminSection, AdminCard, AdminButton, AdminBadge, AdminAlert, AdminEmpty, AdminSkeleton, AdminStatCard } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  adminGenerateAiHealth, adminGeneratePipelineStatus, adminGenerateAiIncidents, adminGenerateAiMetrics,
  adminAiControlOverview, type AiControlOverview,
} from '@/lib/aiControlApi';

const numf = (n: number | null | undefined) => (n == null ? '—' : Number(n).toFixed(1));
const ratf = (n: number | null | undefined) => (n == null ? '—' : `${(Number(n) * 100).toFixed(0)}%`);

const statusTone = (s: string | null | undefined): 'success' | 'warning' | 'danger' | 'info' | 'neutral' => {
  switch (s) {
    case 'READY': return 'success';
    case 'WARNING': return 'warning';
    case 'BLOCKED': return 'danger';
    case 'SHADOW': return 'info';
    default: return 'neutral';
  }
};
const prioTone = (p: string): 'danger' | 'warning' | 'info' | 'neutral' => {
  switch (p) {
    case 'Critical': return 'danger';
    case 'High': return 'warning';
    case 'Medium': return 'info';
    default: return 'neutral';
  }
};
const bandTone = (b: string | null | undefined): 'success' | 'warning' | 'danger' | 'neutral' => {
  switch (b) {
    case 'good': return 'success';
    case 'fair': return 'warning';
    case 'poor': return 'danger';
    default: return 'neutral';
  }
};

export default function AiControlCenterPanel() {
  const [overview, setOverview] = useState<AiControlOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setOverview(await adminAiControlOverview()); }
    catch (e) { setErr(e instanceof Error ? e.message : '조회 실패 (0442 미적용 시 정상 — apply 후 표시)'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // 통합 파이프라인: health(run 생성) → pipeline → incidents → metrics/timeline.
  async function runAll() {
    setBusy(true);
    try {
      const h = await adminGenerateAiHealth(30);
      await adminGeneratePipelineStatus(h.run_id);
      await adminGenerateAiIncidents(h.run_id);
      await adminGenerateAiMetrics(h.run_id);
      toast.success(`AI Control Center 갱신 — ${h.engines_total} engines / ready ${h.ready} / health ${numf(h.overall_health)}`);
      await load();
    } catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  const s = overview?.summary;
  const engines = overview?.engines ?? [];
  const pipeline = overview?.pipeline ?? [];
  const incidents = overview?.incidents ?? [];
  const metrics = overview?.metrics ?? [];
  const timeline = overview?.timeline ?? [];

  return (
    <AdminSection
      title="AI Control Center (ALGO-7A)"
      description="ALGO-1~6 에서 구축된 모든 AI Engine(Streaming/Settlement/Learning/Prediction/Exposure/Calibration/RL/Bandit/Ensemble/Decision/Observability/Governance)을 하나의 통합 운영센터에서 관찰·분석합니다. Engine Registry·Health·Pipeline Map·Incident·Metrics·Timeline. 실제 Runtime 에는 어떠한 영향도 주지 않습니다(Shadow Only)."
      action={
        <div className="flex flex-wrap items-center gap-2">
          <AdminButton size="sm" variant="subtle" tone="neutral" leftIcon={<RefreshCw size={14} />} onClick={() => void load()}>새로고침</AdminButton>
          <AdminButton size="sm" tone="primary" leftIcon={<Play size={13} />} disabled={busy} onClick={() => void runAll()}>Control Center 갱신</AdminButton>
        </div>
      }
    >
      <AdminAlert tone="info" className="mb-3" title="AI Music OS 통합 운영센터 — 관찰 전용"
        description="각 Engine 의 shadow 테이블 존재를 probe 하여 READY/WARNING/BLOCKED/SHADOW/UNKNOWN 으로 상태를 표기합니다. Streaming/Settlement 는 base 테이블에서 실 신호를 계산하고, 선행 Migration 이 미배포된 Engine 은 UNKNOWN 으로 정직하게 표시됩니다. 어떤 값도 실제 정산/재생/추천/추론에 반영되지 않습니다." />

      {loading && !overview ? (
        <AdminSkeleton variant="card" />
      ) : err ? (
        <AdminAlert tone="info" title="데이터 없음 / 미적용" description={err} action={<AdminButton size="sm" onClick={() => void load()}>재시도</AdminButton>} />
      ) : !overview?.has_data ? (
        <AdminEmpty icon={<Activity size={22} />} title="아직 Control Center run 이 없어요" description="상단 'Control Center 갱신'을 누르세요 (health → pipeline → incidents → metrics, 전부 Shadow)." />
      ) : (
        <div className="space-y-4">
          {/* Overview */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            <AdminStatCard label="Overall Health" value={numf(s?.overall_health)} tone={(s?.overall_health ?? 0) >= 80 ? 'success' : (s?.overall_health ?? 0) >= 50 ? 'warning' : 'danger'} icon={<Gauge size={13} />} />
            <AdminStatCard label="Engines" value={String(s?.engines_total ?? 0)} tone="info" />
            <AdminStatCard label="Ready" value={String(s?.engines_ready ?? 0)} tone="success" />
            <AdminStatCard label="Warning" value={String(s?.engines_warning ?? 0)} tone={(s?.engines_warning ?? 0) > 0 ? 'warning' : 'neutral'} />
            <AdminStatCard label="Unknown" value={String(s?.engines_unknown ?? 0)} tone="neutral" />
            <AdminStatCard label="Incidents" value={String(s?.incidents_total ?? 0)} tone={(s?.incidents_critical ?? 0) > 0 ? 'danger' : (s?.incidents_total ?? 0) > 0 ? 'warning' : 'neutral'} icon={<AlertTriangle size={13} />} />
          </div>
          {s?.headline && <p className="text-[11px] text-ink-dim">{s.headline}</p>}

          {/* Engine Registry (Health) */}
          <AdminCard title="AI Engine Registry & Health" subtitle="12 Engine · probe 기반 상태와 health score. Streaming/Settlement 는 실 신호, 미배포 Engine 은 UNKNOWN.">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {engines.map((e) => (
                <div key={e.key} className="rounded-lg border border-line/15 px-2.5 py-2 text-[11px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-ink">{e.name ?? e.key}</span>
                    <AdminBadge tone={statusTone(e.status)}>{e.status}</AdminBadge>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-ink-dim">
                    <span>health <span className="text-ink tabular-nums">{numf(e.health)}</span></span>
                    <span className="tabular-nums">rows {e.rows ?? 0}</span>
                  </div>
                  <p className="mt-0.5 truncate text-ink-dim" title={e.note ?? ''}>{e.note ?? '—'}</p>
                </div>
              ))}
            </div>
          </AdminCard>

          {/* Pipeline Map */}
          <AdminCard title="AI Pipeline Map" subtitle="Playback → Streaming → Verified → Settlement → Learning → Prediction → RL → Decision → Governance → Ready.">
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              {pipeline.map((st, i) => (
                <span key={st.key ?? st.order} className="flex items-center gap-1.5">
                  <span className="flex flex-col items-center gap-0.5 rounded-lg border border-line/15 px-2 py-1">
                    <span className="text-ink">{st.name}</span>
                    <AdminBadge tone={statusTone(st.status)}>{st.status}</AdminBadge>
                    <span className="text-ink-dim tabular-nums">h {numf(st.health)}{st.throughput != null ? ` · ${st.throughput}` : ''}</span>
                  </span>
                  {i < pipeline.length - 1 && <span className="text-ink-dim">→</span>}
                </span>
              ))}
            </div>
          </AdminCard>

          {/* Metrics + Incidents */}
          <div className="grid gap-3 lg:grid-cols-2">
            <AdminCard title="AI Metrics" subtitle="실시간 집계 — 산출 가능 지표는 값/band, 미배포 소스는 정직하게 n/a.">
              {metrics.length > 0 ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {metrics.map((m) => (
                    <div key={m.key} className="rounded-lg border border-line/15 px-2.5 py-1.5 text-[11px]">
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="text-ink-dim">{m.label}</span>
                        <AdminBadge tone={bandTone(m.band)}>{m.band ?? '—'}</AdminBadge>
                      </div>
                      <p className="mt-0.5 font-medium text-ink tabular-nums">{m.value == null ? 'n/a' : ratf(m.value)}</p>
                    </div>
                  ))}
                </div>
              ) : <AdminEmpty title="metric 없음" description="갱신을 실행하세요." />}
            </AdminCard>

            <AdminCard title="AI Incident Center" subtitle="Shadow Alerts · Regression · Verification Delay · Identity Mismatch · SLA — 우선순위별.">
              {incidents.length > 0 ? (
                <div className="space-y-1.5">
                  {incidents.map((inc, i) => (
                    <div key={inc.type + i} className="rounded-lg border border-line/15 px-2.5 py-1.5 text-[11px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-ink"><AlertTriangle size={11} className="text-ink-dim" />{inc.type}</span>
                        <span className="flex items-center gap-1.5">
                          <AdminBadge tone={prioTone(inc.priority)}>{inc.priority}</AdminBadge>
                          <span className="text-ink-dim tabular-nums">×{inc.count}</span>
                        </span>
                      </div>
                      {inc.summary && <p className="mt-0.5 text-ink-dim">{inc.summary}</p>}
                    </div>
                  ))}
                </div>
              ) : <AdminEmpty title="incident 없음" description="모든 Engine 정상 관측." />}
            </AdminCard>
          </div>

          {/* Timeline */}
          <AdminCard title="AI Timeline" subtitle="최근 Engine·Metric·Incident 이벤트.">
            {timeline.length > 0 ? (
              <div className="space-y-1">
                {timeline.map((t, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg border border-line/10 px-2.5 py-1 text-[11px]">
                    <Clock size={10} className="shrink-0 text-ink-dim" />
                    <AdminBadge tone={t.category === 'incident' ? 'warning' : t.category === 'metric' ? 'info' : 'neutral'}>{t.category ?? '—'}</AdminBadge>
                    <span className="flex-1 truncate text-ink">{t.event}</span>
                    {t.detail && <span className="shrink-0 truncate text-ink-dim">{t.detail}</span>}
                  </div>
                ))}
              </div>
            ) : <AdminEmpty icon={<GitBranch size={20} />} title="timeline 없음" description="갱신을 실행하세요." />}
          </AdminCard>
        </div>
      )}
    </AdminSection>
  );
}
