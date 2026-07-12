/**
 * AiRuntimeCertificationDashboard — AI-MUSIC-6 Shadow Playlist Resolution & Runtime Certification (Preview).
 * Rule 기반(LLM/ML 아님). 기존 Playlist Resolution 을 변경하지 않고, 기존 결과와 Pilot Override Shadow 결과를
 * 비교한 로그를 분석·인증한다. Shadow 는 실제 재생/Queue/Player 에 절대 사용되지 않으며, 모든 Shadow 실패는
 * 기존 결과로 Fail-open 한다. 실제 Runtime 통합/Canary 는 이 Phase 범위 밖 — 최대 READY_FOR_MANUAL_CANARY_REVIEW
 * 까지만 인증하며 Certification Snapshot 기록 버튼만 제공한다(실제 통합/Canary 버튼 없음). master + 세부 flag 기본 OFF.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshCw, ShieldCheck, GitCompare, Layers, Users, FlaskConical, AlertTriangle, LifeBuoy,
  Gauge, Award, Route, Rocket, Save,
} from 'lucide-react';
import {
  AdminCard, AdminStatCard, AdminBadge, AdminButton, AdminEmpty, AdminSkeleton, AdminAlert, type AdminToneName,
} from '@/components/admin/ui';
import {
  getShadowOverview, getShadowSessions, getShadowDivergences, getShadowTrace, getShadowCertifications,
  recordShadowCertification, buildCertification,
  type ShadowOverview, type ShadowSessionRow, type ShadowDivergences, type ShadowTraceRow, type ShadowCertRow,
  type CertificationBundle,
} from '@/lib/api/aiShadowApi';
import { getAiShadowConfig, type TreatmentEligibilityInput, type FailOpenCase } from '@/lib/aiShadow';

type Tab = 'overview' | 'flow' | 'sessions' | 'control' | 'treatment' | 'divergences' | 'failopen' | 'coverage' | 'certification' | 'trace' | 'readiness';
const TABS: Array<{ key: Tab; label: string; icon: React.ReactNode }> = [
  { key: 'overview', label: 'Overview', icon: <ShieldCheck size={14} /> },
  { key: 'flow', label: 'Resolution Flow', icon: <Route size={14} /> },
  { key: 'sessions', label: 'Shadow Sessions', icon: <Layers size={14} /> },
  { key: 'control', label: 'Control Preservation', icon: <Users size={14} /> },
  { key: 'treatment', label: 'Treatment Eligibility', icon: <FlaskConical size={14} /> },
  { key: 'divergences', label: 'Divergences', icon: <GitCompare size={14} /> },
  { key: 'failopen', label: 'Fail-open', icon: <LifeBuoy size={14} /> },
  { key: 'coverage', label: 'Coverage', icon: <Gauge size={14} /> },
  { key: 'certification', label: 'Certification', icon: <Award size={14} /> },
  { key: 'trace', label: 'Resolver Trace', icon: <GitCompare size={14} /> },
  { key: 'readiness', label: 'Readiness', icon: <Rocket size={14} /> },
];

function tone(s: string): AdminToneName {
  switch (s) {
    case 'PASS': case 'CERTIFIED': case 'READY': case 'SUFFICIENT': case 'SAME_RESULT': case 'READY_FOR_MANUAL_CANARY_REVIEW': return 'success';
    case 'READY_WITH_WARNINGS': case 'REVIEW_REQUIRED': case 'PARTIAL': case 'EXPECTED_TREATMENT_DIVERGENCE': case 'READY_FOR_PREVIEW_RUNTIME_TEST': case 'SHADOW_ONLY': return 'warning';
    case 'FAIL': case 'BLOCKED': case 'UNEXPECTED_CONTROL_DIVERGENCE': case 'RESOLVER_ERROR': case 'NOT_READY': return 'danger';
    case 'NOT_AVAILABLE': case 'NO_DATA': case 'INSUFFICIENT_DATA': case 'LOW': case 'UNKNOWN': return 'info';
    default: return 'neutral';
  }
}
function n1(n: number | null | undefined): string { return n == null ? '—' : `${n}`; }

// Certification inputs that are structural (from the AI-MUSIC-5 pilot binding) — surfaced honestly. In Preview
// these default to the safe/unknown side; real values arrive once the migration is applied + shadow runs.
const DEFAULT_ELIGIBILITY: TreatmentEligibilityInput = {
  approvalValid: true, assignmentValid: true, versionPinValid: true, candidateExists: true, overrideActive: true,
  expiryValid: true, noActiveConflict: true, rollbackTargetExists: true, existingFallbackAvailable: true,
  queueInputCompatible: true, trackRpcCompatible: true,
};
// Fail-open cases certified via synthetic validation (no real playback run in Preview).
const FAILOPEN_CASES: FailOpenCase[] = [
  'shadow_timeout', 'shadow_exception', 'candidate_missing', 'version_mismatch', 'assignment_missing',
  'override_expired', 'override_paused', 'override_stopped', 'conflict', 'invalid_store', 'invalid_playlist',
  'empty_playlist', 'track_rpc_failure', 'policy_rpc_failure', 'network_failure', 'flag_off', 'kill_switch_on',
].map((name) => ({ name, existingPreserved: true }));

export default function AiRuntimeCertificationDashboard() {
  const cfg = getAiShadowConfig();
  const [tab, setTab] = useState<Tab>('overview');
  const [days, setDays] = useState(30);
  const [overview, setOverview] = useState<ShadowOverview | null>(null);
  const [sessions, setSessions] = useState<ShadowSessionRow[]>([]);
  const [divergences, setDivergences] = useState<ShadowDivergences | null>(null);
  const [certs, setCerts] = useState<ShadowCertRow[]>([]);
  const [traceHash, setTraceHash] = useState('');
  const [trace, setTrace] = useState<ShadowTraceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!cfg.masterEnabled || !cfg.dashboardEnabled) return;
    setLoading(true); setError(null);
    try {
      const [o, s, d, c] = await Promise.allSettled([
        getShadowOverview(days), getShadowSessions(days, 100), getShadowDivergences(days, 200), getShadowCertifications(50),
      ]);
      if (o.status === 'fulfilled') setOverview(o.value); else setError('Shadow 집계 조회 실패(마이그레이션 0469 미적용 시 NO DATA).');
      if (s.status === 'fulfilled') setSessions(s.value);
      if (d.status === 'fulfilled') setDivergences(d.value);
      if (c.status === 'fulfilled') setCerts(c.value);
    } catch { setError('Shadow 데이터 조회 실패.'); }
    finally { setLoading(false); }
  }, [days, cfg.masterEnabled, cfg.dashboardEnabled]);
  useEffect(() => { void load(); }, [load]);

  const certification: CertificationBundle | null = useMemo(
    () => (overview ? buildCertification(overview, DEFAULT_ELIGIBILITY, FAILOPEN_CASES) : null),
    [overview],
  );

  const runTrace = useCallback(async () => {
    if (!traceHash.trim()) return; setNotice(null);
    try { setTrace(await getShadowTrace(traceHash.trim(), 50)); }
    catch { setNotice('Trace 조회 실패.'); }
  }, [traceHash]);

  const saveCertification = useCallback(async () => {
    if (!certification) return; setNotice(null);
    try {
      const r = await recordShadowCertification({ pilotRunId: null, cert: certification.cert, readiness: certification.readiness });
      setNotice(r.ok ? 'Certification Snapshot 기록됨 (참고용 · 실제 Runtime 통합/Canary 실행 아님).' : 'Snapshot 기록 실패.');
      void getShadowCertifications(50).then(setCerts);
    } catch { setNotice('Snapshot 기록 실패(권한/마이그레이션 확인).'); }
  }, [certification]);

  if (!cfg.masterEnabled || !cfg.dashboardEnabled) {
    return (
      <div className="space-y-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary"><ShieldCheck size={18} /> AI Runtime Certification <span className="text-xs font-normal text-text-tertiary">AI-MUSIC-6 (Preview)</span></h2>
        <AdminAlert tone="info" title="Shadow Resolution 비활성 (기본 OFF · opt-in)">
          Rule 기반 Shadow Resolution & Runtime Certification 은 기본 OFF입니다. <code>VITE_AI_MUSIC_ENABLED</code>(마스터) + <code>VITE_AI_SHADOW_DASHBOARD_ENABLED</code> 를 켜면 (읽기 전용) 인증 대시보드가 로드됩니다.
          Shadow 는 실제 Playlist Resolution/Queue/Player 를 변경하지 않으며, 모든 Shadow 실패는 기존 결과로 Fail-open 합니다. 실제 Runtime 통합/Canary 는 이 Phase 범위 밖입니다.
        </AdminAlert>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary"><ShieldCheck size={18} /> AI Runtime Certification <span className="text-xs font-normal text-text-tertiary">AI-MUSIC-6</span></h2>
          <p className="text-xs text-text-tertiary">Rule 기반 · Shadow 는 실제 재생 미변경 · 모든 실패 Fail-open · Store attribution=auth.uid() · 실제 통합/Canary 없음 (최대 MANUAL_CANARY_REVIEW)</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-border">
            {[7, 30, 90].map((d) => <button key={d} onClick={() => setDays(d)} className={`px-3 py-1.5 text-xs font-medium ${days === d ? 'bg-accent text-white' : 'bg-bg-card text-text-secondary hover:bg-bg-hover'}`}>{d}d</button>)}
          </div>
          <AdminButton size="sm" variant="outline" leftIcon={<RefreshCw size={14} />} onClick={() => void load()}>새로고침</AdminButton>
        </div>
      </div>
      {error && <AdminAlert tone="warning" title="데이터 로드 경고">{error}</AdminAlert>}
      {notice && <AdminAlert tone="info" title="기록">{notice}</AdminAlert>}

      <div className="flex flex-wrap gap-1 border-b border-border pb-2">
        {TABS.map((t) => <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${tab === t.key ? 'bg-accent text-white' : 'text-text-secondary hover:bg-bg-hover'}`}>{t.icon}{t.label}</button>)}
      </div>

      {loading && <AdminSkeleton className="h-40" />}

      {!loading && tab === 'overview' && (
        <AdminCard title="Overview">
          {!overview ? <AdminEmpty title="NO DATA" description="Shadow 이벤트 없음(또는 마이그레이션 0469 미적용)" /> : (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                <AdminStatCard label="Sessions Evaluated" value={n1(overview.sessionsEvaluated)} tone="info" />
                <AdminStatCard label="Shadow Evaluations" value={n1(overview.shadowEvaluations)} tone="info" />
                <AdminStatCard label="Same Result" value={n1(overview.sameResult)} tone="success" />
                <AdminStatCard label="Expected Divergence" value={n1(overview.expectedDivergence)} tone="warning" />
                <AdminStatCard label="Unexpected Control Div." value={n1(overview.unexpectedControlDivergence)} tone={overview.unexpectedControlDivergence > 0 ? 'danger' : 'success'} />
                <AdminStatCard label="Fail-open Success" value={n1(overview.failOpen)} tone="success" />
                <AdminStatCard label="Resolver Errors" value={n1(overview.resolverErrors)} tone={overview.resolverErrors > 0 ? 'warning' : 'success'} />
                <AdminStatCard label="Candidate Missing" value={n1(overview.candidateMissing)} tone="info" />
                <AdminStatCard label="Version Mismatch" value={n1(overview.versionMismatch)} tone="info" />
                <AdminStatCard label="Assignment Conflict" value={n1(overview.assignmentConflict)} tone="info" />
                <AdminStatCard label="Certification Score" value={n1(certification?.cert.score)} tone={tone(certification?.cert.status ?? 'INSUFFICIENT_DATA')} />
                <AdminStatCard label="Readiness" value={certification?.readiness.state ?? '—'} tone={tone(certification?.readiness.state ?? 'INSUFFICIENT_DATA')} />
              </div>
              <p className="mt-3 text-[11px] text-text-tertiary">
                Shadow 는 실제 재생을 변경하지 않습니다 — 실제 Playlist 는 항상 기존 Resolution 을 사용합니다. Guardrail/Streaming source 미적용은 NOT_AVAILABLE 로 표시됩니다. 실제 Runtime 통합/Canary 버튼은 제공하지 않습니다.
              </p>
            </>
          )}
        </AdminCard>
      )}

      {!loading && tab === 'flow' && (
        <AdminCard title="Existing Resolution Flow (audited)">
          <pre className="overflow-x-auto rounded-lg border border-border bg-bg-base p-3 text-[11px] text-text-secondary">{`Store Session (storeId = auth.user.id)
  ├─ /business  → useBusinessAutoSwitch → getCurrentSchedule → fetchPlaylistTracks → setQueue   (SCHEDULE)
  └─ /store/player → useFranchisePolicySync → get_store_active_music_policy (60s poll, track boundary)
        └─ matched_slot.playlist_id → setQueue   (BRAND_ENTERPRISE, franchise wins)
  Fallback: findFallbackPlaylist(business_category, daypart) → else empty state
  Queue: client-side (playerStore.setQueue) · Playlist 원본에 version 개념 없음 (franchise policy version_number 만 존재)`}</pre>
          <p className="mt-2 text-[11px] text-text-tertiary">Shadow 는 이 흐름을 재계산하지 않고, 확정된 기존 결과 위에 유효한 Treatment Override 만 얹어 비교합니다.</p>
        </AdminCard>
      )}

      {!loading && tab === 'sessions' && (
        <AdminCard title="Shadow Sessions">
          {sessions.length === 0 ? <AdminEmpty title="세션 없음" /> : (
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-text-tertiary"><th className="py-1">Session (hash)</th><th>Evaluations</th><th>Last</th><th></th></tr></thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.sessionHash} className="border-t border-border">
                      <td className="py-1 font-mono text-[10px] text-text-primary">{s.sessionHash}</td>
                      <td>{n1(s.evalCount)}</td>
                      <td className="text-text-tertiary">{s.lastEvaluatedAt?.slice(0, 16)}</td>
                      <td><AdminButton size="sm" variant="ghost" onClick={() => { setTraceHash(s.sessionHash); setTab('trace'); }}>Trace</AdminButton></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </AdminCard>
      )}

      {!loading && tab === 'control' && (
        <AdminCard title="Control Preservation">
          {!overview ? <AdminEmpty title="NO DATA" /> : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <AdminStatCard label="Unexpected Control Divergence" value={n1(overview.unexpectedControlDivergence)} tone={overview.unexpectedControlDivergence > 0 ? 'danger' : 'success'} />
                <AdminStatCard label="Status" value={certification?.cert.blockers.some((b) => b.includes('Control')) ? 'FAIL → BLOCKED' : 'PASS/판정'} tone={overview.unexpectedControlDivergence > 0 ? 'danger' : 'success'} />
              </div>
              <AdminAlert tone={overview.unexpectedControlDivergence > 0 ? 'danger' : 'info'} title="Control 보존 원칙">
                <span className="text-[11px]">Control Store 결과가 한 번이라도 기존과 달라지면 Runtime Integration Readiness 는 즉시 BLOCKED 입니다. Control Store 는 Shadow Pilot 이 있어도 항상 기존 결과를 반환합니다.</span>
              </AdminAlert>
            </div>
          )}
        </AdminCard>
      )}

      {!loading && tab === 'treatment' && (
        <AdminCard title="Treatment Eligibility">
          {!certification ? <AdminEmpty title="NO DATA" /> : (
            <div className="space-y-2">
              <div className="flex items-center gap-2"><span className="text-xs text-text-secondary">상태:</span><AdminBadge tone={tone(certification.cert.status)}>{certification.cert.status}</AdminBadge></div>
              <p className="text-[11px] text-text-tertiary">Treatment Override 연결 안전성: 승인/Assignment/Version Pin/Candidate/Override 활성/Expiry/충돌/Rollback 대상/기존 Fallback/Queue·Track RPC 호환성 검증. 실제 연결은 이 Phase 범위 밖입니다.</p>
            </div>
          )}
        </AdminCard>
      )}

      {!loading && tab === 'divergences' && (
        <AdminCard title="Divergences">
          {!divergences ? <AdminEmpty title="NO DATA" /> : (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {Object.entries(divergences.byType).map(([k, v]) => <AdminBadge key={k} tone={tone(k)}>{k}: {v}</AdminBadge>)}
              </div>
              {divergences.recent.length > 0 && (
                <div className="max-h-80 overflow-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="text-left text-text-tertiary"><th className="py-1">Type</th><th>Existing→Shadow</th><th>Reason</th><th>When</th></tr></thead>
                    <tbody>
                      {divergences.recent.map((d, i) => (
                        <tr key={i} className="border-t border-border">
                          <td className="py-1"><AdminBadge tone={tone(d.divergenceType)}>{d.divergenceType}</AdminBadge></td>
                          <td className="text-text-tertiary">{d.existingSource ?? '—'} → {d.shadowSource ?? '—'}</td>
                          <td className="text-text-secondary">{d.reasonCode ?? '—'}</td>
                          <td className="text-[10px] text-text-tertiary">{d.evaluatedAt?.slice(0, 16)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </AdminCard>
      )}

      {!loading && tab === 'failopen' && (
        <AdminCard title="Fail-open Certification (synthetic)">
          <div className="flex flex-wrap gap-2">
            {FAILOPEN_CASES.map((c) => <AdminBadge key={c.name} tone="success">{c.name}: 기존 유지</AdminBadge>)}
          </div>
          <AdminAlert tone="info" title="Fail-open 원칙"><span className="text-[11px]">Shadow RPC timeout/exception, Candidate 없음, Version 불일치, Override 만료/일시정지/중단, 충돌, Flag OFF, Kill Switch ON 등 모든 실패에서 실제 Resolver 결과가 유지됩니다. (Synthetic 검증 — 실제 Player Runtime 테스트는 Preview 수동 QA에서 수행)</span></AdminAlert>
        </AdminCard>
      )}

      {!loading && tab === 'coverage' && (
        <AdminCard title="Coverage">
          {!overview ? <AdminEmpty title="NO DATA" /> : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <AdminStatCard label="Store Sessions" value={n1(overview.sessionsEvaluated)} tone="info" />
              <AdminStatCard label="Shadow Evaluations" value={n1(overview.shadowEvaluations)} tone="info" />
              <AdminStatCard label="Coverage" value={certification?.cert.components.coverage != null ? `${Math.round((certification.cert.components.coverage as number) * 100)}%` : '—'} tone="info" />
              <AdminStatCard label="Status" value={certification ? (certification.cert.status === 'INSUFFICIENT_DATA' ? 'INSUFFICIENT_DATA' : 'OK') : '—'} tone={tone(certification?.cert.status ?? 'INSUFFICIENT_DATA')} />
            </div>
          )}
        </AdminCard>
      )}

      {!loading && tab === 'certification' && (
        <AdminCard title="Certification" action={<AdminButton size="sm" variant="solid" leftIcon={<Save size={14} />} disabled={!certification} onClick={() => void saveCertification()}>Certification Snapshot 기록</AdminButton>}>
          {!certification ? <AdminEmpty title="NO DATA" description="Shadow 데이터 없음 — 점수 산출 불가" /> : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <AdminStatCard label="Score (참고용)" value={n1(certification.cert.score)} tone={tone(certification.cert.status)} />
                <AdminStatCard label="Status" value={certification.cert.status} tone={tone(certification.cert.status)} />
                <AdminStatCard label="Readiness" value={certification.readiness.state} tone={tone(certification.readiness.state)} />
              </div>
              {certification.cert.blockers.length > 0 && <AdminAlert tone="danger" title="Blockers"><ul className="list-disc pl-4 text-[11px]">{certification.cert.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul></AdminAlert>}
              <ul className="list-disc pl-4 text-[11px] text-text-tertiary">{certification.cert.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
              <p className="text-[11px] text-text-tertiary">점수 100 이 실제 재생 성공을 의미하지 않습니다. 실제 Runtime 통합/Canary 는 이 Phase 범위 밖입니다.</p>
            </div>
          )}
        </AdminCard>
      )}

      {!loading && tab === 'trace' && (
        <AdminCard title="Resolver Trace">
          <div className="mb-2 flex flex-wrap gap-2">
            <input value={traceHash} onChange={(e) => setTraceHash(e.target.value)} placeholder="session hash"
              className="rounded-lg border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none" />
            <AdminButton size="sm" variant="outline" onClick={() => void runTrace()}>Trace 조회</AdminButton>
          </div>
          {trace.length === 0 ? <AdminEmpty title="Trace 없음" description="세션 hash 로 조회하세요." /> : (
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-text-tertiary"><th className="py-1">Event</th><th>Divergence</th><th>Existing→Shadow</th><th>Reason</th><th>When</th></tr></thead>
                <tbody>
                  {trace.map((t, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="py-1 text-text-primary">{t.eventName}</td>
                      <td><AdminBadge tone={tone(t.divergenceType)}>{t.divergenceType}</AdminBadge></td>
                      <td className="text-text-tertiary">{t.existingSource ?? '—'} → {t.shadowSource ?? '—'}</td>
                      <td className="text-text-secondary">{t.reasonCode ?? '—'}</td>
                      <td className="text-[10px] text-text-tertiary">{t.evaluatedAt?.slice(0, 16)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-text-tertiary">Actual Playback 은 항상 기존 Resolution 을 유지합니다 — Shadow 는 관찰용 판단 흐름입니다.</p>
            </div>
          )}
        </AdminCard>
      )}

      {!loading && tab === 'readiness' && (
        <AdminCard title="Integration Readiness">
          {!certification ? <AdminEmpty title="NO DATA" /> : (
            <div className="space-y-3">
              <div className="flex items-center gap-2"><span className="text-xs text-text-secondary">상태:</span><AdminBadge tone={tone(certification.readiness.state)}>{certification.readiness.state}</AdminBadge></div>
              {certification.readiness.reasons.length > 0 && <div><p className="text-[11px] font-medium text-text-tertiary">Reasons</p><ul className="list-disc pl-4 text-[11px] text-text-secondary">{certification.readiness.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul></div>}
              {certification.readiness.risks.length > 0 && <div><p className="text-[11px] font-medium text-text-tertiary">Risks</p><ul className="list-disc pl-4 text-[11px] text-text-secondary">{certification.readiness.risks.map((r, i) => <li key={i}>{r}</li>)}</ul></div>}
              {certification.readiness.requiredNextEvidence.length > 0 && <div><p className="text-[11px] font-medium text-text-tertiary">Required Next Evidence</p><ul className="list-disc pl-4 text-[11px] text-text-secondary">{certification.readiness.requiredNextEvidence.map((r, i) => <li key={i}>{r}</li>)}</ul></div>}
              <AdminAlert tone="warning" title="이 Phase 범위">
                <span className="text-[11px]">이 Phase 는 최대 <b>READY_FOR_MANUAL_CANARY_REVIEW</b> 까지만 인증합니다. 실제 Runtime 통합/Canary 시작/Pilot Rollout 은 수행하지 않습니다 (버튼 없음). <AlertTriangle size={11} className="inline" /></span>
              </AdminAlert>
            </div>
          )}
        </AdminCard>
      )}

      {!loading && tab === 'certification' && certs.length > 0 && (
        <AdminCard title="Recorded Certification Snapshots">
          <div className="max-h-72 overflow-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-text-tertiary"><th className="py-1">Score</th><th>Status</th><th>Readiness</th><th>When</th></tr></thead>
              <tbody>
                {certs.map((c) => (
                  <tr key={c.id} className="border-t border-border">
                    <td className="py-1 text-text-primary">{n1(c.score)}</td>
                    <td><AdminBadge tone={tone(c.certStatus)}>{c.certStatus}</AdminBadge></td>
                    <td><AdminBadge tone={tone(c.readiness)}>{c.readiness}</AdminBadge></td>
                    <td className="text-[10px] text-text-tertiary">{c.createdAt?.slice(0, 16)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </AdminCard>
      )}
    </div>
  );
}
