// Phase ALGO-4A — 관리자 AI Exposure Engine (Shadow) 패널.
// Exposure Score / Genome / Shadow Queue / Explain 관측 전용.
// 실제 Queue/Scheduler/Playback/Settlement 무변경. SHADOW ONLY.
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Sparkles, Play, Radio } from 'lucide-react';
import { AdminSection, AdminCard, AdminButton, AdminBadge, AdminAlert, AdminEmpty, AdminSkeleton, AdminStatCard, AdminModal } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  adminGenerateExposureScores, adminExposureOverview, adminGenerateShadowQueue, adminGetExposureExplain,
  type ExposureOverview, type ExposureCandidate, type ExposureExplain,
} from '@/lib/exposureApi';

const pctf = (n: number | null | undefined) => (n == null ? '—' : `${(n * 100).toFixed(0)}%`);
const scoref = (n: number | null | undefined) => (n == null ? '—' : n.toFixed(3));

function CandidateTable({ rows, onExplain }: { rows: ExposureCandidate[]; onExplain: (id: string) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead className="text-ink-dim"><tr>
          <th className="px-2 py-1 text-left">#</th><th className="px-2 py-1 text-left">track</th>
          <th className="px-2 py-1 text-left">genre</th><th className="px-2 py-1 text-right">fresh</th>
          <th className="px-2 py-1 text-right">compl</th><th className="px-2 py-1 text-right">skip</th>
          <th className="px-2 py-1 text-right">penalty</th><th className="px-2 py-1 text-right">exposure</th>
          <th className="px-2 py-1 text-left">settle</th><th className="px-2 py-1"></th>
        </tr></thead>
        <tbody>
          {rows.map((c, i) => (
            <tr key={(c.track_id ?? '') + i} className="border-t border-line/10">
              <td className="px-2 py-1 text-ink-dim">{c.rank ?? i + 1}</td>
              <td className="px-2 py-1 max-w-[160px] truncate text-ink-mute" title={c.track_title ?? ''}>{c.track_title ?? '—'}</td>
              <td className="px-2 py-1 text-ink-dim">{c.main_genre ?? '—'}</td>
              <td className="px-2 py-1 text-right tabular-nums">{pctf(c.freshness)}</td>
              <td className="px-2 py-1 text-right tabular-nums">{pctf(c.completion_rate)}</td>
              <td className="px-2 py-1 text-right tabular-nums">{pctf(c.skip_rate)}</td>
              <td className="px-2 py-1 text-right tabular-nums">{c.penalty > 0 ? <AdminBadge tone="warning">{pctf(c.penalty)}</AdminBadge> : '—'}</td>
              <td className="px-2 py-1 text-right font-semibold tabular-nums text-ink">{scoref(c.exposure_score)}</td>
              <td className="px-2 py-1"><AdminBadge tone={c.settlement_eligible ? 'success' : 'neutral'}>{c.settlement_eligible ? '✓' : '—'}</AdminBadge></td>
              <td className="px-2 py-1 text-right">
                {c.exposure_id
                  ? <button className="text-accent hover:underline" onClick={() => onExplain(c.exposure_id)}>explain</button>
                  : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ExposurePanel() {
  const [overview, setOverview] = useState<ExposureOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [explainId, setExplainId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setOverview(await adminExposureOverview(null)); }
    catch (e) { setErr(e instanceof Error ? e.message : '조회 실패 (0430 미적용 시 정상 — apply 후 표시)'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function generate() {
    setBusy(true);
    try {
      const r = await adminGenerateExposureScores(null, 100);
      toast.success(`Exposure 생성 — track ${r.track_count} · store ${r.store_count} · score ${r.score_count}`);
      await load();
    } catch (e) { toast.error(`생성 실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  async function genQueue(storeId: string | null) {
    if (!storeId) { toast.error('store 선택 필요'); return; }
    setBusy(true);
    try {
      const r = await adminGenerateShadowQueue(storeId, 20);
      toast.success(`Shadow Queue 생성 — ${r.queue_size}곡 (실제 재생 순서 무관)`);
    } catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  const run = overview?.run;

  return (
    <AdminSection
      title="AI Exposure (Shadow)"
      description="가장 적합한 곡을 가장 적절한 순간에 노출하기 위한 Exposure Score 를 shadow 로 계산합니다. 실제 Queue/재생 순서/정산은 변경되지 않습니다. (ALGO-4A)"
      action={
        <div className="flex flex-wrap items-center gap-2">
          <AdminButton size="sm" variant="subtle" tone="neutral" leftIcon={<RefreshCw size={14} />} onClick={() => void load()}>새로고침</AdminButton>
          <AdminButton size="sm" tone="primary" leftIcon={<Sparkles size={13} />} disabled={busy} onClick={() => void generate()}>Exposure 생성</AdminButton>
        </div>
      }
    >
      <AdminAlert tone="info" className="mb-3" title="Shadow Only — 실제 Queue 미반영"
        description="Exposure 는 재생을 늘리는 엔진이 아니라 적합·적시 노출을 계산하는 엔진입니다. 이 점수는 관측/비교용이며, 실제 재생 순서·Scheduler·Playback·Settlement 는 그대로입니다. ALGO-4B에서 실제 Queue와 비교 검증합니다." />

      {loading && !overview ? (
        <AdminSkeleton variant="card" />
      ) : err ? (
        <AdminAlert tone="info" title="데이터 없음 / 미적용" description={err} action={<AdminButton size="sm" onClick={() => void load()}>재시도</AdminButton>} />
      ) : !overview?.has_data ? (
        <AdminEmpty icon={<Sparkles size={22} />} title="아직 Exposure 생성 이력이 없어요" description="상단 'Exposure 생성'을 실행하세요 (shadow 계산)." />
      ) : (
        <div className="space-y-4">
          {/* Run overview */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <AdminStatCard label="Tracks" value={String(run?.track_count ?? 0)} />
            <AdminStatCard label="Stores" value={String(run?.store_count ?? 0)} tone="info" />
            <AdminStatCard label="Scores" value={String(run?.score_count ?? 0)} tone="success" />
            <AdminStatCard label="Formula" value={`v${run?.formula_version ?? 1}`} />
          </div>

          {/* Store profiles */}
          {overview.stores && overview.stores.length > 0 && (
            <AdminCard title="Store Profiles" subtitle="store별 후보 수 / 평균·최대 Exposure. Shadow Queue를 생성해 볼 수 있습니다.">
              <div className="space-y-1.5">
                {overview.stores.map((s) => (
                  <div key={s.store_id ?? Math.random()} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line/15 bg-bg px-3 py-1.5 text-[11px]">
                    <span className="flex items-center gap-2">
                      <Radio size={12} className="text-ink-dim" />
                      <span className="text-ink">{s.store_name ?? (s.store_id ?? '—').slice(0, 8)}</span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="text-ink-dim">후보 {s.candidate_count}</span>
                      <span className="text-ink-dim">avg {scoref(s.avg_exposure)}</span>
                      <span className="text-ink">max {scoref(s.max_exposure)}</span>
                      <AdminButton size="sm" variant="subtle" tone="neutral" leftIcon={<Play size={11} />} disabled={busy} onClick={() => void genQueue(s.store_id)}>Shadow Queue</AdminButton>
                    </span>
                  </div>
                ))}
              </div>
            </AdminCard>
          )}

          {/* High exposure */}
          {overview.top_candidates && overview.top_candidates.length > 0 && (
            <AdminCard title="High Exposure — Top Candidates" subtitle="Exposure Score 상위. 행의 explain으로 산출 근거(Store/Genre/Mood/Freshness/Settlement/Penalty)를 확인합니다.">
              <CandidateTable rows={overview.top_candidates} onExplain={setExplainId} />
            </AdminCard>
          )}

          {/* Low exposure */}
          {overview.low_exposure && overview.low_exposure.length > 0 && (
            <AdminCard title="Low Exposure" subtitle="노출 점수 하위 — 재노출/보정 후보 관측용.">
              <CandidateTable rows={overview.low_exposure} onExplain={setExplainId} />
            </AdminCard>
          )}
        </div>
      )}

      {explainId && <ExplainModal id={explainId} onClose={() => setExplainId(null)} />}
    </AdminSection>
  );
}

function ExplainModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<ExposureExplain | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void adminGetExposureExplain(id).then((d) => { if (alive) setData(d); }).catch((e) => { if (alive) setErr(e instanceof Error ? e.message : '조회 실패'); });
    return () => { alive = false; };
  }, [id]);

  const ex = (data?.explain ?? {}) as Record<string, number | string>;
  const factors: Array<[string, string]> = [
    ['store_fit', 'Store Fit'], ['genre_fit', 'Genre Fit'], ['mood_fit', 'Mood Fit'],
    ['freshness', 'Freshness'], ['completion_rate', 'Completion'], ['skip_rate', 'Skip'],
    ['settlement_quality', 'Settlement'], ['track_quality', 'Track Quality'], ['learning_score', 'Learning'],
  ];

  return (
    <AdminModal open onClose={onClose} title="Exposure Explain (AI 산출 근거)" size="lg"
      footer={<AdminButton tone="neutral" variant="subtle" onClick={onClose}>닫기</AdminButton>}>
      {err ? <AdminAlert tone="danger" title="오류" description={err} />
        : !data ? <AdminSkeleton variant="block" rows={6} />
        : (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border border-line/15 bg-bg px-3 py-2 text-xs">
              <span className="text-ink-mute">{data.track_title ?? data.track_id.slice(0, 8)}</span>
              <span className="font-bold text-ink">Exposure {scoref(data.exposure_score)}</span>
            </div>
            <AdminCard title="Score 요소">
              <div className="space-y-1">
                {factors.map(([k, label]) => {
                  const v = typeof ex[k] === 'number' ? (ex[k] as number) : null;
                  return (
                    <div key={k} className="flex items-center gap-2 text-[11px]">
                      <span className="w-28 shrink-0 text-ink-dim">{label}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-line/15">
                        <div className="h-full rounded-full bg-accent/70" style={{ width: `${Math.min((v ?? 0) * 100, 100)}%` }} />
                      </div>
                      <span className="w-10 shrink-0 text-right tabular-nums text-ink">{v == null ? '—' : v.toFixed(2)}</span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 flex items-center justify-between border-t border-line/10 pt-2 text-[11px]">
                <span className="text-ink-dim">base {scoref(ex.base_score as number)} · penalty {ex.penalty ?? 0}</span>
                <span className="font-semibold text-ink">final {scoref(ex.final_score as number)}</span>
              </div>
            </AdminCard>
            {data.genome && (
              <AdminCard title="Track Genome">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-3">
                  {['main_genre', 'mood', 'vocal_type', 'language', 'release_age_days', 'duration', 'popularity', 'instrumental', 'explicit'].map((k) => (
                    <div key={k} className="flex justify-between border-b border-line/5 pb-0.5">
                      <span className="text-ink-dim">{k}</span>
                      <span className="text-ink-mute">{String((data.genome as Record<string, unknown>)[k] ?? '—')}</span>
                    </div>
                  ))}
                </div>
              </AdminCard>
            )}
          </div>
        )}
    </AdminModal>
  );
}
