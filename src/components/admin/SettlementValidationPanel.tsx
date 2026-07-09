// Phase ALGO-3B — 관리자 Settlement Validation & Cutover Readiness 패널.
// v1/v2 다각도 비교 · Difference Classifier · Readiness Score · AI Summary · Trend.
// 분석 전용 — 실제 지급/정산 무변경. Cutover 는 ALGO-4 에서 별도 결정.
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Gauge, Sparkles, TrendingUp } from 'lucide-react';
import { AdminSection, AdminCard, AdminButton, AdminBadge, AdminAlert, AdminEmpty, AdminSkeleton } from '@/components/admin/ui';
import type { StreamSource } from '@/lib/settlementV2Api';
import {
  adminSettlementValidation, adminSettlementReadiness, adminSettlementDifferenceAI,
  adminSettlementArtistCompare, adminSettlementTrackCompare, adminSettlementStoreCompare, adminSettlementBrandCompare,
  type SettlementValidation, type SettlementReadiness, type DifferenceAI,
  type ArtistCompare, type TrackCompare, type StoreCompare, type BrandCompare,
} from '@/lib/settlementValidationApi';

const inputCls = 'rounded-lg border border-line/25 bg-bg px-2.5 py-1.5 text-xs text-ink outline-none focus:border-accent/50';
const won = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n).toLocaleString('ko-KR')}원`);
const num = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString('ko-KR'));
const pct = (n: number | null | undefined) => (n == null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(1)}%`);

function currentMonthStart(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + (9 * 60 + now.getTimezoneOffset()) * 60000);
  return `${kst.getFullYear()}-${String(kst.getMonth() + 1).padStart(2, '0')}-01`;
}

const REASON_TONE: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  MATCH: 'success', DATA_VINTAGE: 'info', NEW_STREAM: 'info', STREAMING_V2: 'info',
  POLICY: 'warning', ROUNDING: 'neutral', BUG: 'danger', UNKNOWN: 'warning', NO_V2_RUN: 'neutral',
};
const scoreTone = (s: number): 'success' | 'info' | 'warning' | 'danger' =>
  s >= 98 ? 'success' : s >= 90 ? 'info' : s >= 70 ? 'warning' : 'danger';

export default function SettlementValidationPanel() {
  const [month, setMonth] = useState(currentMonthStart());
  const [source, setSource] = useState<StreamSource>('v1_basis');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [validation, setValidation] = useState<SettlementValidation | null>(null);
  const [readiness, setReadiness] = useState<SettlementReadiness | null>(null);
  const [ai, setAi] = useState<DifferenceAI | null>(null);
  const [artist, setArtist] = useState<ArtistCompare | null>(null);
  const [track, setTrack] = useState<TrackCompare | null>(null);
  const [store, setStore] = useState<StoreCompare | null>(null);
  const [brand, setBrand] = useState<BrandCompare | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [v, r, a, ar, tr, st, br] = await Promise.all([
        adminSettlementValidation(month, source),
        adminSettlementReadiness(month, source),
        adminSettlementDifferenceAI(month, source),
        adminSettlementArtistCompare(month, source).catch(() => null),
        adminSettlementTrackCompare(month, source).catch(() => null),
        adminSettlementStoreCompare(month).catch(() => null),
        adminSettlementBrandCompare(month, source).catch(() => null),
      ]);
      setValidation(v); setReadiness(r); setAi(a);
      setArtist(ar); setTrack(tr); setStore(st); setBrand(br);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '조회 실패 (0421 미적용 시 정상 — apply 후 표시)');
    } finally { setLoading(false); }
  }, [month, source]);
  useEffect(() => { void load(); }, [load]);

  const rs = readiness?.readiness_score ?? 0;
  const comps = readiness?.components;
  const aiPct = ai?.pct ?? {};

  return (
    <AdminSection
      title="정산 검증 (Validation & Readiness)"
      description="Settlement v1/v2 를 다각도로 비교하고 Cutover 준비도를 측정합니다. 분석 전용 — 실제 지급/정산은 변경되지 않습니다. (ALGO-3B)"
      action={
        <div className="flex flex-wrap items-center gap-2">
          <input type="text" className={inputCls} value={month} onChange={(e) => setMonth(e.target.value)} placeholder="YYYY-MM-01" style={{ width: 110 }} />
          <select className={inputCls} value={source} onChange={(e) => setSource(e.target.value as StreamSource)}>
            <option value="v1_basis">v1_basis (검증)</option>
            <option value="v2_shadow">v2_shadow</option>
          </select>
          <AdminButton size="sm" variant="subtle" tone="neutral" leftIcon={<RefreshCw size={14} />} onClick={() => void load()}>새로고침</AdminButton>
        </div>
      }
    >
      <AdminAlert tone="info" className="mb-3" title="분석 전용 — Shadow 비교"
        description="Readiness Score ≥ 98 이 (v1 baseline 이 존재하는) 3개월 연속 유지될 때에만 ALGO-4 에서 Settlement v2 Cutover 를 검토합니다. 실제 지급은 계속 v1 이 담당합니다." />

      {loading && !readiness ? (
        <AdminSkeleton variant="card" />
      ) : err ? (
        <AdminAlert tone="info" title="데이터 없음 / 미적용" description={err} action={<AdminButton size="sm" onClick={() => void load()}>재시도</AdminButton>} />
      ) : !readiness?.has_v2 ? (
        <AdminEmpty icon={<Gauge size={22} />} title="v2 Shadow run 이 없습니다"
          description="정산 v2 (Shadow) 탭에서 해당 월의 Shadow 정산을 먼저 생성하세요." />
      ) : (
        <div className="space-y-4">
          {/* Readiness Score */}
          <AdminCard title="Settlement Readiness Score" subtitle="Difference(40) + No Bug(25) + Shadow Stable(15) + Replay Stable(10) + Health(10)">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex flex-col items-center justify-center rounded-2xl border border-line/20 bg-bg px-6 py-3">
                <span className="text-4xl font-bold tabular-nums text-ink">{rs.toFixed(0)}</span>
                <span className="text-[10px] uppercase tracking-wide text-ink-dim">/ 100</span>
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <AdminBadge tone={scoreTone(rs)}>{rs >= 98 ? 'Cutover 임계 도달' : rs >= 90 ? '안정' : rs >= 70 ? '관찰 필요' : '미흡'}</AdminBadge>
                  <AdminBadge tone={readiness.cutover_candidate ? 'success' : 'neutral'}>
                    {readiness.cutover_candidate ? 'Cutover 후보' : 'Cutover 미충족'}
                  </AdminBadge>
                  <AdminBadge tone={REASON_TONE[readiness.primary_reason ?? 'UNKNOWN'] ?? 'neutral'}>{readiness.primary_reason}</AdminBadge>
                </div>
                <p className="text-[11px] text-ink-dim">
                  연속 Ready {readiness.consecutive_ready_months ?? 0}개월 / 3 · v1 baseline {readiness.has_v1_baseline ? '있음' : '없음'}
                </p>
              </div>
            </div>
            {comps && (
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                <CompBar label="Difference" c={comps.difference} extra={`미설명 ${(comps.difference.unexplained_pct as number ?? 0)}%`} />
                <CompBar label="No Bug" c={comps.no_bug} extra={comps.no_bug.bug ? 'BUG 감지' : '무버그'} />
                <CompBar label="Shadow Stable" c={comps.shadow_stable} extra={comps.shadow_stable.ok ? '3개월 존재' : '부족'} />
                <CompBar label="Replay Stable" c={comps.replay_stable} extra={comps.replay_stable.ok ? '결정적' : '불일치'} />
                <CompBar label="Health" c={comps.health} extra={`fraud+reject ${num(comps.health.fraud_plus_rejected as number)}`} />
              </div>
            )}
          </AdminCard>

          {/* AI Summary */}
          {ai && (
            <AdminCard title="Difference AI Summary" subtitle="차이 사유 자동 분류 · 자연어 요약">
              <div className="flex items-start gap-2 rounded-lg border border-line/15 bg-bg px-3 py-2">
                <Sparkles size={14} className="mt-0.5 shrink-0 text-accent" />
                <p className="text-xs leading-relaxed text-ink">{ai.summary}</p>
              </div>
              <div className="mt-3 space-y-1.5">
                {['DATA_VINTAGE', 'NEW_STREAM', 'STREAMING_V2', 'POLICY', 'ROUNDING', 'BUG', 'UNKNOWN'].map((k) => {
                  const v = aiPct[k] ?? 0;
                  if (v <= 0) return null;
                  return (
                    <div key={k} className="flex items-center gap-2 text-[11px]">
                      <span className="w-28 shrink-0 text-ink-dim">{k}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-line/15">
                        <div className={`h-full rounded-full ${k === 'BUG' || k === 'UNKNOWN' ? 'bg-rose-500' : 'bg-accent'}`} style={{ width: `${Math.min(v, 100)}%` }} />
                      </div>
                      <span className="w-12 shrink-0 text-right tabular-nums text-ink">{v.toFixed(1)}%</span>
                    </div>
                  );
                })}
              </div>
              {ai.invariants && (!ai.invariants.gross_le_pool || !ai.invariants.non_negative) && (
                <AdminAlert tone="danger" className="mt-3" title="불변식 위반 (BUG)" description="v2 gross > pool 또는 음수 금액 감지 — 엔진 조사 필요." />
              )}
            </AdminCard>
          )}

          {/* Validation metrics */}
          {validation?.metrics && (
            <AdminCard title="지표 비교 (v1 vs v2)" subtitle={`run ${validation.v2_run_id?.slice(0, 8) ?? '—'} · v${validation.v2_version ?? '?'} · 차이 사유 ${validation.difference_reason}`}>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="text-ink-dim"><tr>
                    <th className="px-2 py-1 text-left">metric</th>
                    <th className="px-2 py-1 text-right">v1</th><th className="px-2 py-1 text-right">v2</th>
                    <th className="px-2 py-1 text-right">Δ</th><th className="px-2 py-1 text-right">Δ%</th>
                  </tr></thead>
                  <tbody>
                    {validation.metrics.map((m) => (
                      <tr key={m.metric} className="border-t border-line/10">
                        <td className="px-2 py-1 text-ink-mute">{m.metric}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{num(m.v1)}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-ink">{num(m.v2)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{m.diff > 0 ? '+' : ''}{num(m.diff)}</td>
                        <td className="px-2 py-1 text-right">
                          {m.diff_pct == null ? <span className="text-ink-dim">—</span>
                            : <AdminBadge tone={Math.abs(m.diff_pct) < 2 ? 'neutral' : Math.abs(m.diff_pct) < 50 ? 'info' : 'warning'}>{pct(m.diff_pct)}</AdminBadge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </AdminCard>
          )}

          {/* 12-month trend */}
          {ai?.trend && (
            <AdminCard title="Difference Trend (최근 12개월)" subtitle="월별 v1→v2 차이 % 및 주 사유">
              <div className="flex items-end gap-1 overflow-x-auto pb-1">
                {ai.trend.map((t) => {
                  const h = t.has_v2 && t.diff_pct != null ? Math.min(Math.abs(t.diff_pct), 100) : 0;
                  return (
                    <div key={t.month} className="flex min-w-[38px] flex-1 flex-col items-center gap-1">
                      <div className="flex h-16 w-full items-end justify-center">
                        {t.has_v2 ? (
                          <div className={`w-4 rounded-t ${(t.primary_reason === 'BUG' || t.primary_reason === 'UNKNOWN') ? 'bg-rose-500' : 'bg-accent/70'}`}
                            style={{ height: `${Math.max(h, 4)}%` }} title={`${t.month} ${t.diff_pct?.toFixed(1) ?? '—'}% ${t.primary_reason ?? ''}`} />
                        ) : <div className="w-4 rounded-t bg-line/15" style={{ height: '4%' }} title={`${t.month} v2 없음`} />}
                      </div>
                      <span className="text-[9px] text-ink-dim">{t.month.slice(2, 7)}</span>
                    </div>
                  );
                })}
              </div>
              <p className="mt-1 flex items-center gap-1 text-[10px] text-ink-dim"><TrendingUp size={11} /> 막대 높이 = |차이 %| (100% cap) · 빨강 = BUG/UNKNOWN</p>
            </AdminCard>
          )}

          {/* Artist compare */}
          {artist?.artists && artist.artists.length > 0 && (
            <AdminCard title="Artist 별 비교" subtitle={`${artist.artists.length}명 · gross 차이순`}>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="text-ink-dim"><tr>
                    <th className="px-2 py-1 text-left">artist</th>
                    <th className="px-2 py-1 text-right">v1 gross</th><th className="px-2 py-1 text-right">v2 gross</th>
                    <th className="px-2 py-1 text-right">Δ gross</th><th className="px-2 py-1 text-right">Δ eligible</th>
                    <th className="px-2 py-1 text-right">Δ final</th><th className="px-2 py-1 text-left">reason</th>
                  </tr></thead>
                  <tbody>
                    {artist.artists.slice(0, 60).map((a) => (
                      <tr key={a.artist_user_id ?? Math.random()} className="border-t border-line/10">
                        <td className="px-2 py-1 font-mono text-ink-dim">{(a.artist_user_id ?? '—').slice(0, 8)}…</td>
                        <td className="px-2 py-1 text-right tabular-nums">{won(a.v1_gross)}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-ink">{won(a.v2_gross)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{a.gross_diff > 0 ? '+' : ''}{num(a.gross_diff)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{a.eligible_stream_diff > 0 ? '+' : ''}{num(a.eligible_stream_diff)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{a.final_diff > 0 ? '+' : ''}{num(a.final_diff)}</td>
                        <td className="px-2 py-1"><AdminBadge tone={REASON_TONE[a.top_reason] ?? 'neutral'}>{a.top_reason}</AdminBadge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </AdminCard>
          )}

          {/* Track compare */}
          {track?.tracks && track.tracks.length > 0 && (
            <AdminCard title="Track 별 비교" subtitle={`${track.tracks.length}곡 · gross 기여 차이순`}>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="text-ink-dim"><tr>
                    <th className="px-2 py-1 text-left">track</th>
                    <th className="px-2 py-1 text-right">v1 elig</th><th className="px-2 py-1 text-right">v2 elig</th>
                    <th className="px-2 py-1 text-right">v1 gross</th><th className="px-2 py-1 text-right">v2 gross</th>
                    <th className="px-2 py-1 text-right">Δ</th><th className="px-2 py-1 text-left">reason</th>
                  </tr></thead>
                  <tbody>
                    {track.tracks.slice(0, 60).map((t) => (
                      <tr key={t.track_id ?? Math.random()} className="border-t border-line/10">
                        <td className="px-2 py-1 max-w-[160px] truncate text-ink-mute" title={t.track_title ?? ''}>{t.track_title ?? '—'}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{num(t.v1_eligible_stream)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{num(t.v2_eligible_stream)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{won(t.v1_gross_contribution)}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-ink">{won(t.v2_gross_contribution)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{t.diff > 0 ? '+' : ''}{num(t.diff)}</td>
                        <td className="px-2 py-1"><AdminBadge tone={REASON_TONE[t.diff_reason] ?? 'neutral'}>{t.diff_reason}</AdminBadge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </AdminCard>
          )}

          {/* Store + Brand compare */}
          <div className="grid gap-3 lg:grid-cols-2">
            <AdminCard title="Store 별 비교" subtitle="v2 shadow 스트림 귀속 (store_id · fraud · rejection)">
              {!store || !store.has_shadow_data || store.stores.length === 0 ? (
                <AdminEmpty title="Store shadow 데이터 없음" description={store?.note ?? 'Streaming v2 스트림 누적 후 store 단위 귀속이 표시됩니다.'} />
              ) : (
                <div className="space-y-1.5">
                  {store.stores.slice(0, 30).map((s) => (
                    <div key={s.store_id ?? Math.random()} className="flex items-center justify-between rounded-lg border border-line/15 bg-bg px-3 py-1.5 text-[11px]">
                      <span className="font-mono text-ink-dim">{(s.store_id ?? '—').slice(0, 8)}…</span>
                      <span className="flex items-center gap-3">
                        <span className="text-ink-dim">elig {num(s.eligible)}</span>
                        <span className="text-ink-dim">rej {num(s.rejected)}</span>
                        <AdminBadge tone={s.fraud_count > 0 ? 'danger' : 'neutral'}>fraud {s.fraud_count}</AdminBadge>
                        <span className="text-ink">{s.health_score == null ? '—' : `${s.health_score}%`}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </AdminCard>

            <AdminCard title="Brand 별 비교" subtitle="브랜드 플레이리스트 귀속 · 추정 매출 기여">
              {!brand || brand.brands.length === 0 ? (
                <AdminEmpty title="Brand 귀속 데이터 없음" description="브랜드 플레이리스트를 통한 eligible 스트림이 없거나 v2 shadow 미누적 상태입니다." />
              ) : (
                <div className="space-y-1.5">
                  {brand.brands.slice(0, 30).map((b) => (
                    <div key={b.brand_id ?? Math.random()} className="flex items-center justify-between rounded-lg border border-line/15 bg-bg px-3 py-1.5 text-[11px]">
                      <span className="font-mono text-ink-dim">{(b.brand_id ?? '—').slice(0, 8)}…</span>
                      <span className="flex items-center gap-3">
                        <span className="text-ink-dim">elig {num(b.eligible)}</span>
                        <AdminBadge tone="info">{b.contribution_pct.toFixed(1)}%</AdminBadge>
                        <span className="text-ink">{won(b.estimated_revenue)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </AdminCard>
          </div>
        </div>
      )}
    </AdminSection>
  );
}

function CompBar({ label, c, extra }: { label: string; c: { score: number; max: number }; extra?: string }) {
  const ratio = c.max > 0 ? Math.max(0, Math.min(1, c.score / c.max)) : 0;
  const tone = ratio >= 0.99 ? 'bg-emerald-500' : ratio >= 0.6 ? 'bg-accent/70' : 'bg-amber-500';
  return (
    <div className="rounded-lg border border-line/15 bg-bg px-3 py-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-wide text-ink-dim">{label}</span>
        <span className="text-xs font-semibold tabular-nums text-ink">{c.score}<span className="text-ink-dim">/{c.max}</span></span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line/15">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${ratio * 100}%` }} />
      </div>
      {extra && <p className="mt-1 text-[9px] text-ink-dim">{extra}</p>}
    </div>
  );
}
