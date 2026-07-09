// Phase ALGO-7C — 관리자 AI Release & Policy Manager (Shadow) 패널 — Release Governance Layer.
// Release Readiness · Policy Compliance · Approval Gate · Rollback Verification · Risk Matrix · Decision Record · Certificate · Required Actions · Timeline.
// Shadow Only — 실제 Release/Rollback/Policy Apply/Canary/자동 승인을 어떤 경우에도 수행하지 않습니다.
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Play, ClipboardCheck, ShieldCheck, CheckSquare, Undo2, Grid3x3, FileText, Award, ListChecks, Clock } from 'lucide-react';
import { AdminSection, AdminCard, AdminButton, AdminBadge, AdminAlert, AdminEmpty, AdminSkeleton, AdminStatCard } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  adminGenerateReleaseReadiness, adminGeneratePolicyCompliance, adminGenerateApprovalGateCheck,
  adminGenerateRollbackVerification, adminGenerateReleaseCertificate, adminAiReleasePolicyOverview,
  type ReleasePolicyOverview,
} from '@/lib/releasePolicyApi';

const finalTone = (s: string | null | undefined): 'success' | 'warning' | 'danger' | 'info' | 'neutral' => {
  switch (s) {
    case 'ready_for_canary_review': case 'ready_for_shadow_release': return 'success';
    case 'needs_approval': return 'warning';
    case 'needs_policy_review': case 'needs_observability': case 'needs_rollback_plan': return 'info';
    case 'release_blocked': return 'danger';
    default: return 'neutral';
  }
};
const riskTone = (r: string | null | undefined): 'success' | 'warning' | 'danger' | 'neutral' => {
  switch (r) { case 'critical': case 'high': return 'danger'; case 'medium': return 'warning'; case 'low': return 'success'; default: return 'neutral'; }
};
const stateTone = (s: string | null | undefined): 'success' | 'warning' | 'danger' | 'info' | 'neutral' => {
  switch (s) {
    case 'ready': case 'compliant': case 'approved': return 'success';
    case 'pending': case 'needs_human_review': return 'warning';
    case 'missing': case 'high_risk': case 'rejected': return 'danger';
    case 'not_required': case 'not_applicable': return 'neutral';
    default: return 'info';
  }
};

export default function AiReleaseManagerPanel() {
  const [ov, setOv] = useState<ReleasePolicyOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setOv(await adminAiReleasePolicyOverview()); }
    catch (e) { setErr(e instanceof Error ? e.message : '조회 실패 (0444 미적용 시 정상 — apply 후 표시)'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // Release Governance 파이프라인: readiness → policy → approval → rollback → certificate(risk+decision+cert).
  async function runAll() {
    setBusy(true);
    try {
      const r = await adminGenerateReleaseReadiness(30);
      await adminGeneratePolicyCompliance(r.run_id);
      await adminGenerateApprovalGateCheck(r.run_id);
      await adminGenerateRollbackVerification(r.run_id);
      const c = await adminGenerateReleaseCertificate(r.run_id);
      toast.success(`Release Governance 검증 완료 — certificates ${c.certificates} (Shadow, 실제 배포 없음)`);
      await load();
    } catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  const s = ov?.summary;
  const readiness = ov?.readiness ?? [];
  const policy = ov?.policy ?? [];
  const approvals = ov?.approvals ?? [];
  const rollback = ov?.rollback ?? [];
  const risk = ov?.risk_matrix ?? [];
  const decisions = ov?.decisions ?? [];
  const certs = ov?.certificates ?? [];
  const timeline = ov?.timeline ?? [];
  const requiredActions = decisions.flatMap((d) => (d.required_actions ?? []).map((a) => ({ component: d.component, action: a })));

  return (
    <AdminSection
      title="AI Release & Policy Manager (ALGO-7C)"
      description="AI Music OS 의 Release Governance Layer — 운영 전환 전 필요한 정책·승인·롤백·리스크·인증 절차를 Shadow 로 통합 검증합니다. Release Readiness·Policy Compliance·Approval Gate·Rollback Verification·Risk Matrix·Decision Record·Release Certificate. 실제 Release/Rollback/Policy Apply/Canary/자동 승인은 절대 수행하지 않습니다."
      action={
        <div className="flex flex-wrap items-center gap-2">
          <AdminButton size="sm" variant="subtle" tone="neutral" leftIcon={<RefreshCw size={14} />} onClick={() => void load()}>새로고침</AdminButton>
          <AdminButton size="sm" tone="primary" leftIcon={<Play size={13} />} disabled={busy} onClick={() => void runAll()}>Release 검증 실행</AdminButton>
        </div>
      }
    >
      <AdminAlert tone="info" className="mb-3" title="Release Governance — 검증·인증 전용 (Shadow Only)"
        description="component 별 준비도(final_state)와 정책 준수(human review 필요), 승인 게이트(자동 승인 금지), 롤백 검증(Simulation Only), 리스크 매트릭스, 결정 기록, Shadow Release Certificate(실제 배포 효력 없음)를 생성합니다. 어떤 component 도 자동으로 release/canary 로 승격되지 않으며, 모든 전환은 human review 를 요구합니다." />

      {loading && !ov ? (
        <AdminSkeleton variant="card" />
      ) : err ? (
        <AdminAlert tone="info" title="데이터 없음 / 미적용" description={err} action={<AdminButton size="sm" onClick={() => void load()}>재시도</AdminButton>} />
      ) : !ov?.has_data ? (
        <AdminEmpty icon={<ClipboardCheck size={22} />} title="아직 Release 검증이 없어요" description="상단 'Release 검증 실행'을 누르세요 (readiness → policy → approval → rollback → certificate, 전부 Shadow)." />
      ) : (
        <div className="space-y-4">
          {/* Overview */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            <AdminStatCard label="Components" value={String(s?.components ?? 0)} tone="info" />
            <AdminStatCard label="Ready" value={String(s?.ready ?? 0)} tone={(s?.ready ?? 0) > 0 ? 'success' : 'neutral'} />
            <AdminStatCard label="Needs Approval" value={String(s?.needs_approval ?? 0)} tone={(s?.needs_approval ?? 0) > 0 ? 'warning' : 'neutral'} icon={<CheckSquare size={13} />} />
            <AdminStatCard label="Blocked" value={String(s?.blocked ?? 0)} tone={(s?.blocked ?? 0) > 0 ? 'danger' : 'neutral'} />
            <AdminStatCard label="Certificates" value={String(s?.certificates ?? 0)} tone="info" icon={<Award size={13} />} />
            <AdminStatCard label="High/Crit Risk" value={String((s?.risk?.high ?? 0) + (s?.risk?.critical ?? 0))} tone={((s?.risk?.high ?? 0) + (s?.risk?.critical ?? 0)) > 0 ? 'warning' : 'neutral'} icon={<Grid3x3 size={13} />} />
          </div>

          {/* Release Readiness */}
          <AdminCard title="Release Readiness" subtitle="component 별 종합 준비 상태. 자동 승격 없음.">
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead className="text-ink-dim"><tr>
                  <th className="px-2 py-1 text-left">component</th><th className="px-2 py-1 text-left">candidate</th>
                  <th className="px-2 py-1 text-center">policy</th><th className="px-2 py-1 text-center">approval</th>
                  <th className="px-2 py-1 text-center">rollback</th><th className="px-2 py-1 text-center">incident</th>
                  <th className="px-2 py-1 text-left">final</th><th className="px-2 py-1 text-right">score</th>
                </tr></thead>
                <tbody>
                  {readiness.map((r) => (
                    <tr key={r.component} className="border-t border-line/10">
                      <td className="px-2 py-1 text-ink">{r.component}</td>
                      <td className="px-2 py-1 text-ink-dim">{r.candidate ?? '—'}</td>
                      <td className="px-2 py-1 text-center text-ink-dim">{r.policy ?? '—'}</td>
                      <td className="px-2 py-1 text-center text-ink-dim">{r.approval ?? '—'}</td>
                      <td className="px-2 py-1 text-center text-ink-dim">{r.rollback ?? '—'}</td>
                      <td className="px-2 py-1 text-center text-ink-dim">{r.incident ?? '—'}</td>
                      <td className="px-2 py-1"><AdminBadge tone={finalTone(r.final)}>{r.final ?? '—'}</AdminBadge></td>
                      <td className="px-2 py-1 text-right tabular-nums text-ink">{r.score ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </AdminCard>

          {/* Policy + Approval */}
          <div className="grid gap-3 lg:grid-cols-2">
            <AdminCard title="Policy Compliance" subtitle="도메인별 policy 준수 · human review 필요 여부.">
              {policy.length > 0 ? (
                <div className="space-y-1.5">
                  {policy.map((p) => (
                    <div key={p.domain} className="flex items-center justify-between gap-2 rounded-lg border border-line/15 px-2.5 py-1.5 text-[11px]">
                      <span className="flex items-center gap-1.5 text-ink"><ShieldCheck size={11} className="text-ink-dim" />{p.domain}</span>
                      <span className="flex items-center gap-1.5">
                        {p.needs_review && <AdminBadge tone="warning">human review</AdminBadge>}
                        <AdminBadge tone={stateTone(p.state)}>{p.state ?? '—'}</AdminBadge>
                      </span>
                    </div>
                  ))}
                </div>
              ) : <AdminEmpty title="policy 없음" description="검증을 실행하세요." />}
            </AdminCard>

            <AdminCard title="Approval Gate" subtitle="승인 준비도만 판단 — 자동 승인 금지.">
              {approvals.length > 0 ? (
                <div className="space-y-1.5">
                  {approvals.map((a) => (
                    <div key={a.component} className="flex items-center justify-between gap-2 rounded-lg border border-line/15 px-2.5 py-1.5 text-[11px]">
                      <span className="text-ink">{a.component}</span>
                      <span className="flex items-center gap-1.5">
                        {a.human && <AdminBadge tone="info">human</AdminBadge>}
                        <AdminBadge tone={stateTone(a.gate)}>{a.gate ?? '—'}</AdminBadge>
                      </span>
                    </div>
                  ))}
                </div>
              ) : <AdminEmpty title="gate 없음" description="검증을 실행하세요." />}
            </AdminCard>
          </div>

          {/* Rollback + Risk Matrix */}
          <div className="grid gap-3 lg:grid-cols-2">
            <AdminCard title="Rollback Verification" subtitle="rollback plan 준비 검증 — Simulation Only.">
              {rollback.length > 0 ? (
                <div className="space-y-1.5">
                  {rollback.map((rb) => (
                    <div key={rb.component} className="flex items-center justify-between gap-2 rounded-lg border border-line/15 px-2.5 py-1.5 text-[11px]">
                      <span className="flex items-center gap-1.5 text-ink"><Undo2 size={11} className="text-ink-dim" />{rb.component}</span>
                      <span className="flex items-center gap-1.5">
                        <AdminBadge tone={riskTone(rb.risk)}>{rb.risk ?? '—'}</AdminBadge>
                        <AdminBadge tone={stateTone(rb.state)}>{rb.state ?? '—'}</AdminBadge>
                      </span>
                    </div>
                  ))}
                </div>
              ) : <AdminEmpty title="rollback check 없음" description="검증을 실행하세요." />}
            </AdminCard>

            <AdminCard title="Release Risk Matrix" subtitle="technical·policy·approval·rollback·incident·governance·observability → overall.">
              {risk.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead className="text-ink-dim"><tr>
                      <th className="px-1.5 py-1 text-left">comp</th><th className="px-1.5 py-1 text-center">tech</th>
                      <th className="px-1.5 py-1 text-center">pol</th><th className="px-1.5 py-1 text-center">appr</th>
                      <th className="px-1.5 py-1 text-center">rb</th><th className="px-1.5 py-1 text-center">inc</th>
                      <th className="px-1.5 py-1 text-left">overall</th>
                    </tr></thead>
                    <tbody>
                      {risk.map((m) => (
                        <tr key={m.component} className="border-t border-line/10">
                          <td className="px-1.5 py-1 text-ink">{m.component}</td>
                          <td className="px-1.5 py-1 text-center text-ink-dim">{m.technical}</td>
                          <td className="px-1.5 py-1 text-center text-ink-dim">{m.policy}</td>
                          <td className="px-1.5 py-1 text-center text-ink-dim">{m.approval}</td>
                          <td className="px-1.5 py-1 text-center text-ink-dim">{m.rollback}</td>
                          <td className="px-1.5 py-1 text-center text-ink-dim">{m.incident}</td>
                          <td className="px-1.5 py-1"><AdminBadge tone={riskTone(m.overall)}>{m.overall} · {m.score ?? 0}</AdminBadge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <AdminEmpty title="risk matrix 없음" description="검증을 실행하세요." />}
            </AdminCard>
          </div>

          {/* Decision Records + Required Actions */}
          <div className="grid gap-3 lg:grid-cols-2">
            <AdminCard title="Release Decision Record" subtitle="component 별 결정 상태·사유·blocker·warning.">
              {decisions.length > 0 ? (
                <div className="space-y-1.5">
                  {decisions.map((d) => (
                    <div key={d.component} className="rounded-lg border border-line/15 px-2.5 py-1.5 text-[11px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-ink"><FileText size={11} className="text-ink-dim" />{d.component}</span>
                        <AdminBadge tone={finalTone(d.state)}>{d.state ?? '—'}</AdminBadge>
                      </div>
                      <p className="mt-0.5 text-ink-dim">{d.reason}</p>
                      {(d.warnings ?? []).length > 0 && <p className="mt-0.5 text-ink-dim">⚠ {(d.warnings ?? []).join(', ')}</p>}
                    </div>
                  ))}
                </div>
              ) : <AdminEmpty title="decision 없음" description="검증을 실행하세요." />}
            </AdminCard>

            <AdminCard title="Required Actions" subtitle="운영 전환 전 필요한 조치 (Shadow 준비만).">
              {requiredActions.length > 0 ? (
                <div className="space-y-1">
                  {requiredActions.map((ra, i) => (
                    <div key={ra.component + i} className="flex items-center gap-2 rounded-lg border border-line/10 px-2.5 py-1 text-[11px]">
                      <ListChecks size={11} className="shrink-0 text-ink-dim" />
                      <AdminBadge tone="neutral">{ra.component}</AdminBadge>
                      <span className="flex-1 truncate text-ink">{ra.action}</span>
                    </div>
                  ))}
                </div>
              ) : <AdminEmpty title="required action 없음" description="추가 조치가 없습니다." />}
            </AdminCard>
          </div>

          {/* Certificates */}
          <AdminCard title="Release Certificate (Shadow — 실제 배포 효력 없음)" subtitle="component 별 인증서 · certificate_hash.">
            {certs.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="text-ink-dim"><tr>
                    <th className="px-2 py-1 text-left">component</th><th className="px-2 py-1 text-center">policy</th>
                    <th className="px-2 py-1 text-center">approval</th><th className="px-2 py-1 text-center">rollback</th>
                    <th className="px-2 py-1 text-center">gov gate</th><th className="px-2 py-1 text-center">obs</th>
                    <th className="px-2 py-1 text-left">hash</th>
                  </tr></thead>
                  <tbody>
                    {certs.map((c) => (
                      <tr key={c.component} className="border-t border-line/10">
                        <td className="px-2 py-1 text-ink">{c.component}</td>
                        <td className="px-2 py-1 text-center text-ink-dim">{c.policy ?? '—'}</td>
                        <td className="px-2 py-1 text-center text-ink-dim">{c.approval ?? '—'}</td>
                        <td className="px-2 py-1 text-center text-ink-dim">{c.rollback ?? '—'}</td>
                        <td className="px-2 py-1 text-center"><AdminBadge tone={c.governance_gate === 'pass' ? 'success' : 'neutral'}>{c.governance_gate ?? '—'}</AdminBadge></td>
                        <td className="px-2 py-1 text-center text-ink-dim">{c.observability ?? '—'}</td>
                        <td className="px-2 py-1 font-mono text-ink-dim">{c.hash ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <AdminEmpty title="certificate 없음" description="검증을 실행하세요." />}
          </AdminCard>

          {/* Timeline */}
          <AdminCard title="Release & Policy Timeline (Append Only)" subtitle="readiness·policy·certificate 기록 — 수정/삭제 불가.">
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
            ) : <AdminEmpty title="timeline 없음" description="검증을 실행하세요." />}
          </AdminCard>
        </div>
      )}
    </AdminSection>
  );
}
