// Phase ALGO-5B — 관리자 AI Reinforcement Learning & Multi-Model Ensemble (Shadow) 패널.
// Reward Engine · Contextual Bandit · Ensemble · Model Tournament(ELO) · Store Personalization 관측.
// 운영 미반영 — Bandit/Ensemble/Tournament 는 Shadow 계산이며 자동 승격/적용이 없습니다.
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Trophy, Play, Layers, Cpu, Store } from 'lucide-react';
import { AdminSection, AdminCard, AdminButton, AdminBadge, AdminAlert, AdminEmpty, AdminSkeleton, AdminStatCard } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  adminGenerateRewardMemory, adminRunBanditShadow, adminGenerateEnsemble, adminRunModelTournament,
  adminAiRlOverview, type RlOverview,
} from '@/lib/rlApi';

const numf = (n: number | null | undefined) => (n == null ? '—' : Number(n).toFixed(3));
const pctf = (n: number | null | undefined) => (n == null ? '—' : `${(Number(n) * 100).toFixed(1)}%`);

const modelTone = (m: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' => {
  switch (m) {
    case 'ensemble': return 'success';
    case 'prediction': return 'info';
    case 'bandit': return 'warning';
    case 'calibration': return 'neutral';
    default: return 'neutral';
  }
};

export default function AiReinforcementPanel() {
  const [overview, setOverview] = useState<RlOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setOverview(await adminAiRlOverview()); }
    catch (e) { setErr(e instanceof Error ? e.message : '조회 실패 (0435 미적용 시 정상 — apply 후 표시)'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // 전체 RL 파이프라인: Reward → Bandit → Ensemble(weighted/dynamic) → Tournament(RR/BoN).
  async function runFullPipeline() {
    setBusy(true);
    try {
      const r = await adminGenerateRewardMemory(120, 200);
      await adminRunBanditShadow(null);
      await adminGenerateEnsemble('weighted', 'prediction');
      await adminGenerateEnsemble('dynamic', 'prediction');
      await adminRunModelTournament('round_robin', 'prediction', 3);
      toast.success(`RL 파이프라인 완료 — reward ${r.tracks}곡 · ${r.stores}개 스토어 · bandit/ensemble/tournament 갱신`);
      await load();
    } catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  async function runTournament(format: 'round_robin' | 'best_of_n') {
    setBusy(true);
    try {
      const t = await adminRunModelTournament(format, 'prediction', 5);
      toast.success(`Tournament(${format}) — ${t.matches} matches · 1위 ${t.ranking[0]?.model ?? '—'}`);
      await load();
    } catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  const reward = overview?.reward;
  const bandit = overview?.bandit;
  const tournament = overview?.tournament;
  const ensembles = overview?.ensembles ?? [];

  return (
    <AdminSection
      title="AI Reinforcement (Shadow)"
      description="여러 AI 모델을 동시에 운용하는 Ensemble 과 Reinforcement Learning(Reward · Contextual Bandit · Tournament) 을 Shadow 로 계산합니다. 실제 Queue/Playback/Scheduler/Exposure/Prediction/Settlement 에 반영하지 않습니다. (ALGO-5B)"
      action={
        <div className="flex flex-wrap items-center gap-2">
          <AdminButton size="sm" variant="subtle" tone="neutral" leftIcon={<RefreshCw size={14} />} onClick={() => void load()}>새로고침</AdminButton>
          <AdminButton size="sm" tone="primary" leftIcon={<Cpu size={13} />} disabled={busy} onClick={() => void runFullPipeline()}>RL 파이프라인 실행</AdminButton>
        </div>
      }
    >
      <AdminAlert tone="info" className="mb-3" title="Shadow RL — 실반영 없음"
        description="Reward Score 는 playback_events_v2(completion/skip/exposure/novelty/diversity/listener_fit) 를 집계한 값입니다. Bandit(Thompson/UCB/ε-Greedy/Softmax/Contextual) 은 arm 선택을 계산만 하며 실제 트래픽을 분배하지 않습니다. Tournament 는 ELO 랭킹을 매길 뿐 자동 승격/적용이 없습니다." />

      {loading && !overview ? (
        <AdminSkeleton variant="card" />
      ) : err ? (
        <AdminAlert tone="info" title="데이터 없음 / 미적용" description={err} action={<AdminButton size="sm" onClick={() => void load()}>재시도</AdminButton>} />
      ) : !overview?.has_data ? (
        <AdminEmpty icon={<Cpu size={22} />} title="아직 RL 데이터가 없어요" description="상단 'RL 파이프라인 실행'을 누르세요 (Reward → Bandit → Ensemble → Tournament, 모두 Shadow)." />
      ) : (
        <div className="space-y-4">
          {/* Reward overview */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <AdminStatCard label="Avg Reward" value={numf(reward?.avg_reward)} tone={((reward?.avg_reward ?? 0) >= 0.5) ? 'success' : 'warning'} />
            <AdminStatCard label="Scored Tracks" value={String(reward?.track_count ?? 0)} tone="info" />
            <AdminStatCard label="Cold Start" value={String(reward?.cold_start ?? 0)} tone={(reward?.cold_start ?? 0) > 0 ? 'warning' : 'neutral'} />
            <AdminStatCard label="Ensembles" value={String(ensembles.length)} tone="neutral" />
          </div>

          {/* Bandit arms + algorithms */}
          <div className="grid gap-3 lg:grid-cols-2">
            <AdminCard title="Contextual Bandit — Arms" subtitle="모델별 value estimate(β posterior). Shadow — 실제 분배 없음.">
              {bandit?.arms && bandit.arms.length > 0 ? (
                <div className="space-y-1.5">
                  {bandit.arms.map((a) => (
                    <div key={a.arm} className="flex items-center gap-2 text-[11px]">
                      <span className="w-32 shrink-0 font-mono text-ink">{a.arm}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-line/15">
                        <div className="h-full rounded-full bg-accent/70" style={{ width: `${Math.min(a.value * 100, 100)}%` }} />
                      </div>
                      <span className="w-12 shrink-0 text-right tabular-nums text-ink">{numf(a.value)}</span>
                      <span className="w-16 shrink-0 text-right text-ink-dim">{a.pulls} pulls</span>
                    </div>
                  ))}
                </div>
              ) : <AdminEmpty title="arm 없음" description="RL 파이프라인을 실행하세요." />}
            </AdminCard>

            <AdminCard title="Bandit Algorithm Selection" subtitle="5개 알고리즘의 shadow arm 선택 결과.">
              {bandit?.algorithms && bandit.algorithms.length > 0 ? (
                <div className="space-y-1.5">
                  {bandit.algorithms.map((a) => (
                    <div key={a.algorithm} className="flex items-center justify-between rounded-lg border border-line/15 px-2.5 py-1.5 text-[11px]">
                      <span className="text-ink-dim">{a.algorithm}</span>
                      <AdminBadge tone="info">{a.selected}</AdminBadge>
                    </div>
                  ))}
                </div>
              ) : <p className="text-[11px] text-ink-dim">알고리즘 결과가 없습니다.</p>}
            </AdminCard>
          </div>

          {/* Ensemble results */}
          <AdminCard title="Model Ensembles" subtitle="weighted / voting / stacking / dynamic — 멤버 가중 blended score. 계산만.">
            {ensembles.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="text-ink-dim"><tr>
                    <th className="px-2 py-1 text-left">ensemble</th><th className="px-2 py-1 text-left">type</th>
                    <th className="px-2 py-1 text-right">blended score</th>
                  </tr></thead>
                  <tbody>
                    {ensembles.map((e) => (
                      <tr key={e.key} className="border-t border-line/10">
                        <td className="px-2 py-1 font-mono text-ink flex items-center gap-1.5"><Layers size={12} className="text-ink-dim" />{e.key}</td>
                        <td className="px-2 py-1"><AdminBadge tone="neutral">{e.type}</AdminBadge></td>
                        <td className="px-2 py-1 text-right tabular-nums text-ink">{numf(e.blended)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <AdminEmpty title="ensemble 없음" description="RL 파이프라인을 실행하세요." />}
          </AdminCard>

          {/* Tournament ELO ranking */}
          <AdminCard
            title="Model Tournament — ELO Ranking"
            subtitle="Round Robin / Best of N 결과. Win Rate · Promotion Score. Shadow — 자동 승격 없음."
            action={
              <div className="flex items-center gap-1.5">
                <AdminButton size="sm" variant="subtle" tone="primary" leftIcon={<Play size={11} />} disabled={busy} onClick={() => void runTournament('round_robin')}>Round Robin</AdminButton>
                <AdminButton size="sm" variant="ghost" tone="neutral" leftIcon={<Play size={11} />} disabled={busy} onClick={() => void runTournament('best_of_n')}>Best of N</AdminButton>
              </div>
            }
          >
            {tournament?.elo && tournament.elo.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="text-ink-dim"><tr>
                    <th className="px-2 py-1 text-left">#</th><th className="px-2 py-1 text-left">model</th>
                    <th className="px-2 py-1 text-right">ELO</th><th className="px-2 py-1 text-right">W/L</th>
                    <th className="px-2 py-1 text-right">win rate</th><th className="px-2 py-1 text-right">promotion</th>
                  </tr></thead>
                  <tbody>
                    {tournament.elo.map((e, i) => (
                      <tr key={e.model} className="border-t border-line/10">
                        <td className="px-2 py-1">{i === 0 ? <Trophy size={12} className="text-accent" /> : <span className="text-ink-dim">{i + 1}</span>}</td>
                        <td className="px-2 py-1 font-mono text-ink">{e.model}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-ink">{e.elo.toFixed(0)}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-ink-dim">{e.wins}/{e.losses}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{pctf(e.win_rate)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{numf(e.promotion_score)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-1.5 text-[10px] text-ink-dim">tournament matches: {tournament.matches}</p>
              </div>
            ) : <AdminEmpty title="tournament 없음" description="상단 버튼으로 토너먼트를 실행하세요." />}
          </AdminCard>

          {/* Reward by store + Store personalization */}
          <div className="grid gap-3 lg:grid-cols-2">
            <AdminCard title="Reward by Store Type" subtitle="store_type_slug 별 reward(completion/skip 반영).">
              {reward?.stores && reward.stores.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead className="text-ink-dim"><tr>
                      <th className="px-2 py-1 text-left">store</th><th className="px-2 py-1 text-right">reward</th>
                      <th className="px-2 py-1 text-right">completion</th><th className="px-2 py-1 text-right">skip</th>
                    </tr></thead>
                    <tbody>
                      {reward.stores.map((s) => (
                        <tr key={s.store} className="border-t border-line/10">
                          <td className="px-2 py-1 font-mono text-ink">{s.store}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-ink">{numf(s.reward)}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-ink-dim">{numf(s.completion)}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-ink-dim">{numf(s.skip)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <AdminEmpty title="store reward 없음" description="RL 파이프라인을 실행하세요." />}
            </AdminCard>

            <AdminCard title="Store Personalization" subtitle="스토어별 추천 모델(reward+bandit+prediction+ensemble). Shadow profile.">
              {bandit?.store_profiles && bandit.store_profiles.length > 0 ? (
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {bandit.store_profiles.map((s) => (
                    <div key={s.store} className="flex items-center justify-between rounded-lg border border-line/15 px-2.5 py-1.5 text-[11px]">
                      <span className="flex items-center gap-1.5 text-ink"><Store size={11} className="text-ink-dim" />{s.store}</span>
                      <AdminBadge tone={modelTone(s.top_model)}>{s.top_model}</AdminBadge>
                    </div>
                  ))}
                </div>
              ) : <AdminEmpty title="profile 없음" description="RL 파이프라인을 실행하세요." />}
            </AdminCard>
          </div>

          {/* Industry reward */}
          {reward?.industries && reward.industries.length > 0 && (
            <AdminCard title="Industry Reward" subtitle="업종 버킷별 reward 집계.">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {reward.industries.map((ind) => (
                  <AdminStatCard key={ind.industry} label={ind.industry} value={numf(ind.reward)} tone={ind.reward >= 0.5 ? 'success' : 'neutral'} />
                ))}
              </div>
            </AdminCard>
          )}
        </div>
      )}
    </AdminSection>
  );
}
