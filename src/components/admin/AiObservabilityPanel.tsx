// Phase ALGO-6D — 관리자 AI Observability (Continuous Shadow Observability Scheduler) 패널.
// Schedules · Manual Run · Run Chain · Snapshots · Stability Streak · SLA · Digest · Backfill Plan 관측.
// 운영 미반영 — 실제 cron 비활성(enabled=false), 자동 승인/자동 Canary/발송 없음. 장기 안정성 근거만 축적.
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, CalendarClock, Play, Gauge, ListChecks, FileText, Layers } from 'lucide-react';
import { AdminSection, AdminCard, AdminButton, AdminBadge, AdminAlert, AdminEmpty, AdminSkeleton, AdminStatCard } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  adminCreateObservabilitySchedule, adminRunObservabilitySnapshot, adminCalculateStabilityStreak,
  adminEvaluateObservabilitySla, adminGenerateObservabilityDigest, adminAiObservabilityOverview,
  type ObservabilityOverview, type ObsSlaCheck,
} from '@/lib/observabilityApi';

const numf = (n: number | null | undefined) => (n == null ? '—' : Number(n).toFixed(3));

const slaTone = (s: string | null | undefined): 'success' | 'warning' | 'danger' | 'neutral' => {
  switch (s) {
    case 'sla_pass': return 'success';
    case 'sla_warning': return 'warning';
    case 'sla_fail': return 'danger';
    default: return 'neutral';
  }
};
const readinessTone = (s: string | null | undefined): 'success' | 'warning' | 'danger' | 'info' | 'neutral' => {
  switch (s) {
    case 'ready_for_limited_canary': return 'success';
    case 'ready_for_review': return 'info';
    case 'stable_shadow': return 'info';
    case 'needs_more_data': return 'warning';
    case 'not_ready': return 'danger';
    default: return 'neutral';
  }
};

const SLA_LABELS: Array<[string, string]> = [
  ['min_accuracy', 'accuracy ≥ 0.75'],
  ['max_risk', 'risk ≤ 0.20'],
  ['max_drift', 'drift ≤ 0.15'],
  ['min_sample_size', 'sample ≥ 100'],
  ['min_consecutive_stable_days', 'stable days ≥ 30'],
  ['min_consecutive_stable_months', 'stable months ≥ 3'],
  ['critical_alerts_zero', 'critical = 0'],
];

export default function AiObservabilityPanel() {
  const [overview, setOverview] = useState<ObservabilityOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setOverview(await adminAiObservabilityOverview()); }
    catch (e) { setErr(e instanceof Error ? e.message : '조회 실패 (0439 미적용 시 정상 — apply 후 표시)'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // 수동 shadow run: schedule 정의(없으면) → snapshot → streak → SLA → digest.
  async function runManual() {
    setBusy(true);
    try {
      await adminCreateObservabilitySchedule('manual_shadow_obs', 'manual_shadow_observability', '수동 shadow 관측');
      const run = await adminRunObservabilitySnapshot(null, 'manual_shadow_observability', 120);
      await adminCalculateStabilityStreak(run.run_id);
      const sla = await adminEvaluateObservabilitySla(run.run_id, null);
      await adminGenerateObservabilityDigest('daily_digest', run.run_id);
      toast.success(`Shadow run 완료 — accuracy ${numf(run.accuracy)} · SLA ${sla.sla_status}`);
      await load();
    } catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  const snap = overview?.snapshot;
  const streak = overview?.streak;
  const sla = overview?.sla_result;
  const schedules = overview?.schedules ?? [];
  const steps = overview?.run_steps ?? [];
  const digests = overview?.digests ?? [];
  const backfills = overview?.backfill_plans ?? [];

  return (
    <AdminSection
      title="AI Observability (Continuous, Shadow)"
      description="ALGO-6B/6C 의 Feedback·Drift·Trend 를 실제 시간축으로 지속 누적하는 Continuous Shadow Observability 레이어입니다. Schedule·Snapshot·Stability Streak·SLA·Digest·Backfill 을 산출하며, 실제 cron 은 비활성(enabled=false)이고 자동 승인/자동 Canary/발송/운영 반영이 없습니다. (ALGO-6D)"
      action={
        <div className="flex flex-wrap items-center gap-2">
          <AdminButton size="sm" variant="subtle" tone="neutral" leftIcon={<RefreshCw size={14} />} onClick={() => void load()}>새로고침</AdminButton>
          <AdminButton size="sm" tone="primary" leftIcon={<Play size={13} />} disabled={busy} onClick={() => void runManual()}>수동 Shadow Run</AdminButton>
        </div>
      }
    >
      <AdminAlert tone="info" className="mb-3" title="Continuous Shadow Observability — 실제 cron 비활성"
        description="스케줄은 정의만 하고 실제 자동 실행하지 않습니다(enabled=false). Run Chain 9단계는 계획이며 기존 RPC 를 변경/직접 호출하지 않습니다. Shadow SLA 는 운영 전환 요구 조건을 판정만 하고(sla_pass/warning/fail/insufficient_data), Digest 는 생성만 하며 발송/자동조치가 없습니다. 장기 안정성이 입증될 때까지 관측·분석 목적으로만 사용됩니다." />

      {loading && !overview ? (
        <AdminSkeleton variant="card" />
      ) : err ? (
        <AdminAlert tone="info" title="데이터 없음 / 미적용" description={err} action={<AdminButton size="sm" onClick={() => void load()}>재시도</AdminButton>} />
      ) : !overview?.has_data ? (
        <AdminEmpty icon={<CalendarClock size={22} />} title="아직 Observability run 이 없어요" description="상단 '수동 Shadow Run'을 누르세요 (Snapshot → Streak → SLA → Digest, 전부 Shadow)." />
      ) : (
        <div className="space-y-4">
          {/* Snapshot stats */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <AdminStatCard label="Accuracy" value={numf(snap?.accuracy)} tone={((snap?.accuracy ?? 0) >= 0.75) ? 'success' : 'warning'} />
            <AdminStatCard label="Risk" value={numf(snap?.risk)} tone={((snap?.risk ?? 1) <= 0.20) ? 'success' : 'warning'} />
            <AdminStatCard label="SLA" value={sla?.sla_status ?? '—'} tone={slaTone(sla?.sla_status)} />
            <AdminStatCard label="Readiness" value={snap?.readiness_state ?? '—'} tone={readinessTone(snap?.readiness_state)} />
          </div>

          {/* Stability streak */}
          <AdminCard title="Stability Streak (실제 시간축)" subtitle="연속 안정 일/주/월 누적. SLA 근거.">
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              <AdminStatCard label="Consec Days" value={String(streak?.consecutive_stable_days ?? 0)} tone={(streak?.consecutive_stable_days ?? 0) >= 30 ? 'success' : 'warning'} />
              <AdminStatCard label="Consec Weeks" value={String(streak?.consecutive_stable_weeks ?? 0)} tone="neutral" />
              <AdminStatCard label="Consec Months" value={String(streak?.consecutive_stable_months ?? 0)} tone={(streak?.consecutive_stable_months ?? 0) >= 3 ? 'success' : 'warning'} />
              <AdminStatCard label="Stable 7d" value={String(streak?.stable_7d_count ?? 0)} tone="info" />
              <AdminStatCard label="Stable 30d" value={String(streak?.stable_30d_count ?? 0)} tone="info" />
              <AdminStatCard label="Stable 90d" value={String(streak?.stable_90d_count ?? 0)} tone="info" />
            </div>
          </AdminCard>

          {/* SLA gate + Run chain */}
          <div className="grid gap-3 lg:grid-cols-2">
            <AdminCard title="Shadow SLA Gate" subtitle="운영 전환 요구 조건 — 판정만, 실제 적용 없음.">
              {sla ? (
                <>
                  <div className="mb-2 flex items-center gap-2">
                    <AdminBadge tone={slaTone(sla.sla_status)} icon={<Gauge size={10} />}>{sla.sla_status}</AdminBadge>
                    <span className="text-[11px] text-ink-dim">{typeof sla.checks?.passed === 'number' ? `${sla.checks.passed}/${sla.checks.total} 통과` : ''}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {SLA_LABELS.map(([key, label]) => {
                      const c = sla.checks?.[key] as ObsSlaCheck | undefined;
                      const pass = c?.pass;
                      return <AdminBadge key={key} tone={pass ? 'success' : 'neutral'}>{pass ? '✓' : '✗'} {label}</AdminBadge>;
                    })}
                  </div>
                </>
              ) : <p className="text-[11px] text-ink-dim">SLA 결과 없음.</p>}
            </AdminCard>

            <AdminCard title="Run Chain (계획)" subtitle="9단계 — 기존 RPC 미변경/미호출.">
              {steps.length > 0 ? (
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {steps.map((s) => (
                    <div key={s.order} className="flex items-center justify-between gap-2 rounded-lg border border-line/15 px-2.5 py-1 text-[11px]">
                      <span className="flex items-center gap-1.5 text-ink"><ListChecks size={11} className="text-ink-dim" />{s.order}. {s.step}</span>
                      <AdminBadge tone="neutral">{s.status}</AdminBadge>
                    </div>
                  ))}
                </div>
              ) : <p className="text-[11px] text-ink-dim">run step 없음.</p>}
            </AdminCard>
          </div>

          {/* Schedules + Backfill + Digest */}
          <div className="grid gap-3 lg:grid-cols-3">
            <AdminCard title="Schedules" subtitle="정의만 — 실제 cron 비활성.">
              {schedules.length > 0 ? (
                <div className="space-y-1.5">
                  {schedules.map((s) => (
                    <div key={s.key} className="flex items-center justify-between gap-2 rounded-lg border border-line/15 px-2.5 py-1.5 text-[11px]">
                      <span className="flex items-center gap-1.5 text-ink"><CalendarClock size={11} className="text-ink-dim" />{s.key}</span>
                      <AdminBadge tone={s.enabled ? 'danger' : 'success'}>{s.enabled ? 'ENABLED' : 'shadow'}</AdminBadge>
                    </div>
                  ))}
                </div>
              ) : <AdminEmpty title="schedule 없음" description="run 시 자동 생성." />}
            </AdminCard>

            <AdminCard title="Backfill Plans" subtitle="과거 관측 계획 — 실행/데이터 수정 없음.">
              {backfills.length > 0 ? (
                <div className="space-y-1.5">
                  {backfills.map((b, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 rounded-lg border border-line/15 px-2.5 py-1.5 text-[11px]">
                      <span className="flex items-center gap-1.5 text-ink"><Layers size={11} className="text-ink-dim" />{b.from} → {b.to}</span>
                      <span className="flex items-center gap-1.5"><span className="text-ink-dim">{b.planned_runs} runs</span><AdminBadge tone="neutral">{b.status}</AdminBadge></span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-[11px] text-ink-dim">backfill plan 없음.</p>}
            </AdminCard>

            <AdminCard title="Alert Digests" subtitle="생성만 — 발송/자동조치 없음.">
              {digests.length > 0 ? (
                <div className="space-y-1.5">
                  {digests.map((d, i) => (
                    <div key={d.type + i} className="rounded-lg border border-line/15 px-2.5 py-1.5 text-[11px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-ink"><FileText size={11} className="text-ink-dim" />{d.type}</span>
                        <span className="flex items-center gap-1"><AdminBadge tone={d.alerts > 0 ? 'warning' : 'success'}>a{d.alerts}</AdminBadge><AdminBadge tone={d.sla_fail > 0 ? 'danger' : 'neutral'}>sla{d.sla_fail}</AdminBadge></span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <p className="text-[11px] text-ink-dim">digest 없음.</p>}
            </AdminCard>
          </div>
        </div>
      )}
    </AdminSection>
  );
}
