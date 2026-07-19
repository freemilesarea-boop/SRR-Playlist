/**
 * ExperimentCenterSection — Controlled A/B Test & Canary Validation
 * (Phase AI-EXPERIMENT-1).
 *
 * Treatment 는 Allowlist + 승인 + Running + Emergency Stop 비활성일 때만.
 * Global Rollout / Apply to All / Replace v1 / Weight Apply / Auto Expand 버튼은
 * 존재하지 않는다. Rollback Proposal approved 는 실행 후보 승인 기록일 뿐이다.
 *
 * 탭: Overview · Create · Detail(Allowlist/Assignment/Monitoring/Rollback) · Limitations.
 */
import { useCallback, useEffect, useState } from 'react';
import { FlaskConical, PlusCircle, FileSearch, ShieldAlert, RefreshCw, Inbox, Radio, Activity, ClipboardCheck } from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import {
  buildAiExperimentAssignments, createAiExperiment, fetchAiExperimentDetail, fetchAiExperiments,
  proposeAiExperimentRollback, setAiExperimentAllowlist, setAiExperimentEmergencyStop, setAiExperimentStatus,
  fetchAiExperimentInternalOverview, fetchAiExperimentRuntimeEvents, stopAiExperimentStore, resumeAiExperimentStore,
  generateAiExperimentMetricSnapshot, generateAiExperimentGuardrailSnapshot,
  createAiExperimentTestSession, fetchAiExperimentTestSessions, fetchAiExperimentTestSessionDetail,
  computeAiExperimentPromotionGate,
  type AiExpDetail, type AiExpListRow, type AiExpStatus,
  type AiExpInternalOverview, type AiExpRuntimeEvent,
  type AiExpTestSessionRow, type AiExpTestSessionDetail,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';
import { relativeTimeKo } from '@/lib/memberGrowth';
import { FIXED_EXPERIMENT_WARNING } from '@/lib/experimentIntel';
import { INTERNAL_RUNTIME_WARNING } from '@/lib/experimentRuntimeRouting';
import {
  evaluateReadinessGate, FIXED_EXECUTION_WARNING,
  type EnvironmentInput,
} from '@/lib/experimentExecutionReadiness';

// 사전 환경 감사(읽기 전용, 증거 기반): SRR Supabase 프로젝트는 Production 1개뿐이고
// 개발 브랜치가 없어 Vercel Preview 앱이 Production DB 에 연결된다. Production migration
// 이력은 0453 에서 종료(0565~0571 미적용). → Live 실행 최종 Decision = NO-GO.
const AUDITED_ENVIRONMENT: EnvironmentInput = {
  previewConnectedToProduction: true,
  isolatedTestDb: false,
  isolatedPreviewDb: false,
  migrationStatus: 'not_applied',
  missingTables: ['ai_recommendation_experiments', 'ai_experiment_runtime_events', 'ai_experiment_test_sessions'],
  missingAdminRpcs: ['admin_ai_exp_create'],
  missingRuntimeRpcs: ['experiment_treatment_gate', 'experiment_treatment_recommend'],
  testStoreConfirmed: false,
  emergencyStopTestable: false,
};

const NUM = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('ko-KR'));

type Tab = 'overview' | 'create' | 'detail' | 'runtime' | 'execution' | 'limits';
const TABS: { key: Tab; label: string; icon: typeof FlaskConical }[] = [
  { key: 'overview', label: 'Overview', icon: FlaskConical },
  { key: 'create', label: 'Create', icon: PlusCircle },
  { key: 'detail', label: 'Detail', icon: FileSearch },
  { key: 'runtime', label: 'Internal Runtime', icon: Radio },
  { key: 'execution', label: 'Execution Validation', icon: ClipboardCheck },
  { key: 'limits', label: 'Limitations', icon: ShieldAlert },
];

const STATUS_TONE: Record<AiExpStatus, 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  draft: 'neutral', ready_for_review: 'info', approved: 'success', scheduled: 'info', running: 'primary',
  paused: 'warning', stopped: 'danger', completed: 'success', rejected: 'danger', archived: 'neutral',
};

const KNOWN_LIMITATIONS = [
  '이 실험은 허용된 Store에만 적용됩니다 — 일반 Store는 Assignment가 없으면 기존 v1/기존 재생 그대로이며 어떤 기록도 남기지 않습니다.',
  'Approved/성공 판정은 Recommendation v2의 전체 Production 적용이 아니며, promote_candidate는 더 제한된 다음 단계 후보를 뜻합니다.',
  'Variant는 서버(md5 bucket)가 결정하고 sticky 저장됩니다 — 클라이언트는 Variant를 지정할 수 없습니다.',
  'Stage 0(Event Emission)은 스케줄러 setQueue 직후 fire-and-forget 1지점만 배선했으며, Event 실패는 Playback에 전파되지 않습니다(재시도 1회 상한).',
  'Stage 2(internal_test) Treatment는 스케줄러 setQueue 직전 1지점에 Fail-Closed 라우팅으로 배선했습니다 — 승인된 Allowlist Store만 v2 Runtime 순서를 사용하고, Gate/Timeout/무효 Queue는 항상 Control(v1)로 회귀합니다. Stage 3(Canary) 외부 Store 라우팅은 별도 Phase입니다.',
  'Emergency Stop은 신규 Treatment 라우팅 중지 신호입니다 — 재생 중 Track 중단/Queue 삭제/Weight 변경이 아닙니다.',
  'SRM 감지 또는 Blocking Guardrail 위반 상태에서는 continue/promote 결정을 서버가 기록 거부합니다.',
  'Sample/기간 부족 상태에서 승자를 선언하지 않으며(CI 기반 유의성 필수), Shadow 결과는 실제 Treatment 결과로 기록되지 않습니다.',
  'Rollback Proposal approved는 자동 Rollback 실행이 아니라 관리자 실행 후보 승인 기록입니다.',
  '이 UI는 브라우저에서 직접 검증되지 않았습니다. Migration 0565~0571은 Production 미적용이며 실제 내부 테스트는 아직 실행되지 않았습니다(Runtime Route/Exposure/Attribution/모든 지표 0/not_run).',
  '사전 환경 감사(증거 기반): SRR Supabase는 Production 프로젝트 1개뿐·개발 브랜치 없음 → Vercel Preview 앱이 Production DB에 연결되고 격리 Test/Preview DB가 없어, AI-EXPERIMENT-3 Live 실행 최종 Decision은 NO-GO입니다. 실제 Treatment·Migration Apply·브라우저 재생 검증을 수행하지 않았습니다. Execution Validation 탭은 격리 Test DB 확보 시 사용할 증거 기록/Promotion Gate 프레임워크입니다.',
  'Store별 Emergency Stop은 다음 추천 요청부터 Control로 회귀시키는 신호이며, 현재 재생 중인 Track을 강제 중단하거나 Queue를 삭제하지 않습니다. 재활성화는 명시적 관리자 승인만 가능합니다.',
];

function Box({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-bg-deep px-3 py-2">
      <div className="text-[10px] text-ink-mute">{label}</div>
      <div className="text-sm font-semibold text-ink">{value}</div>
      {hint ? <div className="text-[10px] text-ink-mute">{hint}</div> : null}
    </div>
  );
}

export default function ExperimentCenterSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [experiments, setExperiments] = useState<AiExpListRow[] | null>(null);
  const [detail, setDetail] = useState<AiExpDetail | null>(null);
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [allowStoreId, setAllowStoreId] = useState('');
  const [nowMs] = useState(() => Date.now());

  // Create 설정
  const [name, setName] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [stage, setStage] = useState('shadow_assignment');
  const [ratioPct, setRatioPct] = useState(50);
  const [seed, setSeed] = useState(1);

  // Internal Runtime 탭
  const [rtOverview, setRtOverview] = useState<AiExpInternalOverview | null>(null);
  const [rtEvents, setRtEvents] = useState<AiExpRuntimeEvent[] | null>(null);
  const [rtStoreId, setRtStoreId] = useState('');

  // Execution Validation 탭
  const [sessions, setSessions] = useState<AiExpTestSessionRow[] | null>(null);
  const [sessionDetail, setSessionDetail] = useState<AiExpTestSessionDetail | null>(null);
  const readiness = evaluateReadinessGate(AUDITED_ENVIRONMENT);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setExperiments(await fetchAiExperiments(null, 100)); }
    catch (e) { setErr(classifyAdminError(e)); setExperiments(null); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const create = useCallback(async () => {
    if (!name.trim()) { toast.error('이름을 입력하세요.'); return; }
    setBusy(true);
    try {
      const d = await createAiExperiment({
        name: name.trim(), hypothesis: hypothesis.trim(), stage,
        allocation_ratio: ratioPct / 100, seed,
        guardrail_config: {
          blocking: ['hard_policy_violation', 'playback_start_failure', 'queue_empty', 'srm', 'attribution_rate', 'event_loss'],
          warning: ['skip_rate', 'store_fit', 'artist_concentration'],
        },
      });
      toast.success('Experiment Draft 생성(Treatment 활성화 아님 — 승인/Allowlist/Start 필요).');
      setDetail(d); setTab('detail'); await load();
    } catch (e) { toast.error(`생성 실패: ${friendlyError(e, '0569 미적용일 수 있음')}`); }
    finally { setBusy(false); }
  }, [name, hypothesis, stage, ratioPct, seed, load]);

  const openDetail = useCallback(async (id: string) => {
    setBusy(true);
    try { setDetail(await fetchAiExperimentDetail(id)); setTab('detail'); }
    catch (e) { toast.error(friendlyError(e, '')); }
    finally { setBusy(false); }
  }, []);

  const act = useCallback(async (fn: () => Promise<AiExpDetail>, ok: string) => {
    setBusy(true);
    try { const d = await fn(); setDetail(d); toast.success(ok); await load(); }
    catch (e) { toast.error(friendlyError(e, '서버 게이트(승인/Allowlist/근거)가 거부할 수 있습니다')); }
    finally { setBusy(false); }
  }, [load]);

  const loadRuntime = useCallback(async (id: string) => {
    setBusy(true);
    try {
      const [ov, ev] = await Promise.all([fetchAiExperimentInternalOverview(id), fetchAiExperimentRuntimeEvents(id, 100)]);
      setRtOverview(ov); setRtEvents(ev);
    } catch (e) { toast.error(friendlyError(e, '0570 미적용일 수 있음')); setRtOverview(null); setRtEvents(null); }
    finally { setBusy(false); }
  }, []);

  const runtimeAct = useCallback(async (fn: () => Promise<unknown>, ok: string, id: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); await loadRuntime(id); }
    catch (e) { toast.error(friendlyError(e, '서버 게이트/사유가 거부할 수 있습니다')); }
    finally { setBusy(false); }
  }, [loadRuntime]);

  const loadSessions = useCallback(async () => {
    setBusy(true);
    try { setSessions(await fetchAiExperimentTestSessions(null, 50)); }
    catch (e) { toast.error(friendlyError(e, '0571 미적용 — Test Session 테이블 부재')); setSessions(null); }
    finally { setBusy(false); }
  }, []);

  const openSession = useCallback(async (id: string) => {
    setBusy(true);
    try { setSessionDetail(await fetchAiExperimentTestSessionDetail(id)); }
    catch (e) { toast.error(friendlyError(e, '0571 미적용일 수 있음')); }
    finally { setBusy(false); }
  }, []);

  return (
    <AdminCard title="Experiment Center" subtitle="AI-EXPERIMENT-1 — Controlled A/B & Canary (Allowlist 한정 · Global Rollout 없음)">
      <AdminAlert tone="info">{FIXED_EXPERIMENT_WARNING}</AdminAlert>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${tab === t.key ? 'bg-accent text-black' : 'bg-bg-deep text-ink-mute hover:text-ink'}`}>
            <t.icon className="mr-1 inline h-3 w-3" />{t.label}
          </button>
        ))}
        <button type="button" onClick={() => void load()} disabled={loading || busy}
          className="ml-auto rounded-full bg-bg-deep px-2.5 py-1 text-[11px] text-ink-mute hover:text-ink disabled:opacity-50">
          <RefreshCw className={`mr-1 inline h-3 w-3 ${loading ? 'animate-spin' : ''}`} />새로고침
        </button>
      </div>

      {err ? (
        <div className="mt-3">
          <AdminAlert tone="danger">불러오기 실패: {err.message}</AdminAlert>
          <button type="button" onClick={() => void load()} className="mt-2 rounded bg-bg-deep px-3 py-1.5 text-xs text-ink">다시 시도</button>
        </div>
      ) : null}

      {tab === 'overview' ? (
        <div className="mt-3 space-y-2 text-[11px]">
          {!loading && experiments && experiments.length === 0 ? (
            <AdminEmpty icon={<Inbox size={24} />} title="Experiment 없음" description="실험이 아직 없습니다(0569 미적용 환경에서도 비어 있습니다). 실제 실험은 실행된 적이 없습니다." />
          ) : null}
          {experiments?.map((e) => (
            <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-bg-deep px-3 py-2">
              <div>
                <div className="font-semibold text-ink">
                  {e.name} <AdminBadge tone={STATUS_TONE[e.status]}>{e.status}</AdminBadge>
                  <AdminBadge tone="neutral">{e.stage}</AdminBadge>
                  {e.emergency_stop ? <AdminBadge tone="danger">EMERGENCY STOP</AdminBadge> : null}
                </div>
                <div className="text-ink-mute">
                  {e.primary_metric} · 배분 {Math.round(e.allocation_ratio * 100)}% · Allowlist {NUM(e.allowlist_count)} · Assignment {NUM(e.assignment_count)} · Exposure {NUM(e.exposure_count)}
                  · {e.decision ?? '결정 없음'} · {relativeTimeKo(e.created_at, nowMs)}
                </div>
              </div>
              <button type="button" onClick={() => void openDetail(e.id)} disabled={busy} className="rounded bg-black/20 px-2 py-1 text-ink hover:text-white disabled:opacity-50">상세</button>
            </div>
          ))}
        </div>
      ) : null}

      {tab === 'create' ? (
        <div className="mt-3 space-y-3 text-[11px]">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <label className="text-ink-mute">이름
              <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded bg-bg-deep px-2 py-1.5 text-xs text-ink" />
            </label>
            <label className="text-ink-mute">Stage
              <select value={stage} onChange={(e) => setStage(e.target.value)} className="mt-1 w-full rounded bg-bg-deep px-2 py-1.5 text-xs text-ink">
                {['event_emission_only', 'shadow_assignment', 'internal_test', 'canary'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="text-ink-mute">Treatment 배분 %(10~90)
              <input type="number" min={10} max={90} value={ratioPct} onChange={(e) => setRatioPct(Math.max(10, Math.min(90, Number(e.target.value) || 50)))} className="mt-1 w-full rounded bg-bg-deep px-2 py-1.5 text-xs text-ink" />
            </label>
            <label className="text-ink-mute">Seed
              <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 1)} className="mt-1 w-full rounded bg-bg-deep px-2 py-1.5 text-xs text-ink" />
            </label>
            <label className="col-span-2 text-ink-mute md:col-span-4">Hypothesis
              <input value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} placeholder="예: v2는 카페 매장에서 유효 완청률을 개선한다" className="mt-1 w-full rounded bg-bg-deep px-2 py-1.5 text-xs text-ink" />
            </label>
          </div>
          <p className="text-ink-mute">Primary Metric: valid_completion_rate(생성 후 변경 금지) · limited Stage는 이번 Phase에서 생성 대상이 아닙니다.</p>
          <button type="button" onClick={() => void create()} disabled={busy}
            className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50">
            Experiment Draft 생성(Treatment 미활성)
          </button>
        </div>
      ) : null}

      {tab === 'detail' ? (
        detail ? (
          <div className="mt-3 space-y-2 text-[11px]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-ink">{detail.experiment.name}</span>
              <AdminBadge tone={STATUS_TONE[detail.experiment.status]}>{detail.experiment.status}</AdminBadge>
              <AdminBadge tone="neutral">{detail.experiment.stage}</AdminBadge>
              {detail.experiment.emergency_stop ? <AdminBadge tone="danger">EMERGENCY STOP</AdminBadge> : null}
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
              <Box label="Control" value={detail.experiment.control_algorithm_version} hint={detail.experiment.control_weight_version} />
              <Box label="Treatment" value={detail.experiment.treatment_algorithm_version} hint={detail.experiment.treatment_weight_version} />
              <Box label="배분/Seed" value={`${Math.round(detail.experiment.allocation_ratio * 100)}% · ${detail.experiment.seed}`} hint={detail.experiment.assignment_version} />
              <Box label="최소 기준" value={`노출 ${detail.experiment.minimum_exposure} · 결과 ${detail.experiment.minimum_valid_outcomes}`} hint={`기간 ${detail.experiment.minimum_duration_hours}h+`} />
              <Box label="Decision" value={detail.experiment.decision ?? '—'} hint={detail.experiment.quality_grade ?? undefined} />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {detail.experiment.status === 'draft' ? (
                <button type="button" onClick={() => void act(() => setAiExperimentStatus(detail.experiment.id, 'ready_for_review'), '검토 요청')} disabled={busy} className="rounded bg-bg-deep px-2.5 py-1 text-ink disabled:opacity-50">Review Ready</button>
              ) : null}
              {detail.experiment.status === 'ready_for_review' ? (
                <button type="button" onClick={() => void act(() => setAiExperimentStatus(detail.experiment.id, 'approved'), '승인 기록(시작 아님)')} disabled={busy} className="rounded bg-bg-deep px-2.5 py-1 text-emerald-300 disabled:opacity-50">Approve</button>
              ) : null}
              {['approved', 'scheduled'].includes(detail.experiment.status) ? (
                <>
                  <button type="button" onClick={() => void act(() => buildAiExperimentAssignments(detail.experiment.id), '결정론 Assignment 생성(sticky)')} disabled={busy} className="rounded bg-bg-deep px-2.5 py-1 text-ink disabled:opacity-50">Assignment 생성</button>
                  <button type="button" onClick={() => void act(() => setAiExperimentStatus(detail.experiment.id, 'running'), 'Start — Allowlist 게이트 통과 시에만')} disabled={busy} className="rounded bg-bg-deep px-2.5 py-1 text-primary disabled:opacity-50">Start</button>
                </>
              ) : null}
              {detail.experiment.status === 'running' ? (
                <>
                  <button type="button" onClick={() => { if (!reason.trim()) { toast.error('사유를 입력하세요.'); return; } void act(() => setAiExperimentStatus(detail.experiment.id, 'paused', reason.trim()), 'Paused'); }} disabled={busy} className="rounded bg-bg-deep px-2.5 py-1 text-amber-300 disabled:opacity-50">Pause</button>
                  <button type="button" onClick={() => { if (!reason.trim()) { toast.error('사유를 입력하세요.'); return; } void act(() => setAiExperimentStatus(detail.experiment.id, 'stopped', reason.trim()), 'Stopped'); }} disabled={busy} className="rounded bg-bg-deep px-2.5 py-1 text-red-300 disabled:opacity-50">Stop</button>
                </>
              ) : null}
              {detail.experiment.status === 'paused' ? (
                <button type="button" onClick={() => void act(() => setAiExperimentStatus(detail.experiment.id, 'running'), 'Resumed')} disabled={busy} className="rounded bg-bg-deep px-2.5 py-1 text-ink disabled:opacity-50">Resume</button>
              ) : null}
              <button type="button" onClick={() => { if (!reason.trim()) { toast.error('사유를 입력하세요.'); return; } void act(() => setAiExperimentEmergencyStop(detail.experiment.id, !detail.experiment.emergency_stop, reason.trim()), 'Emergency Stop 상태 변경(라우팅 중지 신호)'); }} disabled={busy} className="rounded bg-bg-deep px-2.5 py-1 text-red-300 disabled:opacity-50">
                Emergency Stop {detail.experiment.emergency_stop ? '해제' : '활성'}
              </button>
              <button type="button" onClick={() => { if (!reason.trim()) { toast.error('사유를 입력하세요.'); return; } void act(() => proposeAiExperimentRollback(detail.experiment.id, { trigger_reason: reason.trim(), recommended_action: 'pause' }), 'Rollback Proposal 생성(자동 실행 없음)'); }} disabled={busy} className="rounded bg-bg-deep px-2.5 py-1 text-ink-mute disabled:opacity-50">Rollback 제안</button>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(필수 액션용)" className="rounded bg-bg-deep px-2 py-1 text-ink" />
            </div>

            <div className="rounded-lg bg-bg-deep p-3">
              <div className="mb-1 font-semibold text-ink">Store Allowlist ({detail.allowlist.filter((w) => w.status === 'active').length} active)</div>
              <div className="flex items-center gap-2">
                <input value={allowStoreId} onChange={(e) => setAllowStoreId(e.target.value)} placeholder="Store UUID" className="w-72 rounded bg-black/30 px-2 py-1 text-ink" />
                <button type="button" onClick={() => { if (!allowStoreId.trim()) { toast.error('Store ID를 입력하세요.'); return; } void act(() => setAiExperimentAllowlist(detail.experiment.id, allowStoreId.trim(), { action: 'add', allowed_stage: detail.experiment.stage, approval_reason: reason.trim() || 'admin add' }), 'Allowlist 추가'); }} disabled={busy} className="rounded bg-black/20 px-2 py-1 text-ink disabled:opacity-50">추가</button>
              </div>
              {detail.allowlist.map((w) => (
                <div key={w.store_id} className="mt-1 flex justify-between text-ink-mute">
                  <span>{w.store_id} · {w.allowed_stage} · {w.status}</span>
                  <button type="button" onClick={() => void act(() => setAiExperimentAllowlist(detail.experiment.id, w.store_id, { action: 'remove' }), 'Allowlist 제거')} disabled={busy} className="text-red-300 disabled:opacity-50">제거</button>
                </div>
              ))}
              {detail.allowlist.length === 0 ? <p className="text-ink-mute">Allowlist 없음 — internal_test 이상은 Start가 서버에서 차단됩니다.</p> : null}
            </div>

            <div className="rounded-lg bg-bg-deep p-3">
              <div className="mb-1 font-semibold text-ink">Assignments ({detail.assignments.length})</div>
              {detail.assignments.map((a) => (
                <div key={a.store_id} className="text-ink-mute">
                  {a.store_id} → <span className={a.variant === 'treatment' ? 'text-amber-300' : a.variant === 'shadow_treatment' ? 'text-sky-300' : 'text-ink'}>{a.variant}</span> · {a.status} · {relativeTimeKo(a.assigned_at, nowMs)}
                </div>
              ))}
              {detail.assignments.length === 0 ? <p className="text-ink-mute">Assignment 없음(결정론 생성은 승인 후 가능 · 일반 Store는 대상이 아님).</p> : null}
            </div>

            <div className="rounded-lg bg-bg-deep p-3">
              <div className="mb-1 font-semibold text-ink">Monitoring / Snapshots ({detail.snapshots.length})</div>
              {detail.snapshots.length === 0 ? (
                <p className="text-ink-mute">Snapshot 없음 — 실제 실험이 실행된 적이 없어 Exposure/Outcome/SRM/Guardrail 지표는 전부 0/not_run 입니다(정직 보고).</p>
              ) : detail.snapshots.map((s, i) => (
                <div key={i} className="text-ink-mute">{String(s.window_start)} ~ {String(s.window_end)} · decision {String(s.decision ?? '—')} · grade {String(s.quality_grade ?? '—')}</div>
              ))}
            </div>

            <div className="rounded-lg bg-bg-deep p-2">
              <div className="mb-1 font-semibold text-ink">Audit</div>
              {detail.events.map((e, i) => (
                <div key={i} className="text-ink-mute">
                  {relativeTimeKo(e.created_at, nowMs)} · {e.event_type}{e.previous_status ? ` (${e.previous_status}→${e.next_status})` : ''} · {e.actor_name ?? 'system'}{e.reason ? ` · ${e.reason}` : ''}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-3"><AdminEmpty icon={<FileSearch size={24} />} title="선택된 Experiment 없음" description="Overview에서 상세를 열어주세요." /></div>
        )
      ) : null}

      {tab === 'runtime' ? (
        <div className="mt-3 space-y-2 text-[11px]">
          <AdminAlert tone="warning">{INTERNAL_RUNTIME_WARNING}</AdminAlert>
          {!detail ? (
            <AdminEmpty icon={<Radio size={24} />} title="Experiment 미선택" description="Overview/Detail에서 실험을 먼저 열고 Internal Runtime을 조회하세요." />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-ink">{detail.experiment.name}</span>
                <AdminBadge tone={STATUS_TONE[detail.experiment.status]}>{detail.experiment.status}</AdminBadge>
                <AdminBadge tone="neutral">{detail.experiment.stage}</AdminBadge>
                <button type="button" onClick={() => void loadRuntime(detail.experiment.id)} disabled={busy}
                  className="ml-auto rounded bg-bg-deep px-2.5 py-1 text-ink-mute hover:text-ink disabled:opacity-50">
                  <Activity className="mr-1 inline h-3 w-3" />Runtime 조회
                </button>
              </div>

              {/* Internal Test Overview */}
              {rtOverview ? (
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <Box label="Allowlist(active)" value={NUM(rtOverview.allowlist_count)} />
                  <Box label="Control / Treatment Store" value={`${NUM(rtOverview.control_stores)} / ${NUM(rtOverview.treatment_stores)}`} hint={`상한 ${2}`} />
                  <Box label="Runtime Route" value={`T ${NUM(rtOverview.runtime_totals.treatment)} · FB ${NUM(rtOverview.runtime_totals.fallback_control)}`} hint={`total ${NUM(rtOverview.runtime_totals.total)}`} />
                  <Box label="Exposure(C/T)" value={`${NUM(rtOverview.exposure_totals.control)} / ${NUM(rtOverview.exposure_totals.treatment)}`} hint={`fallback ${NUM(rtOverview.exposure_totals.fallback)}`} />
                </div>
              ) : (
                <p className="text-ink-mute">Runtime 조회를 눌러 Internal Overview를 불러오세요. 실제 Internal Test 미실행 시 모든 값은 0입니다(정직 보고).</p>
              )}

              {/* Snapshot 생성 */}
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => void runtimeAct(() => generateAiExperimentMetricSnapshot(detail.experiment.id), 'Metric Snapshot 생성(표본 부족 시 insufficient_data)', detail.experiment.id)} disabled={busy} className="rounded bg-bg-deep px-2.5 py-1 text-ink disabled:opacity-50">Metric Snapshot 생성</button>
                <button type="button" onClick={() => void runtimeAct(() => generateAiExperimentGuardrailSnapshot(detail.experiment.id), 'Guardrail Snapshot 생성(Blocking 시 Pause 제안만)', detail.experiment.id)} disabled={busy} className="rounded bg-bg-deep px-2.5 py-1 text-ink disabled:opacity-50">Guardrail Snapshot 생성</button>
              </div>

              {/* Store Controls */}
              <div className="rounded-lg bg-bg-deep p-3">
                <div className="mb-1 font-semibold text-ink">Store Controls (Store별 Emergency Stop — 재생 Track 강제 중단 없음)</div>
                <div className="flex items-center gap-2">
                  <input value={rtStoreId} onChange={(e) => setRtStoreId(e.target.value)} placeholder="Store UUID" className="w-72 rounded bg-black/30 px-2 py-1 text-ink" />
                  <button type="button" onClick={() => { if (!rtStoreId.trim() || !reason.trim()) { toast.error('Store ID와 사유를 입력하세요.'); return; } void runtimeAct(() => stopAiExperimentStore(detail.experiment.id, rtStoreId.trim(), reason.trim()), 'Store Stop(다음 요청부터 Control)', detail.experiment.id); }} disabled={busy} className="rounded bg-black/20 px-2 py-1 text-red-300 disabled:opacity-50">Store Stop</button>
                  <button type="button" onClick={() => { if (!rtStoreId.trim() || !reason.trim()) { toast.error('Store ID와 사유를 입력하세요.'); return; } void runtimeAct(() => resumeAiExperimentStore(detail.experiment.id, rtStoreId.trim(), reason.trim()), 'Store Resume(명시 승인)', detail.experiment.id); }} disabled={busy} className="rounded bg-black/20 px-2 py-1 text-ink disabled:opacity-50">Store Resume</button>
                </div>
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(필수)" className="mt-1 w-full rounded bg-black/30 px-2 py-1 text-ink" />
                {rtOverview && rtOverview.store_stops.length > 0 ? rtOverview.store_stops.map((s) => (
                  <div key={s.store_id} className="mt-1 text-ink-mute">{s.store_id} · <span className={s.status === 'stopped' ? 'text-red-300' : 'text-ink'}>{s.status}</span> · {s.reason} · {relativeTimeKo(s.stopped_at, nowMs)}</div>
                )) : <p className="mt-1 text-ink-mute">Store Stop 없음.</p>}
              </div>

              {/* Runtime Monitor */}
              <div className="rounded-lg bg-bg-deep p-3">
                <div className="mb-1 font-semibold text-ink">Runtime Monitor / Queue Validation ({rtEvents?.length ?? 0})</div>
                {rtEvents == null ? (
                  <p className="text-ink-mute">Runtime 조회를 눌러 이벤트를 불러오세요.</p>
                ) : rtEvents.length === 0 ? (
                  <p className="text-ink-mute">Runtime Event 없음 — 실제 내부 테스트가 실행되지 않았습니다(route/fallback/attribution 전부 not_run).</p>
                ) : rtEvents.map((ev) => (
                  <div key={ev.id} className="mt-1 flex flex-wrap items-center gap-1.5 text-ink-mute">
                    <AdminBadge tone={ev.route === 'treatment' ? 'primary' : ev.route === 'fallback_control' ? 'warning' : 'neutral'}>{ev.route}</AdminBadge>
                    {ev.fallback_reason ? <span className="text-amber-300">{ev.fallback_reason}</span> : null}
                    <span>· {ev.algorithm_version ?? '—'} / {ev.weight_version ?? '—'}</span>
                    <span>· contract {ev.queue_contract_valid == null ? '—' : ev.queue_contract_valid ? 'valid' : 'invalid'}</span>
                    <span>· n={NUM(ev.result_count)}</span>
                    {ev.treatment_duration_ms != null ? <span>· {ev.treatment_duration_ms}ms</span> : null}
                    <span>· {relativeTimeKo(ev.occurred_at, nowMs)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      ) : null}

      {tab === 'execution' ? (
        <div className="mt-3 space-y-2 text-[11px]">
          <AdminAlert tone="warning">{FIXED_EXECUTION_WARNING}</AdminAlert>

          {/* Environment Readiness — 증거 기반 사전 감사 결과 */}
          <div className="rounded-lg bg-bg-deep p-3">
            <div className="mb-1 flex items-center gap-2 font-semibold text-ink">
              Environment Readiness
              <AdminBadge tone={readiness.ready ? 'success' : 'danger'}>
                {readiness.environment.toUpperCase()}
              </AdminBadge>
              <AdminBadge tone="neutral">{readiness.isolation}</AdminBadge>
            </div>
            {!readiness.ready ? (
              <AdminAlert tone="danger">
                Live 실행 최종 Decision = <strong>NO-GO</strong>. 사전 환경 감사 결과 SRR Supabase는 Production 프로젝트 1개뿐이고 개발 브랜치가 없어
                Vercel Preview 앱이 Production DB에 연결되며(격리 Test/Preview DB 없음), Production migration은 0453에서 종료(0565~0571 미적용)입니다.
                따라서 실제 Treatment·Migration Apply·브라우저 재생 검증을 수행하지 않았고, 관련 항목은 전부 not_run 입니다.
              </AdminAlert>
            ) : null}
            <div className="mt-1 grid grid-cols-2 gap-2 md:grid-cols-4">
              <Box label="DB Isolation" value={readiness.isolation} />
              <Box label="Migration" value={AUDITED_ENVIRONMENT.migrationStatus} />
              <Box label="Required RPC" value={AUDITED_ENVIRONMENT.missingRuntimeRpcs.length === 0 ? 'present' : 'missing'} hint={`runtime ${AUDITED_ENVIRONMENT.missingRuntimeRpcs.length} missing`} />
              <Box label="Test Store" value={AUDITED_ENVIRONMENT.testStoreConfirmed ? 'confirmed' : 'unconfirmed'} />
            </div>
            <div className="mt-1 text-ink-mute">Blockers: {readiness.blockers.join(', ') || '없음'}</div>
          </div>

          {/* Test Session 목록 — 증거 기록 인프라(격리 DB 확보 시 사용) */}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void loadSessions()} disabled={busy} className="rounded bg-bg-deep px-2.5 py-1 text-ink-mute hover:text-ink disabled:opacity-50">
              <Activity className="mr-1 inline h-3 w-3" />Test Session 조회
            </button>
            <button type="button" disabled={busy || !detail}
              onClick={() => {
                if (!detail) { toast.error('Detail에서 실험을 먼저 여세요.'); return; }
                void (async () => {
                  try {
                    const r = await createAiExperimentTestSession({
                      experiment_id: detail.experiment.id,
                      environment_status: readiness.environment, db_isolation: readiness.isolation,
                      migration_status: AUDITED_ENVIRONMENT.migrationStatus, operator: 'admin',
                    });
                    toast.success('Test Session 생성'); await openSession(r.session_id); await loadSessions();
                  } catch (e) { toast.error(friendlyError(e, '0571 미적용 — 격리 Test DB에서만 기록 가능')); }
                })();
              }}
              className="rounded bg-bg-deep px-2.5 py-1 text-ink disabled:opacity-50">Test Session 생성</button>
          </div>

          {sessions == null ? (
            <p className="text-ink-mute">Test Session 조회를 눌러 목록을 불러오세요. 실제 내부 테스트 미실행 + 0571 미적용으로 목록은 비어 있습니다(정직 보고).</p>
          ) : sessions.length === 0 ? (
            <AdminEmpty icon={<ClipboardCheck size={24} />} title="Test Session 없음" description="격리 Test/Preview DB 확보 전에는 실제 실행 증거가 없습니다." />
          ) : (
            <div className="rounded-lg bg-bg-deep p-2">
              {sessions.map((s) => (
                <div key={s.id} className="flex items-center justify-between text-ink-mute">
                  <span>{s.environment_status} · {s.db_isolation} · {s.final_decision ?? '—'} · {relativeTimeKo(s.created_at, nowMs)}</span>
                  <button type="button" onClick={() => void openSession(s.id)} disabled={busy} className="text-ink hover:underline disabled:opacity-50">열기</button>
                </div>
              ))}
            </div>
          )}

          {/* Session Detail — Execution Checks + Promotion Gate */}
          {sessionDetail ? (
            <div className="rounded-lg bg-bg-deep p-3">
              <div className="mb-1 font-semibold text-ink">
                Session {sessionDetail.session.id.slice(0, 8)} · Decision {sessionDetail.session.final_decision ?? '—'}
              </div>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <Box label="Pass" value={NUM(sessionDetail.check_summary.pass)} />
                <Box label="Fail" value={NUM(sessionDetail.check_summary.fail)} />
                <Box label="Not Run" value={NUM(sessionDetail.check_summary.not_run)} />
                <Box label="Insufficient" value={NUM(sessionDetail.check_summary.insufficient_data)} />
              </div>
              {sessionDetail.checks.length === 0 ? (
                <p className="mt-1 text-ink-mute">Execution Check 없음 — 증거 없는 항목은 PASS로 승격되지 않습니다(not_run).</p>
              ) : sessionDetail.checks.map((c) => (
                <div key={c.id} className="mt-1 flex flex-wrap items-center gap-1.5 text-ink-mute">
                  <AdminBadge tone={c.status === 'pass' ? 'success' : c.status === 'fail' ? 'danger' : 'neutral'}>{c.status}</AdminBadge>
                  <span>{c.category} · {c.check_key}</span>
                  <span>· {c.evidence_type}{c.evidence_summary ? ` (${c.evidence_summary})` : ''}</span>
                </div>
              ))}
              <button type="button" disabled={busy}
                onClick={() => void (async () => {
                  try { await computeAiExperimentPromotionGate(sessionDetail.session.id, 'NO_GO', '환경 미격리(Preview→Production DB) — 실제 실행 불가'); toast.success('Promotion Gate 산출(NO_GO)'); await openSession(sessionDetail.session.id); }
                  catch (e) { toast.error(friendlyError(e, '0571 미적용일 수 있음')); }
                })()}
                className="mt-2 rounded bg-black/20 px-2.5 py-1 text-ink disabled:opacity-50">Promotion Gate 산출</button>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === 'limits' ? (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-[11px] text-ink-mute">
          {KNOWN_LIMITATIONS.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      ) : null}
    </AdminCard>
  );
}
