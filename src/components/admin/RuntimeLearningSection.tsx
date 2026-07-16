/**
 * RuntimeLearningSection — Enterprise Runtime Learning, Incident Postmortem Intelligence &
 * Assurance Policy Evolution Center (Phase AI-OPS-35).
 *
 * Runtime History→Incident Review→Resolution Evidence→Postmortem Draft→Root Cause Candidate→
 * Contributing Factor→Control Gap→Policy Proposal→Human Policy Review→Version Reference→
 * Effectiveness Observation→Organizational Learning→Audit.
 * Correlation ≠ Causality · Pattern ≠ Root Cause · Candidate ≠ Confirmed ·
 * Proposal ≠ Approval ≠ Application ≠ Effectiveness · Resolution ≠ Outcome.
 * 자동 Root Cause 확정/Policy·Threshold 변경/인사 평가/책임자 지정 없음.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, BookOpen, CheckCircle2, ClipboardList, Copy, FileText,
  FlaskConical, Grid3x3, History, Layers, Lightbulb, Lock, RefreshCw, Scale,
  ScrollText, Search, Shield, TrendingUp, Undo2,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchRuntimeLearningSummary, fetchRuntimePostmortems, createRuntimePostmortem,
  reviewRuntimePostmortem, fetchRuntimePolicyProposals, createRuntimePolicyProposal,
  reviewRuntimePolicyProposal, recordRuntimeLearningEvent, fetchRuntimeLearningAudit,
  fetchRuntimeSessions, fetchRuntimeIncidentCandidates,
  type RuntimeLearningSummary, type RuntimePostmortemRow, type RuntimePolicyProposalRow,
  type RuntimeLearningEventRow, type RuntimeSessionRow, type RuntimeIncidentCandidateRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  buildRuntimeLearningRecommendation, buildRuntimeLearningTimeline,
  LEARNING_COMPONENTS, RUNTIME_LEARNING_SUPPORT, POLICY_DOMAINS,
} from '@/lib/runtimeLearning';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'overview' | 'runtimehistory' | 'incidenthistory' | 'postmortems' | 'pendingpm' | 'rootcauses'
  | 'factors' | 'controlgaps' | 'recurrence' | 'connectorrisk' | 'automationrisk' | 'evidencegaps'
  | 'reviewdelays' | 'recoveryeffect' | 'corrective' | 'preventive' | 'policyproposals' | 'pendingpolicy'
  | 'approvedpolicies' | 'versionrefs' | 'application' | 'effectiveness' | 'adverse' | 'orglearning'
  | 'humanreviews' | 'recommendations' | 'timeline' | 'audit' | 'support' | 'limitations';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'overview', label: 'Overview', icon: Layers },
  { key: 'runtimehistory', label: 'Runtime History', icon: History },
  { key: 'incidenthistory', label: 'Incident History', icon: AlertTriangle },
  { key: 'postmortems', label: 'Postmortems', icon: FileText },
  { key: 'pendingpm', label: 'Pending Postmortem Review', icon: Scale },
  { key: 'rootcauses', label: 'Root Cause Candidates', icon: Search },
  { key: 'factors', label: 'Contributing Factors', icon: Activity },
  { key: 'controlgaps', label: 'Control Gaps', icon: Shield },
  { key: 'recurrence', label: 'Recurrence Patterns', icon: RefreshCw },
  { key: 'connectorrisk', label: 'Connector Risk Patterns', icon: AlertTriangle },
  { key: 'automationrisk', label: 'Automation Risk Patterns', icon: AlertTriangle },
  { key: 'evidencegaps', label: 'Evidence Gap Patterns', icon: ScrollText },
  { key: 'reviewdelays', label: 'Review Delay Patterns', icon: Scale },
  { key: 'recoveryeffect', label: 'Recovery Effectiveness', icon: Undo2 },
  { key: 'corrective', label: 'Corrective Actions', icon: ClipboardList },
  { key: 'preventive', label: 'Preventive Actions', icon: Shield },
  { key: 'policyproposals', label: 'Policy Proposals', icon: BookOpen },
  { key: 'pendingpolicy', label: 'Pending Policy Reviews', icon: Scale },
  { key: 'approvedpolicies', label: 'Approved Policy References', icon: CheckCircle2 },
  { key: 'versionrefs', label: 'Policy Version References', icon: Copy },
  { key: 'application', label: 'Policy Application', icon: ClipboardList },
  { key: 'effectiveness', label: 'Policy Effectiveness', icon: TrendingUp },
  { key: 'adverse', label: 'Adverse Effect Candidates', icon: AlertTriangle },
  { key: 'orglearning', label: 'Organizational Learning', icon: BookOpen },
  { key: 'humanreviews', label: 'Human Reviews', icon: Scale },
  { key: 'recommendations', label: 'Recommendations', icon: Lightbulb },
  { key: 'timeline', label: 'Learning Timeline', icon: History },
  { key: 'audit', label: 'Audit', icon: History },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
  { key: 'limitations', label: 'Known Limitations', icon: FlaskConical },
];

const KNOWN_LIMITATIONS = [
  '자동 Root Cause 확정/Causality 자동 판정 없음 — Postmortem 은 Draft 중심',
  'Policy Proposal 은 Reference 중심 — 실제 Policy Version Registry 는 0512 실존 구조 읽기 전용 참조',
  'Assurance Threshold Versioning 없음 · Runtime Rule 자동 적용 없음',
  'Policy Application 자동 검증 없음 · Effectiveness 자동 인과 판정 없음(외부 요인 미검토 시 causality_unverified)',
  '반복 Pattern 표본 제한(sample_too_small 유지) · Provider 외부 장애 데이터 없음(Connector Failure ≠ Provider Fault)',
  '자동 Connector/Automation Disable 없음 · 자동 Policy/Threshold 변경 없음',
  '자동 인사 평가/책임자 지정 없음(blame_assigned:false)',
  'Human Review 필수 · Production Action/Apply 미지원',
];

export default function RuntimeLearningSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<RuntimeLearningSummary>({});
  const [postmortems, setPostmortems] = useState<RuntimePostmortemRow[]>([]);
  const [proposals, setProposals] = useState<RuntimePolicyProposalRow[]>([]);
  const [audit, setAudit] = useState<RuntimeLearningEventRow[]>([]);
  const [sessions, setSessions] = useState<RuntimeSessionRow[]>([]);
  const [incidents, setIncidents] = useState<RuntimeIncidentCandidateRow[]>([]);
  const [reason, setReason] = useState('');
  const [selPm, setSelPm] = useState('');
  const [selProp, setSelProp] = useState('');
  const [selSess, setSelSess] = useState('');
  const [propDomain, setPropDomain] = useState<string>('timeout_policy');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, pm, pp, au, se, inc] = await Promise.all([
        fetchRuntimeLearningSummary(), fetchRuntimePostmortems(null, 200), fetchRuntimePolicyProposals(null, 200),
        fetchRuntimeLearningAudit(200), fetchRuntimeSessions(null, 200), fetchRuntimeIncidentCandidates(null, 200),
      ]);
      setSummary(s); setPostmortems(pm); setProposals(pp); setAudit(au); setSessions(se); setIncidents(inc);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); await load(); }
    catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };
  const needReason = (): string | null => {
    if (!reason.trim()) { toast.error('사유/내용 필수(Human Review)'); return null; }
    return reason.trim();
  };
  const needPm = (): RuntimePostmortemRow | null => {
    const p = postmortems.find((x) => x.id === selPm);
    if (!p) { toast.error('Postmortem 선택 필수'); return null; }
    return p;
  };
  const needProp = (): RuntimePolicyProposalRow | null => {
    const p = proposals.find((x) => x.id === selProp);
    if (!p) { toast.error('Policy Proposal 선택 필수'); return null; }
    return p;
  };
  const pmReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason(); const p = needPm();
    if (!r || !p) return;
    void act(() => reviewRuntimePostmortem(p.id, action, r, payload), ok);
  };
  const propReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason(); const p = needProp();
    if (!r || !p) return;
    void act(() => reviewRuntimePolicyProposal(p.id, action, r, payload), ok);
  };
  const learnEvent = (kind: string, payload: Record<string, unknown>, ok: string, requirePm = true) => {
    const r = needReason();
    if (!r) return;
    const p = requirePm ? needPm() : null;
    if (requirePm && !p) return;
    void act(() => recordRuntimeLearningEvent(kind, r, payload, p?.id ?? null), ok);
  };

  const obj = useCallback((k: string): Record<string, unknown> => (typeof summary[k] === 'object' && summary[k] !== null && !Array.isArray(summary[k]) ? summary[k] as Record<string, unknown> : {}), [summary]);
  const num = useCallback((k: string, sub: string): number | null => {
    const v = obj(k)[sub];
    return typeof v === 'number' ? v : null;
  }, [obj]);

  const timeline = useMemo(() => buildRuntimeLearningTimeline([
    { stage: 'history', count: num('history_actuals', 'sessions_0536'), source: 'sessions 실측' },
    { stage: 'postmortem', count: num('postmortems', 'total'), source: 'postmortems 실측' },
    { stage: 'root_cause', count: num('learning_events', 'root_cause_candidates'), source: 'candidate 실측' },
    { stage: 'control_gap', count: num('learning_events', 'control_gaps'), source: 'control_gap 실측' },
    { stage: 'pattern', count: num('learning_events', 'recurrence_patterns'), source: 'pattern 실측' },
    { stage: 'corrective_action', count: num('learning_events', 'corrective_actions'), source: 'corrective 실측' },
    { stage: 'policy_proposal', count: num('proposals', 'total'), source: 'proposals 실측' },
    { stage: 'application', count: num('proposals', 'application_recorded'), source: 'application 실측' },
    { stage: 'effectiveness', count: num('proposals', 'effectiveness_candidates'), source: 'effectiveness 실측' },
  ]), [num]);

  const recommendations = useMemo(() => {
    const out: { type: string; reason: string }[] = [];
    const push = (r: ReturnType<typeof buildRuntimeLearningRecommendation>) => { if (!('rejected' in r)) out.push({ type: r.type, reason: r.reason }); };
    const resolved = num('history_actuals', 'incidents_resolved_0537');
    const pmTotal = num('postmortems', 'total');
    if (resolved != null && pmTotal != null && resolved > pmTotal) push(buildRuntimeLearningRecommendation({ type: 'create_postmortem_draft', reason: `Resolved Candidate ${resolved}건 대비 Postmortem ${pmTotal}건 — 미작성 존재`, evidence: ['0537/0538 실측'], confidence: null }));
    const pendingEv = num('postmortems', 'pending_evidence');
    if (pendingEv != null && pendingEv > 0) push(buildRuntimeLearningRecommendation({ type: 'gather_postmortem_evidence', reason: `Evidence 대기 Postmortem ${pendingEv}건`, evidence: ['postmortems 실측'], confidence: null }));
    const rcCand = num('learning_events', 'root_cause_candidates');
    const rcConf = num('learning_events', 'root_cause_confirmed');
    if (rcCand != null && rcConf != null && rcCand > rcConf) push(buildRuntimeLearningRecommendation({ type: 'review_root_cause_candidate', reason: `미확정 Root Cause Candidate ${rcCand - rcConf}건 — Candidate ≠ Confirmed`, evidence: ['events 실측'], confidence: null }));
    const approvalMissing = num('proposals', 'approval_missing');
    if (approvalMissing != null && approvalMissing > 0) push(buildRuntimeLearningRecommendation({ type: 'request_policy_review', reason: `승인 대기 Policy Proposal ${approvalMissing}건 — Proposal ≠ Approval`, evidence: ['proposals 실측'], confidence: null }));
    const appUnv = num('proposals', 'application_unverified');
    if (appUnv != null && appUnv > 0) push(buildRuntimeLearningRecommendation({ type: 'verify_policy_application', reason: `Application 미검증 ${appUnv}건 — Reference ≠ 적용 성공`, evidence: ['proposals 실측'], confidence: null }));
    const adverse = num('proposals', 'adverse_candidates');
    if (adverse != null && adverse > 0) push(buildRuntimeLearningRecommendation({ type: 'review_adverse_effect_candidate', reason: `Adverse Effect 후보 ${adverse}건 — 사람 검토 필요(자동 Rollback 없음)`, evidence: ['proposals 실측'], confidence: null }));
    return out;
  }, [num]);

  if (loading) return <AdminCard title="Enterprise Runtime Learning & Assurance Policy Evolution"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Enterprise Runtime Learning & Assurance Policy Evolution">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const pmSelect = (
    <select value={selPm} onChange={(e) => setSelPm(e.target.value)} className="min-w-[200px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Postmortem 선택</option>
      {postmortems.map((p) => <option key={p.id} value={p.id}>{p.postmortem_code} · {p.postmortem_status}</option>)}
    </select>
  );
  const propSelect = (
    <select value={selProp} onChange={(e) => setSelProp(e.target.value)} className="min-w-[200px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Policy Proposal 선택</option>
      {proposals.map((p) => <option key={p.id} value={p.id}>{p.proposal_code} · {p.proposal_status}</option>)}
    </select>
  );
  const reasonInput = <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(필수)" className="min-w-[180px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />;
  const btn = (label: string, onClick: () => void, primary = false) => (
    <button disabled={busy} onClick={onClick} className={primary ? 'rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50' : 'rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted disabled:opacity-50'}>{label}</button>
  );
  const tone = (s: string) => (s.includes('approved') || s.includes('verified') || s.includes('effectiveness_candidate') || s === 'confirmed_reference' ? 'success' as const : s.includes('rejected') || s.includes('invalidated') || s.includes('adverse') ? 'danger' as const : s.includes('pending') || s.includes('unverified') || s.includes('missing') || s.includes('candidate') ? 'warning' as const : 'neutral' as const);
  const patternEvents = (needle: string) => audit.filter((e) => e.event_type === 'recurrence_pattern_detected' && String(e.payload?.dimension ?? '').includes(needle));

  return (
    <AdminCard
      title="Enterprise Runtime Learning & Assurance Policy Evolution"
      subtitle="History→Postmortem Draft→Root Cause Candidate→Control Gap→Policy Proposal→Human Review→Version Reference→Effectiveness→Organizational Learning — 자동 확정·적용 없음"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="Root Cause 자동 확정, 책임자 확정, 직원 평가/인사 조치, Policy/Threshold 자동 변경, Connector/Automation 자동 비활성, Runtime Rule 자동 적용, 자동 메시지/Ticket/Issue 발송은 없습니다. AI 가 만드는 Postmortem 은 초안이며 모든 확정·승인·적용은 사람이 수행합니다. Correlation ≠ Causality, Pattern ≠ Root Cause, Candidate ≠ Confirmed, Proposal ≠ Approval ≠ Application ≠ Effectiveness, Missing Evidence ≠ Negligence, Review Delay ≠ Reviewer Failure, Human Resolution ≠ Outcome Achievement." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {tab === 'overview' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Sessions Analyzed(0536)" value={NUM(num('history_actuals', 'sessions_0536'))} />
            <Box label="Incident Candidates(0537)" value={NUM(num('history_actuals', 'incident_candidates_0537'))} />
            <Box label="Postmortem Drafts" value={NUM(num('postmortems', 'draft'))} />
            <Box label="Pending Postmortem Review" value={NUM(num('postmortems', 'pending_review'))} />
            <Box label="Approved Postmortems" value={NUM(num('postmortems', 'approved'))} />
            <Box label="Root Cause Candidates" value={NUM(num('learning_events', 'root_cause_candidates'))} />
            <Box label="Confirmed Root Cause Refs" value={NUM(num('learning_events', 'root_cause_confirmed'))} />
            <Box label="Control Gaps" value={NUM(num('learning_events', 'control_gaps'))} />
            <Box label="Recurrence Patterns" value={NUM(num('learning_events', 'recurrence_patterns'))} />
            <Box label="Corrective Proposals" value={NUM(num('learning_events', 'corrective_actions'))} />
            <Box label="Preventive Proposals" value={NUM(num('learning_events', 'preventive_actions'))} />
            <Box label="Policy Proposals" value={NUM(num('proposals', 'total'))} />
            <Box label="Policy Approval Missing" value={NUM(num('proposals', 'approval_missing'))} />
            <Box label="Application Unverified" value={NUM(num('proposals', 'application_unverified'))} />
            <Box label="Effectiveness Candidates" value={NUM(num('proposals', 'effectiveness_candidates'))} />
            <Box label="Adverse Effect Candidates" value={NUM(num('proposals', 'adverse_candidates'))} />
          </div>
          <AdminAlert tone="info" description={`learning_unavailable: ${Array.isArray(summary.learning_unavailable) ? (summary.learning_unavailable as unknown[]).map(String).join(', ') : '—'} — Policy Versioning(0512 ${NUM(num('history_actuals', 'policy_versions_0512'))}개 버전)/Org Learning(0515 ${NUM(num('history_actuals', 'org_learnings_0515'))}건)/Decision Memory(0514 ${NUM(num('history_actuals', 'decision_memory_0514'))}건)은 읽기 전용 참조. 0 과 Unknown 을 혼동하지 않습니다.`} />
        </div>
      )}

      {tab === 'runtimehistory' && (
        !sessions.length ? <AdminEmpty title="Runtime History 없음" description="0536 Session 이력 — 읽기 전용 분석 대상입니다." /> : (
          <div className="space-y-1">
            {sessions.slice(0, 30).map((s) => (
              <div key={s.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{s.runtime_session_code}</span>
                <AdminBadge tone={tone(s.session_status)}>{s.session_status}</AdminBadge>
                <span className="ml-2 text-muted-foreground">{s.result_verification_status} · {s.closure_status}</span>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'incidenthistory' && (
        !incidents.length ? <AdminEmpty title="Incident History 없음" description="0537 Incident Candidate 이력 — Candidate ≠ Confirmed Incident." /> : (
          <div className="space-y-1">
            {incidents.slice(0, 30).map((c) => (
              <div key={c.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{c.incident_code}</span>
                <AdminBadge tone={tone(c.incident_status)}>{c.incident_status}</AdminBadge>
                <AdminBadge tone="neutral">{c.incident_type}</AdminBadge>
                <span className="ml-2 text-muted-foreground">{c.resolution_status}</span>
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'postmortems' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <select value={selSess} onChange={(e) => setSelSess(e.target.value)} className="min-w-[180px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              <option value="">Session 선택</option>
              {sessions.map((s) => <option key={s.id} value={s.id}>{s.runtime_session_code}</option>)}
            </select>
            {reasonInput}
            {btn('Postmortem Draft 생성(초안)', () => {
              const r = needReason();
              if (!r) return;
              if (!selSess) { toast.error('Session 선택 필수'); return; }
              const inc = incidents.find((c) => c.runtime_session_id === selSess);
              void act(() => createRuntimePostmortem({ runtime_session_id: selSess, runtime_incident_candidate_id: inc?.id ?? null, incident_summary: r, evidence_summary: [r], unknown_factors: ['외부 요인 미검토'] }), 'Draft 생성(Draft ≠ Approved)');
            }, true)}
          </div>
          {!postmortems.length ? <AdminEmpty title="Postmortem 없음" description="AI 생성 Postmortem 은 초안이며 확정 Root Cause 가 아닙니다." /> : (
            <div className="space-y-1">
              {postmortems.slice(0, 30).map((p) => (
                <div key={p.id} className="rounded-lg border border-border p-2 text-[11px]">
                  <span className="font-mono font-bold">{p.postmortem_code}</span>
                  <AdminBadge tone={tone(p.postmortem_status)}>{p.postmortem_status}</AdminBadge>
                  <span className="ml-2 break-words">{p.incident_summary.slice(0, 80)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {tab === 'pendingpm' && (
        <div className="space-y-2">
          {postmortems.filter((p) => ['draft', 'pending_evidence', 'pending_review'].includes(p.postmortem_status)).map((p) => (
            <div key={p.id} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-mono font-bold">{p.postmortem_code}</span>
              <AdminBadge tone="warning">{p.postmortem_status}</AdminBadge>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            {pmSelect}{reasonInput}
            {btn('Review 시작', () => pmReview('start_review', {}, 'Review 시작'))}
            {btn('Evidence 요청', () => pmReview('request_evidence', {}, 'Evidence 요청'))}
            {btn('승인 Reference(Evidence 필수)', () => pmReview('approve', { evidence: [reason.trim()] }, '승인(≠ Policy 적용)'), true)}
            {btn('제한 포함 승인', () => pmReview('approve_with_limitation', { evidence: [reason.trim()], limitations: [reason.trim()] }, '제한 포함 승인'))}
            {btn('기각', () => pmReview('reject', {}, '기각'))}
            {btn('무효화', () => pmReview('invalidate', {}, '무효화'))}
          </div>
          <p className="text-[10px] text-muted-foreground">Evidence 없는 승인은 서버에서 차단 — approved_reference 는 Policy 적용/Root Cause 확정이 아닙니다.</p>
        </div>
      )}

      {tab === 'rootcauses' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {pmSelect}{reasonInput}
            {btn('Root Cause Candidate 기록', () => learnEvent('root_cause_candidate_recorded', { candidate_type: 'timeout_policy_candidate', evidence: [reason.trim()] }, 'Candidate 기록(≠ Confirmed)'), true)}
            {btn('Candidate Review 기록', () => learnEvent('root_cause_candidate_reviewed', { candidate_type: 'timeout_policy_candidate', evidence: [reason.trim()] }, 'Candidate 검토 기록'))}
            {btn('Confirm Reference(후보 검토+Evidence 선행 필수)', () => learnEvent('root_cause_confirmed_reference', { candidate_type: 'timeout_policy_candidate', evidence: [reason.trim()] }, '확정 Reference(책임자 지정 아님)'))}
          </div>
          {(() => {
            const rc = audit.filter((e) => e.event_type.startsWith('root_cause'));
            return !rc.length ? <AdminEmpty title="Root Cause Candidate 없음" description="Candidate ≠ Confirmed Root Cause · Correlation ≠ Causality." /> : (
              <div className="space-y-1">{rc.slice(0, 20).map((e) => <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]"><AdminBadge tone={e.event_type === 'root_cause_confirmed_reference' ? 'success' : 'warning'}>{e.event_type}</AdminBadge><span className="ml-2">{e.detail}</span></div>)}</div>
            );
          })()}
        </div>
      )}
      {tab === 'factors' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">{pmSelect}{reasonInput}
            {btn('Contributing Factor 기록', () => learnEvent('contributing_factor_recorded', { direction: 'supporting', evidence: [reason.trim()] }, 'Factor 기록(Factor ≠ Cause)'), true)}
          </div>
          <AdminAlert tone="info" description="방향/Evidence 결측 Factor 는 재정규화 없이 factor_unverified 로 유지됩니다." />
        </div>
      )}
      {tab === 'controlgaps' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">{pmSelect}{reasonInput}
            {btn('Control Gap 기록', () => learnEvent('control_gap_recorded', { control: 'timeout_control', result: 'control_weakness_candidate', evidence: [reason.trim()] }, 'Gap 기록(≠ 확정 취약점)'), true)}
          </div>
          {(() => {
            const gaps = audit.filter((e) => e.event_type === 'control_gap_recorded');
            return !gaps.length ? <AdminEmpty title="Control Gap 없음" description="Gap Candidate 는 보안 취약점 확정이 아닙니다." /> : (
              <div className="space-y-1">{gaps.slice(0, 20).map((e) => <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]"><AdminBadge tone="warning">gap</AdminBadge><span className="ml-2">{e.detail}</span></div>)}</div>
            );
          })()}
        </div>
      )}

      {tab === 'recurrence' && <PatternTab title="Recurrence Patterns" note="Pattern ≠ Root Cause · 표본 부족 시 sample_too_small, 오래된 데이터는 stale_input_candidate 로 유지되며 자동 확정하지 않습니다." events={audit.filter((e) => e.event_type === 'recurrence_pattern_detected')} extra={<div className="flex flex-wrap items-center gap-2">{pmSelect}{reasonInput}{btn('Recurrence Pattern 기록', () => learnEvent('recurrence_pattern_detected', { dimension: 'incident', evidence: [reason.trim()] }, 'Pattern 기록(≠ Root Cause)'), true)}</div>} />}
      {tab === 'connectorrisk' && <PatternTab title="Connector Risk Patterns" note="Connector Failure ≠ Provider Fault — 외부 Provider 장애 Feed 가 없어 Provider 귀책을 판정하지 않습니다." events={patternEvents('connector')} extra={null} />}
      {tab === 'automationrisk' && <PatternTab title="Automation Risk Patterns" note="Automation Failure ≠ Design Failure — 후보 기록만." events={patternEvents('automation')} extra={null} />}
      {tab === 'evidencegaps' && <PatternTab title="Evidence Gap Patterns" note="Missing Evidence ≠ Negligence — 수집 개선 제안 대상입니다." events={patternEvents('signal')} extra={null} />}
      {tab === 'reviewdelays' && <PatternTab title="Review Delay Patterns" note="Review Delay ≠ Reviewer Failure — SLA 원본이 없으면 임의 판정하지 않습니다." events={[]} extra={null} />}
      {tab === 'recoveryeffect' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <Box label="Resolved References(0537)" value={NUM(num('history_actuals', 'incidents_resolved_0537'))} />
            <Box label="Recovery Reviews" value={NUM(audit.filter((e) => e.event_type === 'recurrence_pattern_detected').length || null)} />
            <Box label="재발 데이터" value="recurrence_unverified" />
          </div>
          <AdminAlert tone="info" description="Resolution Reference ≠ Successful Recovery ≠ Outcome Achievement — 재발 관측 데이터가 없으면 recovery 효과를 판정하지 않습니다." />
        </div>
      )}

      {tab === 'corrective' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">{pmSelect}{reasonInput}
            {btn('Corrective Action 제안', () => learnEvent('corrective_action_proposed', { action_type: 'revise_timeout_policy', evidence: [reason.trim()] }, '제안 기록(≠ Applied Action)'), true)}
            {btn('제안 검토 기록', () => learnEvent('corrective_action_reviewed', { action_type: 'revise_timeout_policy', evidence: [reason.trim()] }, '검토 기록'))}
          </div>
          {(() => {
            const ca = audit.filter((e) => e.event_type.startsWith('corrective_action'));
            return !ca.length ? <AdminEmpty title="Corrective Action 없음" description="16종 whitelist — 자동 적용 없음." /> : (
              <div className="space-y-1">{ca.slice(0, 20).map((e) => <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]"><AdminBadge tone="info">{e.event_type}</AdminBadge><span className="ml-2">{e.detail}</span></div>)}</div>
            );
          })()}
        </div>
      )}
      {tab === 'preventive' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">{pmSelect}{reasonInput}
            {btn('Preventive Action 제안', () => learnEvent('preventive_action_proposed', { action_type: 'require_idempotency_proposal', evidence: [reason.trim()] }, '제안 기록(≠ Policy 변경)'), true)}
          </div>
          <AdminAlert tone="info" description="Preventive Action 은 Policy 변경이 아닙니다 — More Controls ≠ More Safety, 별도 Policy Proposal/승인 필요." />
        </div>
      )}

      {tab === 'policyproposals' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <select value={propDomain} onChange={(e) => setPropDomain(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {POLICY_DOMAINS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            {pmSelect}{reasonInput}
            {btn('Policy Proposal 생성(Evidence 필수)', () => {
              const r = needReason();
              if (!r) return;
              void act(() => createRuntimePolicyProposal({ policy_domain: propDomain, title: r.slice(0, 100), proposal_summary: r, evidence: [r], source_postmortem_id: selPm || null }), 'Proposal 생성(≠ Approval)');
            }, true)}
          </div>
          {!proposals.length ? <AdminEmpty title="Policy Proposal 없음" description="Proposal ≠ 적용된 Policy — 0512/0509/0510 원본은 변경되지 않습니다." /> : (
            <div className="space-y-1">
              {proposals.slice(0, 30).map((p) => (
                <div key={p.id} className="rounded-lg border border-border p-2 text-[11px]">
                  <span className="font-mono font-bold">{p.proposal_code}</span>
                  <AdminBadge tone={tone(p.proposal_status)}>{p.proposal_status}</AdminBadge>
                  <AdminBadge tone="neutral">{p.policy_domain}</AdminBadge>
                  <span className="ml-2 break-words">{p.title.slice(0, 60)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {tab === 'pendingpolicy' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {propSelect}{reasonInput}
            {btn('Review 시작', () => propReview('start_review', {}, 'Review 시작'))}
            {btn('승인 Reference(Evidence 필수)', () => propReview('approve', { evidence: [reason.trim()] }, '승인(approved ≠ applied)'), true)}
            {btn('제한 포함 승인', () => propReview('approve_with_limitation', { evidence: [reason.trim()] }, '제한 포함 승인'))}
            {btn('기각', () => propReview('reject', {}, '기각'))}
            {btn('무효화', () => propReview('invalidate', {}, '무효화'))}
          </div>
          <p className="text-[10px] text-muted-foreground">approved_reference ≠ applied — 승인돼도 실제 Policy/Threshold 는 변경되지 않습니다.</p>
        </div>
      )}
      {tab === 'approvedpolicies' && (() => {
        const approved = proposals.filter((p) => ['approved_reference', 'approved_with_limitation'].includes(p.proposal_status) || p.application_status !== 'not_requested');
        return !approved.length ? <AdminEmpty title="Approved Reference 없음" description="Approval ≠ Application ≠ Effectiveness." /> : (
          <div className="space-y-1">
            {approved.slice(0, 30).map((p) => (
              <div key={p.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono font-bold">{p.proposal_code}</span>
                <AdminBadge tone="success">{p.proposal_status}</AdminBadge>
                <AdminBadge tone={tone(p.application_status)}>{p.application_status}</AdminBadge>
              </div>
            ))}
          </div>
        );
      })()}
      {tab === 'versionrefs' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <Box label="Enterprise Policies(0512)" value={NUM(num('history_actuals', 'enterprise_policies_0512'))} />
            <Box label="Policy Versions(0512)" value={NUM(num('history_actuals', 'policy_versions_0512'))} />
            <Box label="Runtime 전용 Version Registry" value="없음(Reference 만)" />
          </div>
          <AdminAlert tone="info" description="Policy Versioning 은 ai_enterprise_policy_versions(0512 — policy_id+version unique·previous_version·checksum) 실존 구조를 읽기 전용 참조합니다. 본 계층은 원본 Policy 테이블을 자동 변경하지 않으며 Version Reference 만 기록합니다." />
        </div>
      )}
      {tab === 'application' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {propSelect}{reasonInput}
            {btn('Application Reference 기록(승인 선행 필수)', () => propReview('record_application_reference', { evidence: [reason.trim()] }, 'Reference 기록(≠ 적용 성공)'), true)}
            {btn('Application 검증(Evidence 필수)', () => propReview('verify_application', { evidence: [reason.trim()] }, '검증(Applied ≠ Effective)'))}
          </div>
          <p className="text-[10px] text-muted-foreground">승인 Reference 없는 Application 기록은 서버에서 차단(policy_approval_missing) — Application Reference ≠ 실제 적용 성공.</p>
        </div>
      )}
      {tab === 'effectiveness' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {propSelect}{reasonInput}
            {btn('Effectiveness Observation 시작', () => propReview('start_effectiveness_observation', { evidence: [reason.trim()] }, '관측 시작'), true)}
            {btn('관측 완료: effectiveness_candidate', () => propReview('complete_effectiveness_observation', { effectiveness: 'effectiveness_candidate', evidence: [reason.trim()] }, '효과성 후보(인과 아님)'))}
            {btn('causality_unverified', () => propReview('complete_effectiveness_observation', { effectiveness: 'causality_unverified', evidence: [reason.trim()] }, '인과 미검증 기록'))}
            {btn('no_material_change', () => propReview('complete_effectiveness_observation', { effectiveness: 'no_material_change_candidate', evidence: [reason.trim()] }, '변화 없음 기록'))}
          </div>
          <p className="text-[10px] text-muted-foreground">Applied Policy ≠ Effective Policy — 외부 요인 미검토 시 causality_unverified 유지, Threshold Change ≠ Risk Reduction.</p>
        </div>
      )}
      {tab === 'adverse' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">{propSelect}{reasonInput}
            {btn('Adverse Effect 후보 기록', () => propReview('record_adverse_effect', { evidence: [reason.trim()] }, 'Adverse 후보(자동 Rollback 없음)'), true)}
          </div>
          {(() => {
            const adv = proposals.filter((p) => p.effectiveness_status === 'adverse_effect_candidate');
            return !adv.length ? <AdminEmpty title="Adverse Effect 없음" description="후보 감지 — 자동 Rollback 없이 사람 검토 대상입니다." /> : (
              <div className="space-y-1">{adv.map((p) => <div key={p.id} className="rounded-lg border border-border p-2 text-[11px]"><span className="font-mono font-bold">{p.proposal_code}</span><AdminBadge tone="danger">adverse_effect_candidate</AdminBadge></div>)}</div>
            );
          })()}
        </div>
      )}
      {tab === 'orglearning' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <Box label="Org Learnings(0515)" value={NUM(num('history_actuals', 'org_learnings_0515'))} />
            <Box label="Decision Memory(0514)" value={NUM(num('history_actuals', 'decision_memory_0514'))} />
            <Box label="Learning References" value={NUM(num('learning_events', 'org_learning_refs'))} />
          </div>
          <div className="flex flex-wrap items-center gap-2">{pmSelect}{reasonInput}
            {btn('Learning Reference 기록(승인 Postmortem 필수)', () => learnEvent('organizational_learning_reference_recorded', { evidence: [reason.trim()] }, 'Reference 기록(원본 미변경)'), true)}
          </div>
          <p className="text-[10px] text-muted-foreground">승인된 Postmortem 없이는 서버가 차단(postmortem_approval_missing) — 원본 Decision Memory/Knowledge Graph 는 변경되지 않습니다.</p>
        </div>
      )}

      {tab === 'humanreviews' && (() => {
        const reviews = audit.filter((e) => ['postmortem_reviewed', 'postmortem_approved_reference', 'root_cause_candidate_reviewed', 'root_cause_confirmed_reference', 'policy_proposal_reviewed', 'policy_approval_reference_recorded', 'policy_application_verified_reference', 'runtime_learning_invalidated'].includes(e.event_type));
        return !reviews.length ? <AdminEmpty title="검토 이력 없음" description="Postmortem/Root Cause/Policy 검토는 전부 사람이 수행합니다." /> : (
          <div className="space-y-1">{reviews.slice(0, 40).map((e) => <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]"><AdminBadge tone="info">{e.event_type}</AdminBadge><span className="ml-2">{e.detail}</span></div>)}</div>
        );
      })()}
      {tab === 'recommendations' && (
        !recommendations.length ? <AdminEmpty title="권고 없음" description="Evidence 없는 권고는 생성되지 않습니다(insufficient_data)." /> : (
          <div className="space-y-1">
            {recommendations.map((r, i) => (
              <div key={i} className="rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone="info">{r.type}</AdminBadge>
                <span className="ml-2">{r.reason}</span>
                <p className="mt-1 text-[10px] text-muted-foreground">humanApprovalRequired · autoApplied=false · Proposal ≠ Approved Policy</p>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'timeline' && (
        <div className="space-y-1">
          {timeline.stages.map((s) => (
            <div key={s.stage} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={s.status === 'measured' ? 'info' : 'warning'}>{s.stage}</AdminBadge>
              <span className="ml-2">{s.count == null ? 'null(원본 없음)' : NUM(s.count)}</span>
              <span className="ml-2 text-muted-foreground">{s.source} · timelineIsNotCompletionClaim</span>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">History→Postmortem→Root Cause→Control Gap→Pattern→Corrective→Policy Proposal→Application→Effectiveness 9단계 실측 집계</p>
        </div>
      )}
      {tab === 'audit' && (
        !audit.length ? <AdminEmpty title="Audit 없음" description="Learning 활동이 이벤트로 남습니다(23종 whitelist)." /> : (
          <div className="space-y-1">
            {audit.slice(0, 60).map((e) => (
              <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-mono text-muted-foreground">{e.created_at.slice(0, 16).replace('T', ' ')}</span>
                <AdminBadge tone="neutral">{e.event_type}</AdminBadge>
                <span className="ml-2">{e.detail}</span>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'support' && (
        <div className="space-y-1">
          {RUNTIME_LEARNING_SUPPORT.map((s) => (
            <div key={s.key} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={s.status === 'fully_supported' ? 'success' : s.status === 'unsupported' ? 'danger' : 'warning'}>{s.status}</AdminBadge>
              <span className="ml-2 font-bold">{s.key}</span>
              <span className="ml-2 text-muted-foreground">{s.note}</span>
            </div>
          ))}
        </div>
      )}
      {tab === 'limitations' && (
        <div className="space-y-1">
          {LEARNING_COMPONENTS.map((c) => (
            <div key={c.key} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={c.available === true ? 'success' : c.available === false ? 'danger' : 'neutral'}>{c.available === true ? 'available_reference' : c.available === false ? 'unavailable' : 'unknown'}</AdminBadge>
              <span className="ml-2 font-bold">{c.key}</span>
              <span className="ml-2 text-muted-foreground">{c.note}</span>
            </div>
          ))}
          {KNOWN_LIMITATIONS.map((l, i) => (
            <div key={i} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone="warning">limitation</AdminBadge>
              <span className="ml-2">{l}</span>
            </div>
          ))}
        </div>
      )}
    </AdminCard>
  );
}

function PatternTab({ title, note, events, extra }: { title: string; note: string; events: { id: string; detail: string | null }[]; extra: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <AdminAlert tone="info" description={`${title} — ${note}`} />
      {extra}
      {!events.length ? <AdminEmpty title="Pattern 없음" description="표본/신선도 조건을 충족한 후보만 기록됩니다 — 자동 확정 없음." /> : (
        <div className="space-y-1">{events.slice(0, 20).map((e) => <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]"><AdminBadge tone="warning">pattern</AdminBadge><span className="ml-2">{e.detail}</span></div>)}</div>
      )}
    </div>
  );
}

function Box({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-2">
      <p className="text-[10px] font-bold text-muted-foreground">{label}</p>
      <p className="mt-0.5 break-words text-sm font-black">{value}</p>
    </div>
  );
}
