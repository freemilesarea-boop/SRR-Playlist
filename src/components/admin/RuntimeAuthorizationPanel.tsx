// Phase ALGO-8F — 관리자 Runtime Apply Authorization (Human Approval Workflow, Shadow) 패널.
// Approval Flow · Multi Reviewer · Votes · Policy · Authorization Certificate · Authorization Status · Append-Only Audit.
// 실제 Apply 없음 — Human Approval 과 Authorization(권한 부여)만 관리. 자동 승인 없음.
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, FilePlus2, Gavel, ShieldCheck, UserCheck, ScrollText } from 'lucide-react';
import { AdminSection, AdminCard, AdminButton, AdminBadge, AdminAlert, AdminEmpty, AdminSkeleton, AdminStatCard } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  adminRequestRuntimeAuthorization, adminReviewRuntimeAuthorization, adminGenerateRuntimeAuthorization,
  adminRuntimeAuthorizationOverview, type AuthorizationOverview, type AuthRule,
} from '@/lib/runtimeAuthApi';

const ROLES = ['AI Owner', 'Streaming Owner', 'Backend Owner', 'Operations Owner'];

const statusTone = (s: string | null | undefined): 'success' | 'warning' | 'danger' | 'info' | 'neutral' => {
  switch (s) {
    case 'Approved': case 'authorized': return 'success';
    case 'Under Review': case 'Requested': case 'pending': return 'warning';
    case 'Rejected': case 'Expired': case 'Revoked': case 'unauthorized': case 'revoked': return 'danger';
    default: return 'neutral';
  }
};
const voteTone = (v: string | null | undefined): 'success' | 'danger' | 'neutral' => {
  switch (v) { case 'approve': return 'success'; case 'reject': return 'danger'; default: return 'neutral'; }
};

export default function RuntimeAuthorizationPanel() {
  const [ov, setOv] = useState<AuthorizationOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rule, setRule] = useState<AuthRule>('3of4');

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setOv(await adminRuntimeAuthorizationOverview()); }
    catch (e) { setErr(e instanceof Error ? e.message : '조회 실패 (0450 미적용 시 정상 — apply 후 표시)'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function requestAuth() {
    setBusy(true);
    try {
      const r = await adminRequestRuntimeAuthorization('streaming_v2_view_fix (0447+0448)', rule, 'admin');
      toast.success(`Authorization 요청 생성 — ${r.request_id} (${r.required_approvals} of ${r.total_reviewers})`);
      await load();
    } catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  async function castVote(role: string, vote: 'approve' | 'reject' | 'abstain') {
    const reqId = ov?.request?.request_id;
    if (!reqId) { toast.error('먼저 Authorization 요청을 생성하세요.'); return; }
    setBusy(true);
    try {
      await adminReviewRuntimeAuthorization(reqId, role, vote, 'admin', `${role} ${vote}`);
      await adminGenerateRuntimeAuthorization(reqId);
      toast.success(`${role} → ${vote} 기록 (append-only)`);
      await load();
    } catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  const req = ov?.request;
  const policy = ov?.policy;
  const reviews = ov?.reviews ?? [];
  const latestVotes = ov?.latest_votes ?? {};
  const cert = ov?.certificate;
  const audit = ov?.audit ?? [];
  const roles = policy?.roles ?? ROLES;

  return (
    <AdminSection
      title="Runtime Apply Authorization (ALGO-8F)"
      description="ALGO-8E 에서 생성한 Runtime Apply Package(0447+0448)를 운영자가 승인하는 Human Approval Workflow 입니다. Multi Reviewer 투표·Approval Policy(2of3/3of4/all)·Append-Only Audit·Authorization Certificate 를 관리합니다. 실제 Apply 는 하지 않으며, Authorization 은 '실제 Apply 권한'만 부여하고 실행은 별도 Phase 입니다. 자동 승인 없음."
      action={
        <div className="flex flex-wrap items-center gap-2">
          <AdminButton size="sm" variant="subtle" tone="neutral" leftIcon={<RefreshCw size={14} />} onClick={() => void load()}>새로고침</AdminButton>
          <select value={rule} onChange={(e) => setRule(e.target.value as AuthRule)} className="rounded-lg border border-line/20 bg-transparent px-2 py-1 text-[11px] text-ink">
            <option value="2of3">2 of 3</option>
            <option value="3of4">3 of 4</option>
            <option value="all_required">All Required</option>
          </select>
          <AdminButton size="sm" tone="primary" leftIcon={<FilePlus2 size={13} />} disabled={busy} onClick={() => void requestAuth()}>Authorization 요청</AdminButton>
        </div>
      }
    >
      <AdminAlert tone="warning" className="mb-3" title="Human Approval 만 관리 — 실제 Apply 없음"
        description="각 Reviewer(AI/Streaming/Backend/Operations Owner)의 투표는 append-only 로 기록되며 자동 승인되지 않습니다. Approval Policy 를 충족하면 Authorization Certificate 가 authorized 로 발급되지만, 이는 '실제 Apply 권한'만 부여할 뿐 0447/0448 을 실행하지 않습니다. Reviews/Certificate/Audit 는 UPDATE/DELETE 가 차단됩니다." />

      {loading && !ov ? (
        <AdminSkeleton variant="card" />
      ) : err ? (
        <AdminAlert tone="info" title="데이터 없음 / 미적용" description={err} action={<AdminButton size="sm" onClick={() => void load()}>재시도</AdminButton>} />
      ) : !ov?.has_data ? (
        <AdminEmpty icon={<Gavel size={22} />} title="아직 Authorization 요청이 없어요" description="정책(2of3/3of4/all)을 고르고 'Authorization 요청'을 누르세요." />
      ) : (
        <div className="space-y-4">
          {/* Overview */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
            <AdminStatCard label="Request Status" value={req?.status ?? '—'} tone={statusTone(req?.status)} icon={<Gavel size={13} />} />
            <AdminStatCard label="Authorization" value={cert?.authorization_status ?? 'unauthorized'} tone={statusTone(cert?.authorization_status)} icon={<ShieldCheck size={13} />} />
            <AdminStatCard label="Approvals" value={`${cert?.approvals_count ?? 0}/${cert?.required_approvals ?? policy?.required_approvals ?? 0}`} tone={cert?.policy_satisfied ? 'success' : 'warning'} icon={<UserCheck size={13} />} />
            <AdminStatCard label="Rejections" value={String(cert?.rejections_count ?? 0)} tone={(cert?.rejections_count ?? 0) > 0 ? 'danger' : 'neutral'} />
            <AdminStatCard label="Policy" value={policy?.rule ?? '—'} tone="info" />
          </div>
          {req && <p className="text-[11px] text-ink-dim">{req.request_id} · {req.apply_package_ref} · 요청자 {req.requested_by} · 만료 {req.expiration_at ? new Date(req.expiration_at).toLocaleDateString() : '—'}{cert?.hash ? ` · cert ${cert.hash}` : ''}</p>}

          {/* Multi Reviewer votes */}
          <AdminCard title="Multi Reviewer" subtitle={`${policy?.rule ?? ''} · 각 Reviewer 최신 투표 (append-only)`}>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {roles.map((role) => (
                <div key={role} className="flex items-center justify-between gap-2 rounded-lg border border-line/15 px-2.5 py-1.5 text-[11px]">
                  <span className="flex items-center gap-1.5 text-ink"><UserCheck size={12} className="text-ink-dim" />{role}</span>
                  <span className="flex items-center gap-1.5">
                    {latestVotes[role] && <AdminBadge tone={voteTone(latestVotes[role])}>{latestVotes[role]}</AdminBadge>}
                    <AdminButton size="sm" variant="subtle" tone="success" disabled={busy} onClick={() => void castVote(role, 'approve')}>approve</AdminButton>
                    <AdminButton size="sm" variant="subtle" tone="danger" disabled={busy} onClick={() => void castVote(role, 'reject')}>reject</AdminButton>
                    <AdminButton size="sm" variant="subtle" tone="neutral" disabled={busy} onClick={() => void castVote(role, 'abstain')}>abstain</AdminButton>
                  </span>
                </div>
              ))}
            </div>
          </AdminCard>

          {/* Certificate + Vote history */}
          <div className="grid gap-3 lg:grid-cols-2">
            <AdminCard title="Authorization Certificate" subtitle="정책 충족 시 Apply 권한만 부여 · 실행 없음.">
              {cert ? (
                <div className="space-y-1.5 text-[11px]">
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-line/15 px-2.5 py-1.5"><span className="flex items-center gap-1.5 text-ink"><ShieldCheck size={12} className="text-ink-dim" />Authorization</span><AdminBadge tone={statusTone(cert.authorization_status)}>{cert.authorization_status}</AdminBadge></div>
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-line/15 px-2.5 py-1.5"><span className="text-ink">Policy Satisfied</span><AdminBadge tone={cert.policy_satisfied ? 'success' : 'warning'}>{cert.policy_satisfied ? 'yes' : 'no'}</AdminBadge></div>
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-line/15 px-2.5 py-1.5"><span className="text-ink">Approved Roles</span><span className="text-ink-dim">{(cert.authorized_roles ?? []).join(', ') || '—'}</span></div>
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-line/15 px-2.5 py-1.5"><span className="text-ink">Certificate Hash</span><span className="font-mono text-ink-dim">{cert.hash ?? '—'}</span></div>
                  {cert.note && <p className="text-ink-dim">{cert.note}</p>}
                </div>
              ) : <AdminEmpty title="certificate 없음" description="투표 후 생성됩니다." />}
            </AdminCard>

            <AdminCard title="Vote History (Append-Only)" subtitle="누가·언제·어떻게 투표했는지.">
              {reviews.length > 0 ? (
                <div className="space-y-1">
                  {reviews.map((r, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-lg border border-line/10 px-2.5 py-1 text-[11px]">
                      <span className="w-28 shrink-0 truncate text-ink">{r.role}</span>
                      <AdminBadge tone={voteTone(r.vote)}>{r.vote}</AdminBadge>
                      <span className="flex-1 truncate text-ink-dim">{r.reviewer} · {r.reason}</span>
                      <span className="shrink-0 text-ink-dim">{new Date(r.voted_at).toLocaleTimeString()}</span>
                    </div>
                  ))}
                </div>
              ) : <AdminEmpty title="vote 없음" description="Reviewer 투표를 기록하세요." />}
            </AdminCard>
          </div>

          {/* Audit */}
          <AdminCard title="Approval Audit (Append-Only)" subtitle="requested · reviewed · authorized 이력 — 수정/삭제 불가.">
            {audit.length > 0 ? (
              <div className="space-y-1">
                {audit.map((a, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg border border-line/10 px-2.5 py-1 text-[11px]">
                    <ScrollText size={11} className="shrink-0 text-ink-dim" />
                    <AdminBadge tone={a.action === 'authorized' ? 'success' : 'neutral'}>{a.action}</AdminBadge>
                    <span className="w-20 shrink-0 truncate text-ink">{a.actor}</span>
                    <span className="flex-1 truncate text-ink-dim">{a.detail}</span>
                    <span className="shrink-0 text-ink-dim">{new Date(a.ts).toLocaleTimeString()}</span>
                  </div>
                ))}
              </div>
            ) : <AdminEmpty title="audit 없음" description="요청/투표 시 기록됩니다." />}
          </AdminCard>
        </div>
      )}
    </AdminSection>
  );
}
