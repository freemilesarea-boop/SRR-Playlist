// Phase ALGO-6F — 관리자 AI Governance (SLA Streak Ledger & Governance) 패널.
// Append-only SLA Ledger · Governance Gate · Streak · Ledger Chain/Integrity · Shadow Certificate · Approval History 관측.
// 운영 미반영 — Ledger 는 수정 불가(append-only), 자동 승인/자동 Canary 없음. 운영 전환은 Ledger+Human+Governance 3충족 시에만 후속 검토.
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ShieldCheck, Link2, FileCheck, Lock, ScrollText, Fingerprint } from 'lucide-react';
import { AdminSection, AdminCard, AdminButton, AdminBadge, AdminAlert, AdminEmpty, AdminSkeleton, AdminStatCard } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  adminAppendSlaLedger, adminGenerateGovernanceGate, adminVerifyLedgerIntegrity,
  adminGenerateShadowCertificate, adminAiGovernanceOverview, type GovernanceOverview,
} from '@/lib/governanceApi';

const numf = (n: number | null | undefined) => (n == null ? '—' : Number(n).toFixed(3));
const short = (h: string | null | undefined) => (h ? (h === 'GENESIS' ? 'GENESIS' : h.slice(0, 10) + '…') : '—');

const gateTone = (s: string | null | undefined): 'success' | 'warning' | 'danger' | 'info' | 'neutral' => {
  switch (s) {
    case 'ready_for_real_canary': return 'success';
    case 'approved_by_human': return 'success';
    case 'ready_for_review': return 'info';
    case 'candidate': return 'info';
    case 'observation': return 'warning';
    case 'shadow_only': return 'neutral';
    case 'blocked': return 'danger';
    default: return 'neutral';
  }
};
const slaTone = (s: string): 'success' | 'warning' | 'danger' | 'neutral' => {
  switch (s) {
    case 'sla_pass': return 'success';
    case 'sla_warning': return 'warning';
    case 'sla_fail': return 'danger';
    default: return 'neutral';
  }
};

export default function AiGovernancePanel() {
  const [overview, setOverview] = useState<GovernanceOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setOverview(await adminAiGovernanceOverview()); }
    catch (e) { setErr(e instanceof Error ? e.message : '조회 실패 (0440 미적용 시 정상 — apply 후 표시)'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // Governance 파이프라인: SLA ledger append → gate → integrity verify → certificate.
  async function runGovernance() {
    setBusy(true);
    try {
      const a = await adminAppendSlaLedger(120);
      const g = await adminGenerateGovernanceGate();
      const i = await adminVerifyLedgerIntegrity('sla_ledger');
      await adminGenerateShadowCertificate();
      toast.success(`Governance 갱신 — SLA seq ${a.seq} (${a.sla_state}) · gate ${g.gate_state} · chain ${i.chain_valid ? 'valid' : 'TAMPER'}`);
      await load();
    } catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  const gate = overview?.gate;
  const streak = overview?.streak;
  const integrity = overview?.integrity;
  const cert = overview?.certificate;
  const ledger = overview?.ledger ?? [];
  const approvals = overview?.approvals ?? [];

  return (
    <AdminSection
      title="AI Governance (SLA Ledger, Shadow)"
      description="ALGO-6D Shadow SLA 결과를 Append-Only Ledger(hash chain)에 영구 기록하여 AI 운영 전환의 유일한 공식 근거를 구축합니다. Ledger 는 수정 불가(UPDATE/DELETE 트리거 차단)이며, 자동 승인/자동 Canary 가 없고, 운영 전환은 Ledger + Human Approval + Governance 3가지 충족 시에만 후속 Phase 에서 검토합니다. (ALGO-6F)"
      action={
        <div className="flex flex-wrap items-center gap-2">
          <AdminButton size="sm" variant="subtle" tone="neutral" leftIcon={<RefreshCw size={14} />} onClick={() => void load()}>새로고침</AdminButton>
          <AdminButton size="sm" tone="primary" leftIcon={<ScrollText size={13} />} disabled={busy} onClick={() => void runGovernance()}>SLA Ledger 기록</AdminButton>
        </div>
      }
    >
      <AdminAlert tone="info" className="mb-3" title="Append-Only Governance — Ledger 수정 불가"
        description="SLA Ledger 는 hash chain(prev_hash → entry_hash)으로 연결되며 UPDATE/DELETE 가 DB 트리거로 차단됩니다. Governance Gate 는 SLA streak 기반 상태 판정만 하고(shadow_only/observation/candidate/ready_for_review/approved_by_human/ready_for_real_canary/blocked) 자동 전환/자동 승인이 없습니다. Shadow Certificate 는 관측 증빙 생성만 합니다." />

      {loading && !overview ? (
        <AdminSkeleton variant="card" />
      ) : err ? (
        <AdminAlert tone="info" title="데이터 없음 / 미적용" description={err} action={<AdminButton size="sm" onClick={() => void load()}>재시도</AdminButton>} />
      ) : !overview?.has_data ? (
        <AdminEmpty icon={<ScrollText size={22} />} title="아직 SLA Ledger 기록이 없어요" description="상단 'SLA Ledger 기록'을 누르세요 (append → gate → integrity → certificate, 전부 Shadow)." />
      ) : (
        <div className="space-y-4">
          {/* Gate + integrity + streak */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <AdminStatCard label="Governance Gate" value={gate?.gate_state ?? '—'} tone={gateTone(gate?.gate_state)} icon={<ShieldCheck size={13} />} />
            <AdminStatCard label="Ledger Chain" value={integrity?.chain_valid ? 'VALID' : (integrity ? 'TAMPER' : '—')} tone={integrity?.chain_valid ? 'success' : (integrity ? 'danger' : 'neutral')} icon={<Link2 size={13} />} />
            <AdminStatCard label="Current Streak" value={String(streak?.current_streak ?? 0)} tone={(streak?.current_streak ?? 0) > 0 ? 'success' : 'neutral'} />
            <AdminStatCard label="Best Streak" value={String(streak?.best_streak ?? 0)} tone="info" />
          </div>

          {/* Streak detail + Certificate */}
          <div className="grid gap-3 lg:grid-cols-2">
            <AdminCard title="SLA Streak" subtitle="연속 pass 일/주/월 누적 — 운영 전환 근거.">
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                <AdminStatCard label="Pass Days" value={String(streak?.consecutive_pass_days ?? 0)} tone={(streak?.consecutive_pass_days ?? 0) >= 30 ? 'success' : 'warning'} />
                <AdminStatCard label="Pass Months" value={String(streak?.consecutive_pass_months ?? 0)} tone={(streak?.consecutive_pass_months ?? 0) >= 3 ? 'success' : 'warning'} />
                <AdminStatCard label="Failures" value={String(streak?.failure_count ?? 0)} tone={(streak?.failure_count ?? 0) > 0 ? 'danger' : 'success'} />
                <AdminStatCard label="Entries" value={String(streak?.total_entries ?? 0)} tone="neutral" />
              </div>
            </AdminCard>

            <AdminCard title="Shadow Certificate + Integrity" subtitle="관측 증빙 — 운영 승인 아님.">
              <div className="space-y-1.5 text-[11px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-ink"><FileCheck size={12} className="text-ink-dim" />Certificate v{cert?.certificate_version ?? '—'}</span>
                  <span className="flex items-center gap-1.5"><AdminBadge tone={gateTone(cert?.gate_state)}>{cert?.gate_state ?? '—'}</AdminBadge><span className="font-mono text-ink-dim">{short(cert?.cert_hash)}</span></span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-ink"><Fingerprint size={12} className="text-ink-dim" />Integrity</span>
                  <span className="flex items-center gap-1.5">
                    <AdminBadge tone={integrity?.tamper_detected ? 'danger' : 'success'}>{integrity?.tamper_detected ? 'TAMPER' : 'no tamper'}</AdminBadge>
                    <span className="text-ink-dim">{integrity?.entries_checked ?? 0} entries</span>
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-ink-dim"><Lock size={12} />checksum</span>
                  <span className="font-mono text-ink-dim">{short(integrity?.checksum)}</span>
                </div>
              </div>
            </AdminCard>
          </div>

          {/* SLA Ledger chain */}
          <AdminCard title="SLA Ledger Chain (Append-Only)" subtitle="prev_hash → entry_hash 연결. UPDATE/DELETE 차단.">
            {ledger.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="text-ink-dim"><tr>
                    <th className="px-2 py-1 text-left">seq</th><th className="px-2 py-1 text-left">state</th>
                    <th className="px-2 py-1 text-right">score</th><th className="px-2 py-1 text-right">accuracy</th>
                    <th className="px-2 py-1 text-right">risk</th><th className="px-2 py-1 text-left">prev_hash</th>
                    <th className="px-2 py-1 text-left">entry_hash</th>
                  </tr></thead>
                  <tbody>
                    {ledger.map((l) => (
                      <tr key={l.seq} className="border-t border-line/10">
                        <td className="px-2 py-1 tabular-nums text-ink">{l.seq}</td>
                        <td className="px-2 py-1"><AdminBadge tone={slaTone(l.state)}>{l.state}</AdminBadge></td>
                        <td className="px-2 py-1 text-right tabular-nums text-ink-dim">{numf(l.score)}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-ink-dim">{numf(l.accuracy)}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-ink-dim">{numf(l.risk)}</td>
                        <td className="px-2 py-1 font-mono text-ink-dim">{short(l.prev_hash)}</td>
                        <td className="px-2 py-1 font-mono text-ink">{short(l.entry_hash)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <AdminEmpty title="ledger 없음" description="SLA Ledger 기록을 실행하세요." />}
          </AdminCard>

          {/* Approval history */}
          <AdminCard title="Approval History (Governance Ledger)" subtitle="인간 승인 이력 — 자동 승인 없음(pending 유지).">
            {approvals.length > 0 ? (
              <div className="space-y-1.5">
                {approvals.map((a) => (
                  <div key={a.seq} className="flex items-center justify-between gap-2 rounded-lg border border-line/15 px-2.5 py-1.5 text-[11px]">
                    <span className="flex items-center gap-1.5 text-ink"><ShieldCheck size={11} className="text-ink-dim" />#{a.seq} {a.request}</span>
                    <AdminBadge tone={a.result === 'approved' ? 'success' : a.result === 'rejected' ? 'danger' : 'warning'}>{a.result}</AdminBadge>
                  </div>
                ))}
              </div>
            ) : <div className="flex items-center gap-1.5 text-[11px] text-ink-dim"><Lock size={12} /> 승인 요청 없음 (gate 미달 — 인간 승인 대기 아님)</div>}
          </AdminCard>
        </div>
      )}
    </AdminSection>
  );
}
