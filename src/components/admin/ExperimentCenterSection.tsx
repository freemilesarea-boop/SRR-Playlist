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
import { FlaskConical, PlusCircle, FileSearch, ShieldAlert, RefreshCw, Inbox } from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import {
  buildAiExperimentAssignments, createAiExperiment, fetchAiExperimentDetail, fetchAiExperiments,
  proposeAiExperimentRollback, setAiExperimentAllowlist, setAiExperimentEmergencyStop, setAiExperimentStatus,
  type AiExpDetail, type AiExpListRow, type AiExpStatus,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';
import { relativeTimeKo } from '@/lib/memberGrowth';
import { FIXED_EXPERIMENT_WARNING } from '@/lib/experimentIntel';

const NUM = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('ko-KR'));

type Tab = 'overview' | 'create' | 'detail' | 'limits';
const TABS: { key: Tab; label: string; icon: typeof FlaskConical }[] = [
  { key: 'overview', label: 'Overview', icon: FlaskConical },
  { key: 'create', label: 'Create', icon: PlusCircle },
  { key: 'detail', label: 'Detail', icon: FileSearch },
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
  'Stage 2/3 Treatment 라우팅은 서버 게이트+Fallback 규칙까지 구축된 기반이며, 실제 Player 라우팅 배선은 관리자 승인 후 별도 최소 변경으로 수행합니다.',
  'Emergency Stop은 신규 Treatment 라우팅 중지 신호입니다 — 재생 중 Track 중단/Queue 삭제/Weight 변경이 아닙니다.',
  'SRM 감지 또는 Blocking Guardrail 위반 상태에서는 continue/promote 결정을 서버가 기록 거부합니다.',
  'Sample/기간 부족 상태에서 승자를 선언하지 않으며(CI 기반 유의성 필수), Shadow 결과는 실제 Treatment 결과로 기록되지 않습니다.',
  'Rollback Proposal approved는 자동 Rollback 실행이 아니라 관리자 실행 후보 승인 기록입니다.',
  '이 UI는 브라우저에서 직접 검증되지 않았습니다. Migration 0565~0569는 Production 미적용이며 실제 실험은 아직 실행되지 않았습니다(모든 지표 0/not_run).',
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

      {tab === 'limits' ? (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-[11px] text-ink-mute">
          {KNOWN_LIMITATIONS.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      ) : null}
    </AdminCard>
  );
}
