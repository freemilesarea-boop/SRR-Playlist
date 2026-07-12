/**
 * ArtistSection — Artist Intelligence Dashboard (Phase ADMIN-ARTIST-1).
 *
 * PR #362~#365 위에 이어 아티스트 Lifecycle(가입→승인→QC→유통→스트리밍→정산)을
 * 실제 운영 데이터로 분석한다. 7개 내부 탭:
 *   Overview   — Artist KPI + Lifecycle 퍼널
 *   Growth     — 신규/업로드/QC/유통/스트리밍/정산 시계열 (기간 선택)
 *   QC         — QC 현황·평균 점수·TOP 실패 사유·월별
 *   Tracks     — 음원 현황·장르 분포·BPM 분포(부분)·Key(미지원)
 *   Streaming  — 스트리밍 발생/무발생 아티스트
 *   Settlement — 정산 net/carry·상태·실지급(미발생)
 *   Rankings   — TOP 스트리밍/정산/업로드/장르/신규 + 지원 매트릭스
 *
 * 자체 fetch·오류 격리 → 0475 미적용 시에도 기존 대시보드 정상. 없는 데이터는
 * "데이터 없음/미지원"으로 명시(추정 금지). 비율 0~100, NaN/Infinity 없음.
 */
import { useEffect, useState } from 'react';
import {
  Mic2, UserCheck, UserX, Clock, Upload, Radio, Wallet, RefreshCw, Inbox,
  ShieldCheck, Music2, TrendingUp, Trophy, CircleSlash, ListMusic,
} from 'lucide-react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { AdminCard, AdminStatCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import {
  fetchArtistSummary, fetchArtistFunnel, fetchArtistGrowth, fetchArtistBreakdown, fetchArtistRankings,
  type ArtistSummary, type ArtistFunnel, type ArtistGrowth, type ArtistGrowthRange,
  type ArtistBreakdown, type ArtistRankings, type ArtistRankRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  formatDuration, formatHours, formatKRW, formatPct, approvalRate, qcPassRate,
  streamingCoverage, artistIntegrityWarnings, artistSupportMatrix,
} from '@/lib/artistIntel';
import { computeFunnel, finalConversion, monotonicWarnings } from '@/lib/memberFunnel';
import { formatBucketLabel } from '@/lib/memberGrowth';

const NUM = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('ko-KR'));

const TONE_HEX = { success: '#10b981', warning: '#f59e0b', danger: '#ef4444', neutral: '#737373' } as const;
const SERIES = [
  { key: 'new_artists', label: '신규', color: '#a78bfa', type: 'bar' as const },
  { key: 'uploads', label: '업로드', color: '#60a5fa', type: 'line' as const },
  { key: 'qc_passed', label: 'QC통과', color: '#10b981', type: 'line' as const },
  { key: 'distributed', label: '유통', color: '#f59e0b', type: 'line' as const },
  { key: 'streams', label: '스트리밍', color: '#f472b6', type: 'line' as const },
  { key: 'settlements', label: '정산', color: '#737373', type: 'line' as const },
];
const GENRE_COLORS = ['#a78bfa', '#60a5fa', '#10b981', '#f59e0b', '#f472b6', '#38bdf8', '#fb7185', '#737373'];
const CHART_TOOLTIP_STYLE = { background: '#181818', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 } as const;

const RANGES: { key: ArtistGrowthRange; label: string }[] = [
  { key: '7d', label: '7일' }, { key: '30d', label: '30일' }, { key: '90d', label: '90일' }, { key: '12m', label: '12개월' },
];

type Tab = 'overview' | 'growth' | 'qc' | 'tracks' | 'streaming' | 'settlement' | 'rankings';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' }, { key: 'growth', label: 'Growth' }, { key: 'qc', label: 'QC' },
  { key: 'tracks', label: 'Tracks' }, { key: 'streaming', label: 'Streaming' },
  { key: 'settlement', label: 'Settlement' }, { key: 'rankings', label: 'Rankings' },
];

export default function ArtistSection() {
  const [tab, setTab] = useState<Tab>('overview');

  const [summary, setSummary] = useState<ArtistSummary | null>(null);
  const [funnel, setFunnel] = useState<ArtistFunnel | null>(null);
  const [ovErr, setOvErr] = useState<AdminError | null>(null);
  const [ovLoading, setOvLoading] = useState(true);

  const [range, setRange] = useState<ArtistGrowthRange>('30d');
  const [growth, setGrowth] = useState<ArtistGrowth | null>(null);
  const [grErr, setGrErr] = useState<AdminError | null>(null);
  const [grLoading, setGrLoading] = useState(false);

  const [breakdown, setBreakdown] = useState<ArtistBreakdown | null>(null);
  const [bdErr, setBdErr] = useState<AdminError | null>(null);
  const [bdLoading, setBdLoading] = useState(false);

  const [rankings, setRankings] = useState<ArtistRankings | null>(null);
  const [rkErr, setRkErr] = useState<AdminError | null>(null);
  const [rkLoading, setRkLoading] = useState(false);

  async function loadOverview() {
    setOvLoading(true); setOvErr(null);
    try { const [s, f] = await Promise.all([fetchArtistSummary(), fetchArtistFunnel()]); setSummary(s); setFunnel(f); }
    catch (e) { setOvErr(classifyAdminError(e)); } finally { setOvLoading(false); }
  }
  async function loadGrowth(r: ArtistGrowthRange) {
    setGrLoading(true); setGrErr(null);
    try { setGrowth(await fetchArtistGrowth(r)); } catch (e) { setGrErr(classifyAdminError(e)); } finally { setGrLoading(false); }
  }
  async function loadBreakdown() {
    setBdLoading(true); setBdErr(null);
    try { setBreakdown(await fetchArtistBreakdown()); } catch (e) { setBdErr(classifyAdminError(e)); } finally { setBdLoading(false); }
  }
  async function loadRankings() {
    setRkLoading(true); setRkErr(null);
    try { setRankings(await fetchArtistRankings()); } catch (e) { setRkErr(classifyAdminError(e)); } finally { setRkLoading(false); }
  }

  useEffect(() => { void loadOverview(); }, []);
  useEffect(() => { if (tab === 'growth') void loadGrowth(range); }, [tab, range]);
  useEffect(() => {
    if ((tab === 'qc' || tab === 'tracks' || tab === 'streaming' || tab === 'settlement') && !breakdown) void loadBreakdown();
    if (tab === 'rankings' && !rankings) void loadRankings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <AdminCard
      title="Artist Intelligence"
      subtitle="가입 → 승인 → QC → 유통 → 스트리밍 → 정산 (KST 기준)"
      action={
        <div className="flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${tab === t.key ? 'bg-accent text-black' : 'bg-bg-deep text-ink-mute hover:text-ink'}`}>
              {t.label}
            </button>
          ))}
        </div>
      }
      bodyClassName="space-y-4"
    >
      {tab === 'overview' && <OverviewTab summary={summary} funnel={funnel} loading={ovLoading} error={ovErr} onRetry={loadOverview} />}
      {tab === 'growth' && <GrowthTab growth={growth} loading={grLoading} error={grErr} range={range} onRange={setRange} onRetry={() => loadGrowth(range)} />}
      {tab === 'qc' && <QcTab b={breakdown} loading={bdLoading} error={bdErr} onRetry={loadBreakdown} />}
      {tab === 'tracks' && <TracksTab b={breakdown} loading={bdLoading} error={bdErr} onRetry={loadBreakdown} />}
      {tab === 'streaming' && <StreamingTab b={breakdown} loading={bdLoading} error={bdErr} onRetry={loadBreakdown} />}
      {tab === 'settlement' && <SettlementTab b={breakdown} loading={bdLoading} error={bdErr} onRetry={loadBreakdown} />}
      {tab === 'rankings' && <RankingsTab r={rankings} b={breakdown} loading={rkLoading || bdLoading} error={rkErr} onRetry={() => { void loadRankings(); void loadBreakdown(); }} />}
    </AdminCard>
  );
}

/* ── 공통 ─────────────────────────────────────────────── */
function LoadingBlock() { return <div className="h-40 animate-pulse rounded-2xl bg-bg-deep" aria-busy="true" />; }
function ErrorBlock({ error, onRetry }: { error: AdminError; onRetry: () => void }) {
  return (
    <AdminAlert tone="warning" title="Artist 데이터를 불러오지 못했어요" description={error.message}
      action={<button onClick={onRetry} className="inline-flex items-center gap-1 rounded-full bg-bg-card px-3 py-1.5 text-xs hover:bg-bg-hover"><RefreshCw size={12} /> 다시 시도</button>} />
  );
}

/* ── Overview ──────────────────────────────────────────── */
function OverviewTab({ summary, funnel, loading, error, onRetry }: { summary: ArtistSummary | null; funnel: ArtistFunnel | null; loading: boolean; error: AdminError | null; onRetry: () => void }) {
  if (loading) return <LoadingBlock />;
  if (error || !summary || !funnel) return <ErrorBlock error={error ?? classifyAdminError(null)} onRetry={onRetry} />;

  const warnings = [...artistIntegrityWarnings(summary), ...monotonicWarnings(funnel.steps)];
  const computed = computeFunnel(funnel.steps);
  const base = computed.find((s) => s.count != null)?.count ?? 0;
  const final = finalConversion(funnel.steps);

  return (
    <div className="space-y-4">
      {warnings.length > 0 && <AdminAlert tone="warning" title="Artist 정합성 경고" description={warnings.join(' · ')} />}

      {/* KPI */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <AdminStatCard label="총 아티스트" value={NUM(summary.total_artists)} icon={<Mic2 size={16} />} tone="primary" />
        <AdminStatCard label="오늘 가입" value={NUM(summary.today_signups)} icon={<UserCheck size={16} />} tone="info" />
        <AdminStatCard label="이번달 가입" value={NUM(summary.month_signups)} icon={<UserCheck size={16} />} tone="info" />
        <AdminStatCard label="승인 대기" value={NUM(summary.pending)} icon={<Clock size={16} />} tone="warning" />
        <AdminStatCard label="승인 완료" value={NUM(summary.approved)} icon={<UserCheck size={16} />} tone="success" hint={`승인율 ${formatPct(approvalRate(summary))}`} />
        <AdminStatCard label="승인 거절" value={NUM(summary.rejected)} icon={<UserX size={16} />} tone="danger" />
        <AdminStatCard label="활성 아티스트" value={NUM(summary.active_artists)} icon={<Mic2 size={16} />} tone="primary" />
        <AdminStatCard label="첫 업로드" value={NUM(summary.first_upload)} icon={<Upload size={16} />} tone="info" />
        <AdminStatCard label="유통 완료" value={NUM(summary.distributed)} icon={<Music2 size={16} />} tone="success" />
        <AdminStatCard label="스트리밍 발생" value={NUM(summary.streaming)} icon={<Radio size={16} />} tone="success" />
        <AdminStatCard label="정산 발생" value={NUM(summary.settled)} icon={<Wallet size={16} />} tone="primary" />
        <AdminStatCard label="정산 완료" value={NUM(summary.settle_paid)} icon={<Wallet size={16} />} tone={summary.settle_paid === 0 ? 'neutral' : 'success'} hint="실지급" />
      </div>

      {/* Lifecycle 퍼널 */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-xs font-bold">Lifecycle 퍼널</p>
          <span className="text-[10px] text-ink-dim">최종 전환율 (가입→정산완료) {formatPct(final)}</span>
        </div>
        <div className="space-y-1.5">
          {computed.map((s, i) => {
            const supported = s.supported && s.count != null;
            const width = supported && base > 0 ? Math.max(2, ((s.count as number) / base) * 100) : 0;
            return (
              <div key={s.key}>
                {i > 0 && supported && s.convFromPrev != null && (
                  <div className="pl-1 text-[10px] text-ink-dim">↓ <span style={{ color: TONE_HEX[s.tone] }} className="font-semibold">{formatPct(s.convFromPrev)}</span>{s.dropCount != null && s.dropCount > 0 ? ` · ${NUM(s.dropCount)}명 이탈` : ''}</div>
                )}
                <div className="flex items-center justify-between gap-2 rounded-lg px-3 py-2" style={{ background: `${TONE_HEX[s.tone]}22` }} title={s.note ?? undefined}>
                  <span className="text-xs font-semibold text-ink">{s.label}</span>
                  <div className="flex items-center gap-2">
                    <div className="hidden h-2 rounded-full sm:block" style={{ width: `${width}%`, minWidth: 8, maxWidth: 180, background: TONE_HEX[s.tone] }} />
                    <span className="text-sm font-bold tabular-nums text-ink">{NUM(s.count)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── Growth ────────────────────────────────────────────── */
function GrowthTab({ growth, loading, error, range, onRange, onRetry }: {
  growth: ArtistGrowth | null; loading: boolean; error: AdminError | null;
  range: ArtistGrowthRange; onRange: (r: ArtistGrowthRange) => void; onRetry: () => void;
}) {
  const rangeButtons = (
    <div className="flex flex-wrap gap-1">
      {RANGES.map((r) => (
        <button key={r.key} onClick={() => onRange(r.key)}
          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${range === r.key ? 'bg-accent text-black' : 'bg-bg-deep text-ink-mute hover:text-ink'}`}>
          {r.label}
        </button>
      ))}
    </div>
  );

  let body: React.ReactNode;
  if (loading) body = <LoadingBlock />;
  else if (error || !growth) body = <ErrorBlock error={error ?? classifyAdminError(null)} onRetry={onRetry} />;
  else if (growth.points.length === 0) body = <AdminEmpty icon={<Inbox size={24} />} title="데이터 없음" />;
  else {
    const data = growth.points.map((p) => ({ ...p, label: formatBucketLabel(p.bucket, growth.unit) }));
    const minWidth = growth.unit === 'day' && data.length > 31 ? data.length * 22 : undefined;
    const tickInterval = data.length > 31 ? Math.floor(data.length / 12) : 0;
    body = (
      <div className="overflow-x-auto">
        <div style={minWidth ? { minWidth } : undefined}>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#737373' }} axisLine={false} tickLine={false} interval={tickInterval} minTickGap={8} />
              <YAxis tick={{ fontSize: 10, fill: '#737373' }} axisLine={false} tickLine={false} width={32} allowDecimals={false} />
              <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v: number, n: string) => [NUM(v), n]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {SERIES.map((s) => s.type === 'bar'
                ? <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={28} />
                : <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={1.8} dot={false} />)}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-xs font-bold"><TrendingUp size={13} /> 아티스트 Lifecycle 추이</span>
        {rangeButtons}
      </div>
      {body}
    </div>
  );
}

/* ── QC ────────────────────────────────────────────────── */
function QcTab({ b, loading, error, onRetry }: { b: ArtistBreakdown | null; loading: boolean; error: AdminError | null; onRetry: () => void }) {
  if (loading) return <LoadingBlock />;
  if (error || !b) return <ErrorBlock error={error ?? classifyAdminError(null)} onRetry={onRetry} />;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <AdminStatCard label="QC 승인" value={NUM(b.qc.approved)} icon={<ShieldCheck size={16} />} tone="success" hint={`통과율 ${formatPct(qcPassRate(b))}`} />
        <AdminStatCard label="QC 대기" value={NUM(b.qc.pending)} icon={<Clock size={16} />} tone="warning" />
        <AdminStatCard label="평균 QC 점수" value={b.qc.avg_score ? b.qc.avg_score.toFixed(1) : '—'} icon={<ShieldCheck size={16} />} tone="primary" />
        <AdminStatCard label="평균 승인시간" value={formatHours(b.qc.avg_approval_hours)} icon={<Clock size={16} />} tone="neutral" />
        <AdminStatCard label="QC 큐 대기" value={NUM(b.qc.queue_open)} icon={<Inbox size={16} />} tone="warning" />
        <AdminStatCard label="QC 큐 해결" value={NUM(b.qc.queue_resolved)} icon={<ShieldCheck size={16} />} tone="success" />
      </div>

      {!b.qc.proc_time_supported && (
        <AdminAlert tone="info" title="QC 처리시간 미지원" description="review_started_at ↔ approved_at 타임스탬프 역전(음수) — 데이터 불일치로 처리시간 산출 불가. 평균 승인시간(등록→승인)만 제공합니다." />
      )}

      <div>
        <p className="mb-1.5 text-xs font-bold">TOP 실패/플래그 사유</p>
        {b.qc.top_reasons.length === 0 ? <AdminEmpty icon={<Inbox size={20} />} title="사유 없음" /> : (
          <div className="space-y-1">
            {b.qc.top_reasons.map((r, i) => (
              <div key={i} className="flex items-center justify-between gap-2 rounded-lg bg-bg-deep px-3 py-1.5 text-xs">
                <span className="min-w-0 truncate text-ink-mute" title={r.reason}>{i + 1}. {r.reason}</span>
                <span className="shrink-0 tabular-nums font-bold text-ink">{NUM(r.count)}건</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Tracks ────────────────────────────────────────────── */
function TracksTab({ b, loading, error, onRetry }: { b: ArtistBreakdown | null; loading: boolean; error: AdminError | null; onRetry: () => void }) {
  if (loading) return <LoadingBlock />;
  if (error || !b) return <ErrorBlock error={error ?? classifyAdminError(null)} onRetry={onRetry} />;

  const genreTotal = b.tracks.genre_dist.reduce((s, r) => s + r.count, 0);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <AdminStatCard label="총 음원" value={NUM(b.tracks.total)} icon={<Music2 size={16} />} tone="primary" />
        <AdminStatCard label="오늘 등록" value={NUM(b.tracks.today)} icon={<Upload size={16} />} tone="info" />
        <AdminStatCard label="이번달 등록" value={NUM(b.tracks.month)} icon={<Upload size={16} />} tone="info" />
        <AdminStatCard label="유통 대기" value={NUM(b.tracks.pending_dist)} icon={<Clock size={16} />} tone="warning" />
        <AdminStatCard label="유통 완료" value={NUM(b.tracks.released)} icon={<Music2 size={16} />} tone="success" />
        <AdminStatCard label="비공개" value={NUM(b.tracks.hidden)} icon={<CircleSlash size={16} />} tone="neutral" />
        <AdminStatCard label="삭제" value={NUM(b.tracks.removed)} icon={<CircleSlash size={16} />} tone="danger" />
        <AdminStatCard label="평균 길이" value={formatDuration(b.tracks.avg_duration)} icon={<Clock size={16} />} tone="neutral" />
      </div>

      <div>
        <p className="mb-1.5 text-xs font-bold">장르 분포</p>
        <div className="space-y-1">
          {b.tracks.genre_dist.map((r, i) => (
            <div key={r.key} className="flex items-center gap-2 text-xs">
              <span className="w-20 shrink-0 truncate text-ink-mute">{r.key}</span>
              <div className="h-2 rounded-full" style={{ width: `${genreTotal > 0 ? Math.max(2, (r.count / genreTotal) * 100) : 0}%`, background: GENRE_COLORS[i % GENRE_COLORS.length], minWidth: 8 }} />
              <span className="tabular-nums font-semibold text-ink">{NUM(r.count)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="mb-1.5 text-xs font-bold">BPM 분포 <span className="text-[10px] font-normal text-ink-dim">(분석 {NUM(b.tracks.bpm_coverage)}곡)</span></p>
          {b.tracks.bpm_dist.length === 0 ? <AdminEmpty icon={<Inbox size={20} />} title="BPM 데이터 없음" /> : (
            <div className="space-y-1">
              {b.tracks.bpm_dist.map((r) => (
                <div key={r.key} className="flex items-center justify-between rounded bg-bg-deep px-2 py-1 text-[11px]">
                  <span className="text-ink-mute">{r.key} BPM</span><span className="tabular-nums font-semibold text-ink">{NUM(r.count)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <p className="mb-1.5 text-xs font-bold">Key 분포</p>
          {b.tracks.key_supported
            ? <p className="text-xs text-ink-mute">—</p>
            : <AdminAlert tone="info" title="Key 분포 미지원" description="track_audio_features.key 값이 없어(전부 null) 분포를 낼 수 없습니다." />}
        </div>
      </div>
    </div>
  );
}

/* ── Streaming ─────────────────────────────────────────── */
function StreamingTab({ b, loading, error, onRetry }: { b: ArtistBreakdown | null; loading: boolean; error: AdminError | null; onRetry: () => void }) {
  if (loading) return <LoadingBlock />;
  if (error || !b) return <ErrorBlock error={error ?? classifyAdminError(null)} onRetry={onRetry} />;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <AdminStatCard label="스트리밍 발생 아티스트" value={NUM(b.streaming.streamed_artists)} icon={<Radio size={16} />} tone="success" hint={`발생률 ${formatPct(streamingCoverage(b))}`} />
        <AdminStatCard label="스트리밍 없는 아티스트" value={NUM(b.streaming.no_stream_artists)} icon={<CircleSlash size={16} />} tone="warning" hint="승인 아티스트 중" />
      </div>
      <p className="text-[10px] text-ink-dim">TOP 스트리밍 아티스트/음원/장르는 Rankings 탭에서 확인하세요. 최근 30일 성장/감소는 아티스트별 시계열 스냅샷 부재로 미지원.</p>
    </div>
  );
}

/* ── Settlement ────────────────────────────────────────── */
function SettlementTab({ b, loading, error, onRetry }: { b: ArtistBreakdown | null; loading: boolean; error: AdminError | null; onRetry: () => void }) {
  if (loading) return <LoadingBlock />;
  if (error || !b) return <ErrorBlock error={error ?? classifyAdminError(null)} onRetry={onRetry} />;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <AdminStatCard label="누적 정산(net)" value={formatKRW(b.settlement.sum_net)} icon={<Wallet size={16} />} tone="primary" />
        <AdminStatCard label="이번달 정산" value={formatKRW(b.settlement.this_month)} icon={<Wallet size={16} />} tone="success" />
        <AdminStatCard label="Carry Over" value={formatKRW(b.settlement.sum_carryover)} icon={<RefreshCw size={16} />} tone="warning" />
        <AdminStatCard label="평균 지급액" value={formatKRW(b.settlement.avg_net)} icon={<Wallet size={16} />} tone="neutral" />
        <AdminStatCard label="지급 완료" value={formatKRW(b.settlement.sum_final_payout)} icon={<Wallet size={16} />} tone={b.settlement.paid === 0 ? 'neutral' : 'success'} hint={`${NUM(b.settlement.paid)}건`} />
        <AdminStatCard label="보류(held)" value={NUM(b.settlement.held)} icon={<CircleSlash size={16} />} tone="warning" />
        <AdminStatCard label="이월(carried)" value={NUM(b.settlement.carried_over)} icon={<RefreshCw size={16} />} tone="neutral" />
        <AdminStatCard label="대기(pending)" value={NUM(b.settlement.pending)} icon={<Clock size={16} />} tone="warning" />
      </div>
      {!b.settlement.payout_supported && (
        <AdminAlert tone="info" title="실지급(payout) 미발생" description="final_payout_amount 전부 0 · paid 0 — 현재 정산은 보류/이월 상태이며 실지급 이력이 없습니다. Settlement v1 계산은 무변경, 본 대시보드는 읽기 전용 관측입니다." />
      )}
    </div>
  );
}

/* ── Rankings ──────────────────────────────────────────── */
function RankTable({ title, icon, rows, valueFmt }: { title: string; icon: React.ReactNode; rows: ArtistRankRow[]; valueFmt: (v: number | undefined) => string }) {
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1 text-xs font-bold">{icon} {title}</p>
      {rows.length === 0 ? <AdminEmpty icon={<Inbox size={18} />} title="데이터 없음" /> : (
        <div className="space-y-0.5">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center justify-between gap-2 rounded bg-bg-deep px-2 py-1 text-[11px]">
              <span className="min-w-0 truncate"><span className="mr-1.5 text-ink-dim">{i + 1}</span><span className="text-ink">{r.artist ?? r.genre ?? '—'}</span></span>
              <span className="shrink-0 tabular-nums font-bold text-ink">{valueFmt(r.value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RankingsTab({ r, b, loading, error, onRetry }: { r: ArtistRankings | null; b: ArtistBreakdown | null; loading: boolean; error: AdminError | null; onRetry: () => void }) {
  if (loading) return <LoadingBlock />;
  if (error || !r) return <ErrorBlock error={error ?? classifyAdminError(null)} onRetry={onRetry} />;

  const support = artistSupportMatrix(b?.support);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <RankTable title="TOP 스트리밍" icon={<Radio size={13} />} rows={r.top_streaming} valueFmt={(v) => `${NUM(v ?? 0)}회`} />
        <RankTable title="TOP 정산" icon={<Wallet size={13} />} rows={r.top_settlement} valueFmt={(v) => formatKRW(v ?? 0)} />
        <RankTable title="TOP 업로드" icon={<Upload size={13} />} rows={r.top_upload} valueFmt={(v) => `${NUM(v ?? 0)}곡`} />
        <RankTable title="TOP 장르" icon={<ListMusic size={13} />} rows={r.top_genre} valueFmt={(v) => `${NUM(v ?? 0)}곡`} />
        <RankTable title="TOP 신규" icon={<Trophy size={13} />} rows={r.top_new} valueFmt={() => ''} />
      </div>

      {b && (
        <div>
          <p className="mb-1.5 text-xs font-bold">지표 지원 여부</p>
          <div className="flex flex-wrap gap-1.5">
            {support.map((s) => (
              <AdminBadge key={s.key} tone={s.supported ? 'success' : 'neutral'} size="sm">
                {s.label} {s.supported ? '지원' : '데이터 없음'}
              </AdminBadge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
