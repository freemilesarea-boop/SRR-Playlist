// Phase ALGO-8G — 관리자 Limited Runtime Apply Rehearsal (Shadow Validation) 패널.
// Apply Rehearsal(dry-run) · Operator Runbook · Validation Pack · Observation Procedure · Rollback Drill · Status.
// 0447/0448 로직을 INLINE 재현하여 회복치를 계산 — view/원본 무변경, 실제 Apply 없음.
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, PlayCircle, ListChecks, FlaskConical, Eye, Undo2, BookOpen } from 'lucide-react';
import { AdminSection, AdminCard, AdminButton, AdminBadge, AdminAlert, AdminEmpty, AdminSkeleton, AdminStatCard } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  adminRunApplyRehearsal, adminGenerateObservationReports, adminGenerateRollbackDrill,
  adminRuntimeApplyRehearsalOverview, type RehearsalOverview,
} from '@/lib/rehearsalApi';

const phaseTone = (p: string): 'success' | 'info' | 'warning' | 'neutral' => {
  switch (p) { case '0447': return 'success'; case '0448': return 'info'; case 'regression': return 'neutral'; default: return 'warning'; }
};

export default function RuntimeRehearsalPanel() {
  const [ov, setOv] = useState<RehearsalOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setOv(await adminRuntimeApplyRehearsalOverview()); }
    catch (e) { setErr(e instanceof Error ? e.message : '조회 실패 (0451 미적용 시 정상 — apply 후 표시)'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // Dry-run 리허설: rehearsal(inline 회복 계산) → observation → rollback drill.
  async function runAll() {
    setBusy(true);
    try {
      const r = await adminRunApplyRehearsal(30);
      await adminGenerateObservationReports(r.rehearsal_id);
      await adminGenerateRollbackDrill(r.rehearsal_id);
      toast.success(`Rehearsal ${r.result} — verified ${r.verified.current}→${r.verified.rehearsed} · eligible ${r.eligible.current}→${r.eligible.rehearsed} (dry-run)`);
      await load();
    } catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  const reh = ov?.rehearsal;
  const validation = ov?.validation ?? [];
  const rollbackDrill = ov?.rollback_drill ?? [];
  const runbook = ov?.runbook ?? [];
  const observation = ov?.observation ?? [];
  const allPass = validation.length > 0 && validation.every((v) => v.passed);

  return (
    <AdminSection
      title="Limited Runtime Apply Rehearsal (ALGO-8G)"
      description="0447/0448 Runtime Fix 를 실제 운영에 적용하지 않고 운영 절차를 끝까지 리허설합니다. Apply Script·Validation SQL·Rollback SQL·Observation Procedure·Operator Checklist 를 최종 검증합니다. 0447/0448 판정 로직을 INLINE 재현하여 회복치를 계산하므로 v2_verified_streams/v2_eligible_streams 정의와 원본 데이터는 변경되지 않습니다. 실제 Migration Apply 는 수행하지 않습니다."
      action={
        <div className="flex flex-wrap items-center gap-2">
          <AdminButton size="sm" variant="subtle" tone="neutral" leftIcon={<RefreshCw size={14} />} onClick={() => void load()}>새로고침</AdminButton>
          <AdminButton size="sm" tone="primary" leftIcon={<PlayCircle size={13} />} disabled={busy} onClick={() => void runAll()}>Rehearsal 실행 (Dry Run)</AdminButton>
        </div>
      }
    >
      <AdminAlert tone="info" className="mb-3" title="Dry Run — view/원본 무변경, 실제 Apply 없음"
        description="Rehearsal 은 0447/0448 로직을 INLINE 쿼리로 재현하여 verified/eligible/settlement 회복치를 계산할 뿐, 실제 view 를 CREATE OR REPLACE 하지 않습니다. Operator Runbook(실행 순서)·Validation Pack·Observation 체크리스트·Rollback Drill(SQL 문서화만) 을 생성하며, 어떤 것도 실제로 적용/롤백/예약되지 않습니다." />

      {loading && !ov ? (
        <AdminSkeleton variant="card" />
      ) : err ? (
        <AdminAlert tone="info" title="데이터 없음 / 미적용" description={err} action={<AdminButton size="sm" onClick={() => void load()}>재시도</AdminButton>} />
      ) : !ov?.has_data ? (
        <AdminEmpty icon={<FlaskConical size={22} />} title="아직 Rehearsal 이 없어요" description="상단 'Rehearsal 실행 (Dry Run)'을 누르세요 (rehearsal → observation → rollback drill)." />
      ) : (
        <div className="space-y-4">
          {/* Status */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            <AdminStatCard label="Result" value={reh?.result ?? '—'} tone={reh?.result === 'pass' ? 'success' : 'warning'} icon={<FlaskConical size={13} />} />
            <AdminStatCard label="Mode" value={reh?.mode ?? '—'} tone="info" />
            <AdminStatCard label="Verified" value={`${reh?.verified_current ?? 0}→${reh?.verified_rehearsed ?? 0}`} tone={(reh?.verified_rehearsed ?? 0) > (reh?.verified_current ?? 0) ? 'success' : 'neutral'} />
            <AdminStatCard label="Eligible" value={`${reh?.eligible_current ?? 0}→${reh?.eligible_rehearsed ?? 0}`} tone={(reh?.eligible_rehearsed ?? 0) > (reh?.eligible_current ?? 0) ? 'success' : 'neutral'} />
            <AdminStatCard label="Settlement" value={`${reh?.settlement_current ?? 0}→${reh?.settlement_rehearsed ?? 0}`} tone={(reh?.settlement_rehearsed ?? 0) > (reh?.settlement_current ?? 0) ? 'success' : 'neutral'} />
            <AdminStatCard label="Validation" value={allPass ? 'all pass' : 'review'} tone={allPass ? 'success' : 'warning'} />
          </div>
          {reh?.headline && <p className="text-[11px] text-ink-dim">{reh.headline} · {reh.rehearsal_id}</p>}

          {/* Operator Runbook */}
          <AdminCard title="Operator Runbook" subtitle="실행 순서: Apply → Validation → Observation → Rollback.">
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead className="text-ink-dim"><tr>
                  <th className="px-2 py-1 text-left">#</th><th className="px-2 py-1 text-left">phase</th>
                  <th className="px-2 py-1 text-left">action</th><th className="px-2 py-1 text-left">command</th>
                  <th className="px-2 py-1 text-left">expected</th>
                </tr></thead>
                <tbody>
                  {runbook.map((s) => (
                    <tr key={s.step} className="border-t border-line/10">
                      <td className="px-2 py-1 text-ink-dim">{s.step}</td>
                      <td className="px-2 py-1"><AdminBadge tone={phaseTone(s.phase)}>{s.phase}</AdminBadge></td>
                      <td className="px-2 py-1 text-ink">{s.action}</td>
                      <td className="px-2 py-1 font-mono text-ink-dim">{s.command}</td>
                      <td className="px-2 py-1 text-ink-dim">{s.expected}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </AdminCard>

          {/* Validation Pack */}
          <AdminCard title="Validation Pack" subtitle="verified/eligible/settlement 회복 + fraud/dispute/playback/v1 regression.">
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead className="text-ink-dim"><tr>
                  <th className="px-2 py-1 text-left">phase</th><th className="px-2 py-1 text-left">metric</th>
                  <th className="px-2 py-1 text-right">before</th><th className="px-2 py-1 text-right">after</th>
                  <th className="px-2 py-1 text-right">delta</th><th className="px-2 py-1 text-center">passed</th>
                </tr></thead>
                <tbody>
                  {validation.map((v, i) => (
                    <tr key={v.metric + i} className="border-t border-line/10">
                      <td className="px-2 py-1"><AdminBadge tone={phaseTone(v.phase)}>{v.phase}</AdminBadge></td>
                      <td className="px-2 py-1 text-ink">{v.metric}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-ink-dim">{v.before ?? '—'}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-ink">{v.after ?? '—'}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-ink-dim">{v.delta ?? '—'}</td>
                      <td className="px-2 py-1 text-center"><AdminBadge tone={v.passed ? 'success' : 'danger'}>{v.passed ? 'pass' : 'fail'}</AdminBadge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </AdminCard>

          {/* Observation + Rollback Drill */}
          <div className="grid gap-3 lg:grid-cols-2">
            <AdminCard title="Observation Procedure" subtitle="T+0 ~ T+24h 관찰 체크리스트 (예약/자동 실행 없음).">
              <div className="space-y-1">
                {observation.map((w) => (
                  <div key={w.label} className="rounded-lg border border-line/10 px-2.5 py-1.5 text-[11px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-ink"><Eye size={11} className="text-ink-dim" />{w.label}</span>
                      <AdminBadge tone="neutral">{w.status}</AdminBadge>
                    </div>
                    <p className="mt-0.5 truncate text-ink-dim" title={(w.checklist ?? []).join(', ')}>{(w.checklist ?? []).join(' · ')}</p>
                  </div>
                ))}
              </div>
            </AdminCard>

            <AdminCard title="Rollback Drill" subtitle="순서: 0448 → 0447 → 검증 · 실제 실행 금지 (문서화만).">
              {rollbackDrill.length > 0 ? (
                <div className="space-y-1">
                  {rollbackDrill.map((rb, i) => (
                    <div key={rb.metric + i} className="rounded-lg border border-line/10 px-2.5 py-1.5 text-[11px]">
                      <div className="flex items-center gap-1.5 text-ink"><Undo2 size={11} className="text-ink-dim" />{rb.metric}</div>
                      <code className="mt-0.5 block truncate text-ink-dim" title={rb.sql}>{rb.sql}</code>
                      <p className="text-ink-dim">{rb.note}</p>
                    </div>
                  ))}
                </div>
              ) : <AdminEmpty icon={<BookOpen size={20} />} title="rollback drill 없음" description="Rehearsal 을 실행하세요." />}
            </AdminCard>
          </div>

          <p className="flex items-center gap-1.5 text-[11px] text-ink-dim"><ListChecks size={12} /> Rehearsal 은 dry-run 이며 live v2_verified_streams/v2_eligible_streams 정의와 원본 이벤트/세션은 변경되지 않습니다.</p>
        </div>
      )}
    </AdminSection>
  );
}
