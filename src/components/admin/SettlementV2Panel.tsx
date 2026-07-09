// Phase ALGO-3 — 관리자 Settlement v2 (Shadow) 패널.
// Shadow 정산 계산·비교·설명 관측 전용. 실제 지급 미사용. v1 정산 무변경.
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Play, Sparkles } from 'lucide-react';
import { AdminSection, AdminCard, AdminButton, AdminBadge, AdminAlert, AdminEmpty, AdminSkeleton, AdminStatCard, AdminModal } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  adminGenerateSettlementV2, adminSettlementV2Overview, adminSettlementV2Compare, adminGetSettlementV2Explain,
  type StreamSource, type SettlementV2Overview, type SettlementV2Compare, type SettlementV2Explain,
} from '@/lib/settlementV2Api';

const inputCls = 'rounded-lg border border-line/25 bg-bg px-2.5 py-1.5 text-xs text-ink outline-none focus:border-accent/50';
const won = (n: number | null | undefined) => (n == null ? '—' : `${n.toLocaleString('ko-KR')}원`);

function currentMonthStart(): string {
  // KST 기준 이번 달 1일 (YYYY-MM-01)
  const now = new Date();
  const kst = new Date(now.getTime() + (9 * 60 + now.getTimezoneOffset()) * 60000);
  return `${kst.getFullYear()}-${String(kst.getMonth() + 1).padStart(2, '0')}-01`;
}

export default function SettlementV2Panel() {
  const [month, setMonth] = useState(currentMonthStart());
  const [source, setSource] = useState<StreamSource>('v1_basis');
  const [overview, setOverview] = useState<SettlementV2Overview | null>(null);
  const [compare, setCompare] = useState<SettlementV2Compare | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [explainId, setExplainId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [ov, cmp] = await Promise.all([
        adminSettlementV2Overview(month),
        adminSettlementV2Compare(month, source).catch(() => null),
      ]);
      setOverview(ov); setCompare(cmp);
    } catch (e) { setErr(e instanceof Error ? e.message : '조회 실패 (0420 미적용 시 정상 — apply 후 표시)'); }
    finally { setLoading(false); }
  }, [month, source]);
  useEffect(() => { void load(); }, [load]);

  async function generate(dryRun: boolean) {
    setBusy(true);
    try {
      const r = await adminGenerateSettlementV2(month, dryRun, source);
      toast.success(`Shadow 정산 ${dryRun ? '(dry-run) ' : ''}완료 — 아티스트 ${r.artist_count} · pool ${won(r.pool_revenue)}`);
      await load();
    } catch (e) { toast.error(`생성 실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  const run = overview?.run;
  const sum = compare?.summary;

  return (
    <AdminSection
      title="정산 v2 (Shadow)"
      description="차세대 Settlement Engine(v2) shadow 계산·비교·설명 전용입니다. 실제 지급에는 사용되지 않으며 기존 v1 정산/지급/UI는 그대로입니다. (ALGO-3)"
      action={
        <div className="flex flex-wrap items-center gap-2">
          <input type="text" className={inputCls} value={month} onChange={(e) => setMonth(e.target.value)} placeholder="YYYY-MM-01" style={{ width: 110 }} />
          <select className={inputCls} value={source} onChange={(e) => setSource(e.target.value as StreamSource)}>
            <option value="v1_basis">v1_basis (검증)</option>
            <option value="v2_shadow">v2_shadow</option>
          </select>
          <AdminButton size="sm" variant="subtle" tone="neutral" leftIcon={<RefreshCw size={14} />} onClick={() => void load()}>새로고침</AdminButton>
          <AdminButton size="sm" variant="subtle" tone="neutral" disabled={busy} onClick={() => void generate(true)}>dry-run</AdminButton>
          <AdminButton size="sm" tone="primary" leftIcon={<Play size={13} />} disabled={busy} onClick={() => void generate(false)}>Shadow 생성</AdminButton>
        </div>
      }
    >
      <AdminAlert tone="warning" className="mb-3" title="Shadow Only — 실제 지급 미사용"
        description="이 정산 결과는 관측/비교용입니다. 실제 아티스트/본사 지급은 v1(admin_generate_monthly_settlement)이 계속 담당합니다. ALGO-4에서 충분한 검증 후 전환 여부를 결정합니다." />

      {loading && !overview ? (
        <AdminSkeleton variant="card" />
      ) : err ? (
        <AdminAlert tone="info" title="데이터 없음 / 미적용" description={err} action={<AdminButton size="sm" onClick={() => void load()}>재시도</AdminButton>} />
      ) : (
        <div className="space-y-4">
          {/* Run overview */}
          {run ? (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                <AdminStatCard label="Revenue Pool" value={won(run.pool_revenue)} tone="info" />
                <AdminStatCard label="Eligible Streams" value={String(run.total_eligible_streams ?? 0)} />
                <AdminStatCard label="Revenue Weight" value={String(run.total_revenue_weight ?? 0)} />
                <AdminStatCard label="Artists" value={String(run.artist_count ?? 0)} />
                <AdminStatCard label="Carryover" value={won(run.total_carried_over)} tone="warning" />
                <AdminStatCard label="Version" value={`v${run.version}`} />
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <AdminStatCard label="Gross" value={won(run.total_gross)} />
                <AdminStatCard label="Company Fee" value={won(run.total_company_fee)} />
                <AdminStatCard label="Agent Fee" value={won(run.total_agent_fee)} />
                <AdminStatCard label="Final" value={won(run.total_final)} tone="success" />
              </div>
              <p className="text-[11px] text-ink-dim">source={run.stream_source} · run {new Date(run.run_at).toLocaleString('ko-KR')} · fraud {run.fraud_count ?? 0} · rejected {run.rejected_count ?? 0}</p>
            </>
          ) : (
            <AdminEmpty icon={<Play size={22} />} title="아직 생성된 Shadow 정산이 없어요" description="상단에서 월을 선택하고 'Shadow 생성'을 실행하세요." />
          )}

          {/* v1 vs v2 compare */}
          <AdminCard title="v1 vs v2 비교 (Shadow Compare)" subtitle="v2 는 현재 데이터 기준 재계산 · v1 은 저장된 스냅샷. 차이는 데이터 시점/정책 차이로 설명 가능해야 합니다.">
            {!sum ? (
              <AdminEmpty title="비교 데이터 없음" description="Shadow 생성 후 표시됩니다." />
            ) : (
              <>
                <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <AdminStatCard label="v1 Net" value={won(sum.v1_net)} />
                  <AdminStatCard label="v2 Net" value={won(sum.v2_net)} tone="info" />
                  <AdminStatCard label="Net 일치" value={String(sum.net_match_count)} tone="success" />
                  <AdminStatCard label="Net 불일치" value={String(sum.net_diff_count)} tone={sum.net_diff_count > 0 ? 'warning' : 'neutral'} />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead className="text-ink-dim"><tr>
                      <th className="px-2 py-1 text-left">artist</th>
                      <th className="px-2 py-1 text-right">v1 gross</th><th className="px-2 py-1 text-right">v2 gross</th>
                      <th className="px-2 py-1 text-right">v1 net</th><th className="px-2 py-1 text-right">v2 net</th>
                      <th className="px-2 py-1 text-right">net Δ</th>
                    </tr></thead>
                    <tbody>
                      {compare!.rows.slice(0, 100).map((r) => (
                        <tr key={r.artist_user_id ?? Math.random()} className="border-t border-line/10">
                          <td className="px-2 py-1 font-mono text-ink-dim">{(r.artist_user_id ?? '—').slice(0, 8)}…</td>
                          <td className="px-2 py-1 text-right">{won(r.v1_gross)}</td>
                          <td className="px-2 py-1 text-right">{won(r.v2_gross)}</td>
                          <td className="px-2 py-1 text-right">{won(r.v1_net)}</td>
                          <td className="px-2 py-1 text-right">{won(r.v2_net)}</td>
                          <td className="px-2 py-1 text-right"><AdminBadge tone={r.net_diff === 0 ? 'neutral' : 'warning'}>{r.net_diff > 0 ? '+' : ''}{r.net_diff.toLocaleString('ko-KR')}</AdminBadge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </AdminCard>

          {/* Top artists + explain */}
          {overview?.top_artists && overview.top_artists.length > 0 && (
            <AdminCard title="상위 아티스트 (Explain)" subtitle="행을 클릭하면 정산 산출 근거(Explain)를 확인합니다.">
              <div className="space-y-1">
                {overview.top_artists.map((a) => (
                  <button key={a.id} onClick={() => setExplainId(a.id)}
                    className="flex w-full items-center justify-between rounded-lg border border-line/15 bg-bg px-3 py-1.5 text-xs hover:border-accent/40">
                    <span className="flex items-center gap-2"><Sparkles size={12} className="text-ink-dim" /><span className="font-mono text-ink-mute">{a.artist_user_id.slice(0, 8)}…</span></span>
                    <span className="flex items-center gap-3"><span className="text-ink-dim">eligible {a.eligible}</span><span className="font-semibold text-ink">{won(a.gross)}</span></span>
                  </button>
                ))}
              </div>
            </AdminCard>
          )}
        </div>
      )}

      {explainId && <ExplainModal id={explainId} onClose={() => setExplainId(null)} />}
    </AdminSection>
  );
}

function ExplainModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<SettlementV2Explain | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void adminGetSettlementV2Explain(id).then((d) => { if (alive) setData(d); }).catch((e) => { if (alive) setErr(e instanceof Error ? e.message : '조회 실패'); });
    return () => { alive = false; };
  }, [id]);

  const steps = (data?.explain?.steps as Array<Record<string, unknown>> | undefined) ?? null;

  return (
    <AdminModal open onClose={onClose} title="정산 산출 근거 (Explain)" size="lg" footer={<AdminButton tone="neutral" variant="subtle" onClick={onClose}>닫기</AdminButton>}>
      {err ? <AdminAlert tone="danger" title="오류" description={err} />
        : !data ? <AdminSkeleton variant="block" rows={6} />
        : (
          <div className="space-y-3">
            <AdminCard title="산출 단계">
              {steps ? (
                <ol className="space-y-1">
                  {steps.map((s, i) => (
                    <li key={i} className="flex items-center justify-between border-b border-line/5 pb-1 text-xs">
                      <span className="text-ink-mute">{String(s.step)}</span>
                      <span className="font-semibold text-ink">{typeof s.value === 'number' ? (s.value as number).toLocaleString('ko-KR') : String(s.value)}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <pre className="overflow-x-auto rounded bg-bg p-2 text-[11px] text-ink-mute">{JSON.stringify(data.explain, null, 2)}</pre>
              )}
            </AdminCard>
            <AdminCard title={`트랙별 기여 (${data.items.length})`}>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="text-ink-dim"><tr><th className="px-2 py-1 text-left">track</th><th className="px-2 py-1 text-right">eligible</th><th className="px-2 py-1 text-right">weight</th><th className="px-2 py-1 text-right">share</th></tr></thead>
                  <tbody>
                    {data.items.map((it) => (
                      <tr key={it.track_id} className="border-t border-line/10">
                        <td className="px-2 py-1 text-ink">{it.track_title ?? it.track_id?.slice(0, 8)}</td>
                        <td className="px-2 py-1 text-right">{it.eligible}</td>
                        <td className="px-2 py-1 text-right">{it.weight}</td>
                        <td className="px-2 py-1 text-right font-semibold">{won(it.share)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </AdminCard>
          </div>
        )}
    </AdminModal>
  );
}
