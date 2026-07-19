/**
 * ResilienceRecoveryCenterSection — Enterprise E-9 (Resilience & Recovery Center).
 *
 * Resilience/Recovery/Continuity/Incident Readiness/Recovery Progress/
 * Operational Stability 통합 Executive Resilience Layer.
 * 신규 Recovery Engine/Self-Healing Engine/Incident Engine/Migration/RPC 없음 —
 * 기존 원장(0502 Incident·Recovery · NOC KPI · Self-Healing Summary ·
 * 0564 Enterprise Resilience · 0496 Governance · AI-OPS-44 Performance ·
 * Streaming) 재사용(읽기 전용). AI 는 복구를 실행하지 않는다.
 * (기존 SelfHealingSection(0502)/ResilienceIntelligenceSection(0564)/
 *  RiskResilienceSection(0528)/CapacityContinuitySection(0508)과 별개)
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowDown, Bot, Database, Gauge, GitBranch,
  HeartPulse, LayoutDashboard, Lock, RefreshCw, Shield, Wrench,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import {
  fetchIncidents, fetchRecoveryCandidates, fetchNocKpi, fetchSelfHealingSummary,
  fetchEnterpriseResilienceSummary, fetchGovernanceSummary, fetchEnterprisePerformanceSummary,
  fetchStreamingSummary,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  RECOVERY_RELATIONSHIP_EDGES,
  assessResilienceQuality, buildRecoveryRelationships, buildRecoverySummaryLines,
  buildResilienceOverview, emptyRecoveryFeeds,
  type RecoveryFeeds, type RRIncidentRow, type RRRecoveryRow,
} from '@/lib/resilienceRecoveryCenter';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));
const PCT = (n: number | null) => (n == null ? '측정 불가' : `${n}%`);

type Tab = 'overview' | 'recovery' | 'incidents' | 'readiness' | 'continuity'
  | 'analytics' | 'relationships' | 'summary' | 'quality' | 'limitations';
const TABS: { key: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'recovery', label: 'Recovery', icon: Wrench },
  { key: 'incidents', label: 'Incidents', icon: AlertTriangle },
  { key: 'readiness', label: 'Readiness', icon: Shield },
  { key: 'continuity', label: 'Continuity', icon: HeartPulse },
  { key: 'analytics', label: 'Analytics', icon: Gauge },
  { key: 'relationships', label: 'Relationships', icon: GitBranch },
  { key: 'summary', label: 'AI Summary', icon: Bot },
  { key: 'quality', label: 'Quality', icon: Database },
  { key: 'limitations', label: 'Known Limitations', icon: Lock },
];

const KNOWN_LIMITATIONS = [
  '신규 Recovery Engine/Self-Healing Engine/Incident Engine 생성 없음 — 기존 원장 통합 조회 계층입니다',
  '신규 Migration/RPC 없음 — 0502 Incident·Recovery/NOC KPI/Self-Healing Summary/0564 Resilience/0496 Governance/AI-OPS-44 Performance/Streaming 재사용(읽기 전용)',
  'AI 는 복구를 실행하지 않습니다 — 자동 Recovery 실행/자동 Incident 해결/자동 Self-Healing 실행은 금지 목록이며, 복구 승인·실행은 사람이 기존 절차로 수행합니다',
  'Recovery 버킷은 실측 status/outcome 의 결정적 매핑이며, 매핑 불가 조합은 other 로 정직 공개합니다',
  'Incident Readiness 는 피드 연결 여부만 표시 — 커버리지 수치 전용 계측 부재(실측), 추론 없음',
  'Continuity 는 계산하지 않습니다 — 기존 관측값(Store online 비율/미복구 건수/원장 관측 여부)만 표시하며, Executive Continuity 전용 피드는 부재(실측)',
  'Recovery Time 은 추정치 평균 ≠ 실측 복구 시간, 성공률은 결과가 기록된 건만 분모로 사용(unknown 제외), Incident Trend 는 E-2/E-7 로직 재사용(예측 없음)',
  'Executive Confidence 는 피드 관측 커버리지이며 실제 신뢰도/생존 보장이 아닙니다',
  'Executive Recovery Summary 는 관측값 기반 결정적 문장(5줄 이내)이며 복구 실행/승인이 아닙니다',
  '자동 승인/자동 계약 승인/자동 지급/자동 Merge/자동 Deploy/자동 Production Apply 없음',
  'Migration 0472~0564 production 미적용 — 관련 원장 피드는 적용 전까지 미관측으로 나타날 수 있습니다',
  '브라우저 실측 미검증 — UI 는 타입/린트/빌드/단위 테스트 기준으로만 검증했습니다',
];

export default function ResilienceRecoveryCenterSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [feeds, setFeeds] = useState<RecoveryFeeds>(emptyRecoveryFeeds());
  const [failedFeeds, setFailedFeeds] = useState<string[]>([]);
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const results = await Promise.allSettled([
        fetchIncidents(null, null, 100), fetchRecoveryCandidates(null, null, 100), fetchNocKpi(),
        fetchSelfHealingSummary(), fetchEnterpriseResilienceSummary(), fetchGovernanceSummary(),
        fetchEnterprisePerformanceSummary(), fetchStreamingSummary(),
      ]);
      const keys = ['incidents', 'recoveries', 'noc', 'selfHealing', 'resilienceSummary', 'govSummary', 'performance', 'streaming'] as const;
      const next = emptyRecoveryFeeds();
      const failed: string[] = [];
      keys.forEach((k, i) => {
        const r = results[i];
        if (r.status !== 'fulfilled' || r.value == null) { failed.push(k); return; }
        if (k === 'govSummary') {
          next.govEvents = (r.value as { events?: { violations: number; overrides: number; checks: number } | null }).events ?? null;
          if (next.govEvents == null) failed.push('govEvents');
        } else if (k === 'incidents') {
          next.incidents = r.value as RRIncidentRow[];
        } else if (k === 'recoveries') {
          next.recoveries = r.value as RRRecoveryRow[];
        } else {
          (next as unknown as Record<string, unknown>)[k] = r.value;
        }
      });
      setFeeds(next); setFailedFeeds(failed);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const overview = useMemo(() => buildResilienceOverview(feeds), [feeds]);
  const relationships = useMemo(() => buildRecoveryRelationships(feeds), [feeds]);
  const quality = useMemo(() => assessResilienceQuality(feeds), [feeds]);
  const summaryLines = useMemo(() => buildRecoverySummaryLines({
    recoverySuccessRatePct: overview.analytics.recoverySuccessRatePct,
    pendingRecoveries: overview.recoveries.buckets.find((b) => b.bucket === 'pending')?.count ?? null,
    operationalStability: overview.card.operationalStability,
    criticalRecoveryRisks: overview.card.recoveryRisks,
  }), [overview]);

  if (loading) return <AdminCard title="Resilience & Recovery Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Resilience & Recovery Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const qualityTone = (l: string) => (l === 'healthy' ? 'success' : l === 'attention' ? 'warning' : l === 'critical' ? 'danger' : 'neutral') as 'success' | 'warning' | 'danger' | 'neutral';

  return (
    <AdminCard
      title="Resilience & Recovery Center"
      subtitle="Resilience·Recovery·Continuity·Incident Readiness 통합 Executive Resilience Layer — AI 는 연결·설명만, 복구 실행은 사람"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="이 센터는 기존 Incident·Recovery·Governance·Performance·Resilience 기록을 하나의 화면에서 연결하는 Executive Resilience Layer 입니다. AI 는 복구를 실행하지 않으며, 기존 Recovery 정보를 연결하고 설명하고 우선순위를 제시할 뿐입니다. 자동 Recovery 실행·자동 Incident 해결·자동 Self-Healing 실행·자동 승인·자동 계약 승인·자동 지급·자동 Merge·자동 Deploy·자동 Production Apply 는 수행하지 않습니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {tab === 'overview' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Operational Stability" value={overview.card.operationalStability} />
            <Box label="Recovery Health" value={overview.card.recoveryHealth} />
            <Box label="Active Incidents (미해결)" value={NUM(overview.card.activeIncidents)} />
            <Box label="Recovery Progress" value={PCT(overview.card.recoveryProgressPct)} />
            <Box label="Incident Readiness (관측 영역)" value={`${overview.card.incidentReadiness}/5`} />
            <Box label="Continuity Status" value={overview.card.continuityStatus} />
            <Box label="Executive Confidence (관측 커버리지)" value={`${overview.card.executiveConfidencePct}%`} />
            <Box label="Recovery Risks (실패+미해결)" value={NUM(overview.card.recoveryRisks)} />
          </div>
          {failedFeeds.length > 0 && (
            <AdminAlert tone="warning" icon={<AlertTriangle size={14} />} description={`관측 실패 피드 ${failedFeeds.length}종: ${failedFeeds.join(', ')} — 미관측으로만 표시됩니다(추론 없음).`} />
          )}
          <p className="text-[11px] text-muted-foreground">Executive Confidence 는 피드 관측 커버리지이며 실제 신뢰도/생존 보장이 아닙니다.</p>
        </div>
      )}

      {tab === 'recovery' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            {overview.recoveries.buckets.map((b) => (
              <Box key={b.bucket} label={`${b.bucket} recovery`} value={b.count == null ? '미관측' : `${NUM(b.count)}건`} />
            ))}
          </div>
          {(feeds.recoveries ?? []).slice(0, 20).map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded-lg border border-border p-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-xs font-bold">{r.recovery_code} · {r.strategy_type}</span>
                <AdminBadge tone="neutral">{r.status}</AdminBadge>
                <AdminBadge tone={r.outcome.includes('success') ? 'success' : r.outcome.includes('fail') ? 'danger' : 'neutral'}>{r.outcome}</AdminBadge>
              </div>
              <span className="shrink-0 text-[10px] text-muted-foreground">추정 {r.recovery_time_estimate_min == null ? '미기록' : `${r.recovery_time_estimate_min}분`}</span>
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">Recovery 후보 원장(0502) 조회 — 생성/실행 없음. 매핑 불가 상태: {overview.recoveries.otherStatuses.map((s) => `${s.status}(${s.count})`).join(', ') || '없음'}</p>
        </div>
      )}

      {tab === 'incidents' && (
        <div className="space-y-2">
          {(feeds.incidents ?? []).length === 0
            ? <AdminEmpty title="Incident 기록 없음" description="관측 창 내 Incident 원장(0502) 기록이 없습니다." />
            : (feeds.incidents ?? []).slice(0, 20).map((i) => (
              <div key={i.id} className="flex items-center justify-between rounded-lg border border-border p-2">
                <div className="flex min-w-0 items-center gap-2">
                  <AdminBadge tone={i.resolved_at == null ? 'warning' : 'success'}>{i.resolved_at == null ? '미해결' : '해결'}</AdminBadge>
                  <span className="truncate text-xs font-bold">{i.incident_code} · {i.incident_type}</span>
                  <AdminBadge tone="neutral">{i.severity}</AdminBadge>
                </div>
                <span className="shrink-0 text-[10px] text-muted-foreground">{new Date(i.detected_at).toLocaleString('ko-KR')} · {i.status}</span>
              </div>
            ))}
          <p className="text-[11px] text-muted-foreground">Incident 원장(0502) 조회 — 자동 해결 없음. 해결 여부는 resolved_at 관측값 기준입니다.</p>
        </div>
      )}

      {tab === 'readiness' && (
        <div className="space-y-2">
          {overview.readiness.map((r) => (
            <div key={r.area} className="flex items-center justify-between rounded-lg border border-border p-2">
              <div className="flex items-center gap-2">
                <AdminBadge tone={r.observed ? 'success' : 'neutral'}>{r.observed ? '관측됨' : '미관측'}</AdminBadge>
                <span className="text-xs font-bold">{r.area} coverage</span>
              </div>
              <span className="text-[10px] text-muted-foreground">{r.note}</span>
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">피드 연결 여부만 표시 — 커버리지 수치 전용 계측은 부재(실측)이며 추론하지 않습니다.</p>
        </div>
      )}

      {tab === 'continuity' && (
        <div className="space-y-2">
          {overview.continuity.map((c) => (
            <div key={c.area} className="flex items-center justify-between rounded-lg border border-border p-2">
              <div className="flex min-w-0 items-center gap-2">
                <AdminBadge tone={qualityTone(c.level)}>{c.level}</AdminBadge>
                <span className="text-xs font-bold">{c.area} continuity</span>
                <span className="truncate text-[10px] text-muted-foreground">{c.value}</span>
              </div>
              <span className="shrink-0 text-[10px] text-muted-foreground">{c.note}</span>
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">Continuity 를 계산하지 않습니다 — 기존 관측값만 표시합니다.</p>
        </div>
      )}

      {tab === 'analytics' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <Box label="Recovery Time (추정 평균)" value={overview.analytics.avgRecoveryEstimateMin == null ? '측정 불가' : `${NUM(overview.analytics.avgRecoveryEstimateMin)}분`} />
            <Box label="Recovery Success Rate" value={PCT(overview.analytics.recoverySuccessRatePct)} />
            <Box label="Incident Duration (해결 건 평균)" value={overview.analytics.avgIncidentDurationMin == null ? '측정 불가' : `${NUM(overview.analytics.avgIncidentDurationMin)}분`} />
            <Box label="Incident Frequency (일 평균)" value={overview.analytics.incidentPerDay == null ? '측정 불가' : `${overview.analytics.incidentPerDay}건`} />
            <Box label="Incident Trend" value={overview.analytics.incidentTrend} />
          </div>
          <p className="text-[11px] text-muted-foreground">{overview.analytics.measuredNote}. Trend 는 E-2/E-7 로직 재사용(관측 창 내 비교, 예측 없음).</p>
        </div>
      )}

      {tab === 'relationships' && (
        <div className="space-y-1">
          {relationships.map((r, i) => (
            <div key={r.stage}>
              <div className="flex items-center justify-between rounded-lg border border-border p-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold">{r.stage}</span>
                  <AdminBadge tone={r.observed ? 'success' : 'neutral'}>{r.observed ? '관측됨' : '미관측'}</AdminBadge>
                </div>
                <span className="text-[10px] text-muted-foreground">{i < RECOVERY_RELATIONSHIP_EDGES.length ? RECOVERY_RELATIONSHIP_EDGES[i].via : r.note}</span>
              </div>
              {i < relationships.length - 1 && <div className="pl-3 text-muted-foreground"><ArrowDown size={12} /></div>}
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">Incident→Recovery→Performance→Continuity→Resilience→Executive — 복구 승인과 실행은 사람이 수행합니다.</p>
        </div>
      )}

      {tab === 'summary' && (
        <div className="space-y-2">
          <div className="rounded-lg border border-border p-3">
            {summaryLines.map((line, i) => <p key={i} className="flex items-start gap-2 text-xs"><Activity size={12} className="mt-0.5 shrink-0 text-muted-foreground" /> {line}</p>)}
          </div>
          <p className="text-[11px] text-muted-foreground">관측값 기반 결정적 요약(5줄 이내) — 복구 실행/승인/예측 아님.</p>
        </div>
      )}

      {tab === 'quality' && (
        <div className="space-y-1">
          {quality.map((q) => (
            <div key={q.area} className="flex items-center justify-between rounded-lg border border-border p-2">
              <div className="flex min-w-0 items-center gap-2">
                <AdminBadge tone={qualityTone(q.level)}>{q.level}</AdminBadge>
                <span className="truncate text-xs font-bold">{q.area}</span>
              </div>
              <span className="shrink-0 text-[10px] text-muted-foreground">{q.note}</span>
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">Healthy/Attention/Critical/Insufficient Data — 없는 데이터를 추론하지 않습니다.</p>
        </div>
      )}

      {tab === 'limitations' && (
        <ul className="list-disc space-y-1 pl-4">
          {KNOWN_LIMITATIONS.map((l, i) => <li key={i} className="text-[11px] text-muted-foreground">{l}</li>)}
        </ul>
      )}
    </AdminCard>
  );
}

function Box({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-sm font-bold">{value}</div>
    </div>
  );
}
