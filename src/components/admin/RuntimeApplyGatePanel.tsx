// Phase ALGO-8E — 관리자 Runtime Apply Governance Gate (Shadow) 패널.
// 0447/0448 Apply Package · Pre-Apply Snapshot · Governance Gate · Human Approval · Limited Apply Plan ·
// Success/Failure Criteria · Rollback Package · Observation Windows · Apply Certificate · Append-Only Timeline.
// 모든 버튼은 계획/요청 생성만 수행한다. 실제 Apply/Release/Rollback/Canary/자동 승인 금지.
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, PackagePlus, ShieldCheck, UserCheck, ListOrdered, Target, ShieldAlert, Undo2, Eye, Award, Clock } from 'lucide-react';
import { AdminSection, AdminCard, AdminButton, AdminBadge, AdminAlert, AdminEmpty, AdminSkeleton, AdminStatCard } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  adminCreateRuntimeApplyPackage, adminGeneratePreapplySnapshot, adminGenerateRuntimeApprovalRequest,
  adminEvaluateRuntimeApplyGovernance, adminGenerateLimitedApplyPlan, adminGenerateRuntimeRollbackPackage,
  adminGenerateRuntimeApplyCertificate, adminRuntimeApplyGovernanceOverview, type ApplyGateOverview,
} from '@/lib/runtimeApplyGateApi';

const numf = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString());
const gateTone = (s: string | null | undefined): 'success' | 'warning' | 'danger' | 'neutral' => {
  switch (s) {
    case 'approved_for_limited_apply': case 'approved': return 'success';
    case 'needs_human_approval': case 'needs_review': return 'warning';
    case 'blocked': return 'danger';
    default: return 'neutral';
  }
};
const apprTone = (s: string | null | undefined): 'success' | 'warning' | 'danger' | 'neutral' => {
  switch (s) { case 'approved': return 'success'; case 'pending': return 'warning'; case 'rejected': case 'expired': return 'danger'; default: return 'neutral'; }
};

export default function RuntimeApplyGatePanel() {
  const [ov, setOv] = useState<ApplyGateOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setOv(await adminRuntimeApplyGovernanceOverview()); }
    catch (e) { setErr(e instanceof Error ? e.message : '조회 실패 (0449 미적용 시 정상 — apply 후 표시)'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // Governance Gate 파이프라인: package → snapshot → approval request(pending) → governance → plan → rollback → certificate.
  // 전부 계획/요청 생성만. 자동 승인/Apply 없음.
  async function runAll() {
    setBusy(true);
    try {
      const p = await adminCreateRuntimeApplyPackage();
      await adminGeneratePreapplySnapshot(p.package_id);
      await adminGenerateRuntimeApprovalRequest(p.package_id, 'admin');
      const g = await adminEvaluateRuntimeApplyGovernance(p.package_id);
      await adminGenerateLimitedApplyPlan(p.package_id);
      await adminGenerateRuntimeRollbackPackage(p.package_id);
      const c = await adminGenerateRuntimeApplyCertificate(p.package_id);
      toast.success(`Apply Gate 준비 완료 — gate ${g.gate_state} · approval ${c.approval_state} (실제 Apply 없음)`);
      await load();
    } catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  const pkg = ov?.package;
  const items = ov?.items ?? [];
  const snap = ov?.snapshot;
  const governance = ov?.governance ?? [];
  const approval = ov?.approval;
  const plan = ov?.apply_plan ?? [];
  const success = ov?.success ?? [];
  const failure = ov?.failure ?? [];
  const rollback = ov?.rollback ?? [];
  const observation = ov?.observation ?? [];
  const cert = ov?.certificate;
  const timeline = ov?.timeline ?? [];

  return (
    <AdminSection
      title="Runtime Apply Governance Gate (ALGO-8E)"
      description="ALGO-8C(0447 verified view fix)·ALGO-8D(0448 identity view fix)를 실제 Production 에 적용하기 전 Governance·Human Approval·Apply Checklist·Rollback Readiness·Validation·Failure Gate 를 하나의 승인 절차로 통합합니다. 모든 버튼은 계획/요청 생성만 수행하며, 실제 Apply/Release/Rollback/Canary/자동 승인은 절대 수행하지 않습니다."
      action={
        <div className="flex flex-wrap items-center gap-2">
          <AdminButton size="sm" variant="subtle" tone="neutral" leftIcon={<RefreshCw size={14} />} onClick={() => void load()}>새로고침</AdminButton>
          <AdminButton size="sm" tone="primary" leftIcon={<PackagePlus size={13} />} disabled={busy} onClick={() => void runAll()}>Apply Gate 준비</AdminButton>
        </div>
      }
    >
      <AdminAlert tone="warning" className="mb-3" title="실제 Apply 금지 — 승인·검증·롤백·관찰 계획만 생성"
        description="0447/0448 은 Apply Package 로 등록만 되며 실제 적용되지 않습니다. Governance Gate 는 human approval 이 명시적으로 확인되기 전까지 needs_human_approval 로 유지되고, 자동으로 approved 로 전환되지 않습니다. Limited Apply Plan 의 모든 Stage 는 executed=false·auto_execute=false 이며, Approval/Certificate/Timeline 은 Append-Only(UPDATE/DELETE 차단)입니다." />

      {loading && !ov ? (
        <AdminSkeleton variant="card" />
      ) : err ? (
        <AdminAlert tone="info" title="데이터 없음 / 미적용" description={err} action={<AdminButton size="sm" onClick={() => void load()}>재시도</AdminButton>} />
      ) : !ov?.has_data ? (
        <AdminEmpty icon={<PackagePlus size={22} />} title="아직 Apply Package 가 없어요" description="상단 'Apply Gate 준비'를 누르세요 (package → snapshot → approval(pending) → governance → plan → rollback → certificate)." />
      ) : (
        <div className="space-y-4">
          {/* Overview */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            <AdminStatCard label="Gate" value={cert?.gate_state ?? pkg?.status ?? '—'} tone={gateTone(cert?.gate_state ?? pkg?.status)} icon={<ShieldCheck size={13} />} />
            <AdminStatCard label="Approval" value={approval?.review_state ?? '—'} tone={apprTone(approval?.review_state)} icon={<UserCheck size={13} />} />
            <AdminStatCard label="Governance" value={`${cert?.governance_passed ?? 0}/${cert?.governance_total ?? 0}`} tone={(cert?.governance_passed ?? 0) === (cert?.governance_total ?? 0) && (cert?.governance_total ?? 0) > 0 ? 'success' : 'warning'} />
            <AdminStatCard label="Apply Ready" value={cert?.apply_ready ? 'yes' : 'no'} tone={cert?.apply_ready ? 'success' : 'warning'} />
            <AdminStatCard label="Stages (exec)" value={`${plan.length}/${plan.filter((s) => s.executed).length}`} tone="info" icon={<ListOrdered size={13} />} />
            <AdminStatCard label="Rollback Items" value={String(rollback.length)} tone="info" icon={<Undo2 size={13} />} />
          </div>

          {/* Apply Package + order */}
          <AdminCard title="Runtime Apply Package" subtitle={`${pkg?.title ?? ''} · 순서 변경 금지`}>
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              {(pkg?.apply_order ?? []).map((step, i, arr) => (
                <span key={step} className="flex items-center gap-1.5">
                  <span className="rounded-lg border border-line/15 px-2 py-1 text-ink">{step}</span>
                  {i < arr.length - 1 && <span className="text-ink-dim">→</span>}
                </span>
              ))}
            </div>
            <div className="mt-2 space-y-1">
              {items.map((it) => (
                <div key={it.seq} className="flex items-center gap-2 rounded-lg border border-line/10 px-2.5 py-1 text-[11px]">
                  <span className="shrink-0 rounded bg-line/10 px-1.5 py-0.5 text-ink-dim">#{it.seq}</span>
                  <span className="flex-1 truncate font-mono text-ink">{it.file}</span>
                  <AdminBadge tone="neutral">{it.kind}</AdminBadge>
                </div>
              ))}
            </div>
          </AdminCard>

          {/* Pre-Apply Snapshot */}
          <AdminCard title="Pre-Apply Snapshot" subtitle="적용 전 baseline (0447/0448 미적용) — 원본 무수정.">
            {snap ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6 text-[11px]">
                {([
                  ['verified', snap.v2_verified_streams_count], ['eligible', snap.v2_eligible_streams_count],
                  ['settlement', snap.v2_settlement_eligible_streams_count], ['identity_mismatch', snap.identity_mismatch_count],
                  ['user play_30s', snap.user_play_30s_count], ['fraud≥60', snap.fraud_high_count],
                  ['ingest', snap.stream_ingest_v2_count], ['sessions', snap.stream_sessions_v2_count],
                  ['v1 events', snap.stream_events_count], ['playback', snap.playback_events_v2_count],
                  ['playlist_tracks', snap.playlist_tracks_count], ['dispute', snap.dispute_count],
                ] as Array<[string, number]>).map(([k, v]) => (
                  <div key={k} className="rounded-lg border border-line/15 px-2 py-1.5">
                    <div className="text-ink-dim">{k}</div>
                    <div className="font-medium text-ink tabular-nums">{numf(v)}</div>
                  </div>
                ))}
              </div>
            ) : <AdminEmpty title="snapshot 없음" description="준비를 실행하세요." />}
          </AdminCard>

          {/* Governance + Approval */}
          <div className="grid gap-3 lg:grid-cols-2">
            <AdminCard title="Governance Gate" subtitle="구조·안전·승인 검사. 자동 승인 없음.">
              <div className="space-y-1">
                {governance.map((g) => (
                  <div key={g.key} className="flex items-center gap-2 rounded-lg border border-line/10 px-2.5 py-1 text-[11px]">
                    <span className="flex-1 truncate text-ink">{g.key}</span>
                    <AdminBadge tone="neutral">{g.category}</AdminBadge>
                    <AdminBadge tone={g.passed ? 'success' : 'warning'}>{g.passed ? 'pass' : 'pending'}</AdminBadge>
                  </div>
                ))}
              </div>
            </AdminCard>

            <AdminCard title="Human Approval Request" subtitle="승인 요청만 생성 — 자동 approved 금지.">
              {approval ? (
                <div className="space-y-1.5 text-[11px]">
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-line/15 px-2.5 py-1.5">
                    <span className="text-ink">{approval.approval_request_id}</span>
                    <AdminBadge tone={apprTone(approval.review_state)}>{approval.review_state}</AdminBadge>
                  </div>
                  <p className="text-ink-dim">requested_by {approval.requested_by ?? '—'} · reviewer {approval.reviewer ?? '미지정'}</p>
                  <p className="text-ink-dim">{approval.review_notes}</p>
                  <p className="text-ink-dim">expires {approval.expiration_at ? new Date(approval.expiration_at).toLocaleString() : '—'} · hash <span className="font-mono">{approval.hash}</span></p>
                </div>
              ) : <AdminEmpty title="approval 없음" description="준비를 실행하세요." />}
            </AdminCard>
          </div>

          {/* Limited Apply Plan */}
          <AdminCard title="Limited Apply Plan (Stage 0~7)" subtitle="전부 planned · executed=false · auto_execute=false.">
            <div className="space-y-1">
              {plan.map((st) => (
                <div key={st.num} className="flex items-center gap-2 rounded-lg border border-line/10 px-2.5 py-1 text-[11px]">
                  <span className="shrink-0 rounded bg-line/10 px-1.5 py-0.5 text-ink-dim tabular-nums">S{st.num}</span>
                  <span className="flex-1 truncate text-ink">{st.name}</span>
                  <AdminBadge tone="neutral">planned</AdminBadge>
                  <AdminBadge tone={st.executed ? 'danger' : 'success'}>{st.executed ? 'executed' : 'no-exec'}</AdminBadge>
                </div>
              ))}
            </div>
          </AdminCard>

          {/* Success + Failure */}
          <div className="grid gap-3 lg:grid-cols-2">
            <AdminCard title="Immediate Success Criteria" subtitle="0447 / 0448 / overall.">
              <div className="space-y-1">
                {success.map((sc, i) => (
                  <div key={sc.criterion + i} className="flex items-center gap-2 rounded-lg border border-line/10 px-2.5 py-1 text-[11px]">
                    <Target size={11} className="shrink-0 text-ink-dim" />
                    {sc.scope && <AdminBadge tone="neutral">{sc.scope}</AdminBadge>}
                    <span className="flex-1 truncate text-ink">{sc.criterion}</span>
                    {sc.note && <span className="shrink-0 text-ink-dim">{sc.note}</span>}
                  </div>
                ))}
              </div>
            </AdminCard>

            <AdminCard title="Immediate Failure Criteria" subtitle="rollback 후보 — 실제 자동 rollback 금지.">
              <div className="space-y-1">
                {failure.map((fc, i) => (
                  <div key={fc.criterion + i} className="flex items-center gap-2 rounded-lg border border-line/10 px-2.5 py-1 text-[11px]">
                    <ShieldAlert size={11} className="shrink-0 text-ink-dim" />
                    <span className="flex-1 truncate text-ink">{fc.criterion}</span>
                    {fc.rollback_candidate && <AdminBadge tone="neutral">rollback candidate</AdminBadge>}
                  </div>
                ))}
              </div>
            </AdminCard>
          </div>

          {/* Rollback + Observation */}
          <div className="grid gap-3 lg:grid-cols-2">
            <AdminCard title="Rollback Package" subtitle="순서: 0448 → 0447 · 실행 금지 (계획만).">
              <div className="space-y-1.5">
                {rollback.map((rb) => (
                  <div key={rb.order} className="rounded-lg border border-line/15 px-2.5 py-1.5 text-[11px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-ink"><Undo2 size={11} className="text-ink-dim" />#{rb.order} {rb.target}</span>
                      <span className="flex items-center gap-1.5"><span className="text-ink-dim">{rb.owner} · {rb.duration}</span><AdminBadge tone="neutral">{rb.state}</AdminBadge></span>
                    </div>
                    <code className="mt-0.5 block truncate text-ink-dim" title={rb.rollback_sql ?? ''}>{rb.rollback_sql}</code>
                  </div>
                ))}
              </div>
            </AdminCard>

            <AdminCard title="Observation Windows" subtitle="T+0 ~ T+24h · 예약/자동 실행 금지.">
              <div className="space-y-1">
                {observation.map((w) => (
                  <div key={w.label} className="flex items-center gap-2 rounded-lg border border-line/10 px-2.5 py-1 text-[11px]">
                    <Eye size={11} className="shrink-0 text-ink-dim" />
                    <span className="w-16 shrink-0 text-ink">{w.label}</span>
                    <span className="flex-1 truncate text-ink-dim">{(w.metrics ?? []).join(', ')}</span>
                    <AdminBadge tone={w.scheduled ? 'warning' : 'neutral'}>{w.scheduled ? 'scheduled' : 'plan'}</AdminBadge>
                  </div>
                ))}
              </div>
            </AdminCard>
          </div>

          {/* Certificate + Timeline */}
          <div className="grid gap-3 lg:grid-cols-2">
            <AdminCard title="Apply Certificate (Append-Only)" subtitle="gate · approval · apply_ready · hash.">
              {cert ? (
                <div className="space-y-1.5 text-[11px]">
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-line/15 px-2.5 py-1.5"><span className="flex items-center gap-1.5 text-ink"><Award size={12} className="text-ink-dim" />Gate</span><AdminBadge tone={gateTone(cert.gate_state)}>{cert.gate_state ?? '—'}</AdminBadge></div>
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-line/15 px-2.5 py-1.5"><span className="text-ink">Approval</span><AdminBadge tone={apprTone(cert.approval_state)}>{cert.approval_state ?? '—'}</AdminBadge></div>
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-line/15 px-2.5 py-1.5"><span className="text-ink">Apply Ready</span><AdminBadge tone={cert.apply_ready ? 'success' : 'warning'}>{cert.apply_ready ? 'yes' : 'no (human approval 대기)'}</AdminBadge></div>
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-line/15 px-2.5 py-1.5"><span className="text-ink">Certificate Hash</span><span className="font-mono text-ink-dim">{cert.hash ?? '—'}</span></div>
                </div>
              ) : <AdminEmpty title="certificate 없음" description="준비를 실행하세요." />}
            </AdminCard>

            <AdminCard title="Append-Only Timeline" subtitle="package·snapshot·governance·approval·plan·rollback·certificate 기록 — 수정/삭제 불가.">
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
              ) : <AdminEmpty title="timeline 없음" description="준비를 실행하세요." />}
            </AdminCard>
          </div>
        </div>
      )}
    </AdminSection>
  );
}
