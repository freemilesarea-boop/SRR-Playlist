import { useEffect, useState } from 'react';
import {
  Users,
  Eye,
  Headphones,
  TrendingUp,
  CreditCard,
  CalendarDays,
  Wallet,
  RefreshCw,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  fetchDashboardStats,
  fetchDailySeries,
  fetchTopTracks,
  fetchTopPlaylists,
  recomputeDailyMetrics,
  type DashboardStats,
  type DailySeriesPoint,
  type TopTrack,
  type TopPlaylist,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import AdminErrorState from './AdminErrorState';
import MemberStatsSection from './MemberStatsSection';
import MemberGrowthSection from './MemberGrowthSection';
import MemberFunnelSection from './MemberFunnelSection';
import RevenueSection from './RevenueSection';
import ArtistSection from './ArtistSection';
import BusinessSection from './BusinessSection';
import StreamingSection from './StreamingSection';
import MissionControlSection from './MissionControlSection';
import ActionCenterSection from './ActionCenterSection';
import AutomationCenterSection from './AutomationCenterSection';
import AiRecommendationSection from './AiRecommendationSection';
import AiDecisionIntelligenceSection from './AiDecisionIntelligenceSection';
import PlaylistIntelligenceSection from './PlaylistIntelligenceSection';
import PlaylistExperimentSection from './PlaylistExperimentSection';
import TrackRolloutSection from './TrackRolloutSection';
import PlaylistGeneratorSection from './PlaylistGeneratorSection';
import AdaptiveRotationSection from './AdaptiveRotationSection';
import TrackIntelligenceSection from './TrackIntelligenceSection';
import ContextIntelligenceSection from './ContextIntelligenceSection';
import ContextLearningSection from './ContextLearningSection';
import PredictiveIntelligenceSection from './PredictiveIntelligenceSection';
import OptimizationStrategySection from './OptimizationStrategySection';
import StrategySandboxSection from './StrategySandboxSection';
import DraftPromotionSection from './DraftPromotionSection';
import AiGovernanceSection from './AiGovernanceSection';
import MultiAgentCenterSection from './MultiAgentCenterSection';
import AiMemoryKnowledgeSection from './AiMemoryKnowledgeSection';
import AiDigitalTwinSection from './AiDigitalTwinSection';
import FleetIntelligenceSection from './FleetIntelligenceSection';
import FederatedIntelligenceSection from './FederatedIntelligenceSection';
import SelfHealingSection from './SelfHealingSection';
import ExecutiveCenterSection from './ExecutiveCenterSection';
import OperationsCenterSection from './OperationsCenterSection';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';

const KRW = (n: number) => `₩${n.toLocaleString('ko-KR')}`;
const NUM = (n: number) => n.toLocaleString('ko-KR');

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [series, setSeries] = useState<DailySeriesPoint[]>([]);
  const [topTracks, setTopTracks] = useState<TopTrack[]>([]);
  const [topPlaylists, setTopPlaylists] = useState<TopPlaylist[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<AdminError | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [s, ser, tt, tp] = await Promise.all([
        fetchDashboardStats(),
        fetchDailySeries(7),
        fetchTopTracks(10),
        fetchTopPlaylists(10),
      ]);
      setStats(s);
      setSeries(ser);
      setTopTracks(tt);
      setTopPlaylists(tp);
    } catch (e) {
      setError(classifyAdminError(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function refreshToday() {
    setRefreshing(true);
    try {
      await recomputeDailyMetrics();
      await load();
      toast.success('오늘 집계를 갱신했어요.');
    } catch (e) {
      toast.error(friendlyError(e, '갱신 실패'));
    } finally {
      setRefreshing(false);
    }
  }

  if (error) return <AdminErrorState error={error} onRetry={load} />;
  if (loading || !stats) {
    return <div className="p-6 text-sm text-ink-mute">대시보드 불러오는 중…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold tracking-tight">대시보드</h2>
          <p className="text-xs text-ink-mute">오늘 기준 핵심 지표</p>
        </div>
        <button
          onClick={refreshToday}
          disabled={refreshing}
          className="inline-flex items-center gap-1 rounded-full bg-bg-card px-3 py-1.5 text-xs hover:bg-bg-hover"
        >
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          오늘 집계 새로고침
        </button>
      </div>

      {/* AI Recommendation — 실제 KPI 근거 추천 Feed (Mission Control 상단) */}
      <AiRecommendationSection />

      {/* Decision Intelligence — 실제 Outcome 기반 추천 우선순위 계산 */}
      <AiDecisionIntelligenceSection />

      {/* Adaptive Playlist Intelligence — 실제 재생 이벤트 KPI 기반 Playlist 성과·추천 */}
      <PlaylistIntelligenceSection />

      {/* Playlist Optimization & Experiments — A/B 실험 기반 안전 최적화 (자동 교체 없음) */}
      <PlaylistExperimentSection />

      {/* New Track Progressive Rollout — 신규 음원 점진 확산 (자동 배포 없음) */}
      <TrackRolloutSection />

      {/* AI Playlist Generator — 실제 메타/KPI 기반 Draft 생성 (자동 Publish 없음) */}
      <PlaylistGeneratorSection />

      {/* Adaptive Rotation & Anti-Fatigue — 재생 순서 초안 (자동 Queue/Scheduler 반영 없음) */}
      <AdaptiveRotationSection />

      {/* Track Intelligence & Lifecycle — Track 중심 성과 학습 (자동 Stage 변경 없음) */}
      <TrackIntelligenceSection />

      {/* Context Intelligence — 상황(Store Type·Daypart·Weekday) 조합별 성과 학습 (분석/추천 전용) */}
      <ContextIntelligenceSection />

      {/* Context Evolution & Learning — 시간 진화(Drift/Stability) + Recommendation Learning (자동 반영 없음) */}
      <ContextLearningSection />

      {/* Predictive Intelligence & Simulation — 미래 KPI 예측 + 변경 전 시뮬레이션 (실제 변경 없음) */}
      <PredictiveIntelligenceSection />

      {/* Optimization Strategy — Prediction 기반 최적화 전략 후보 생성·평가 (자동 실행 없음, 승인 필요) */}
      <OptimizationStrategySection />

      {/* Strategy Sandbox — 전략 격리 검증·시뮬레이션 (Production 무변경, 자동 실행/승인 없음) */}
      <StrategySandboxSection />

      {/* Draft Promotion Gateway — 운영자 승인 기반 Draft 변환·Canary 후보 (Production 무변경, 자동 실행 없음) */}
      <DraftPromotionSection />

      {/* AI Governance & Trust — 헌법/신뢰/거버넌스 + Production Change Candidate (실제 Apply 없음) */}
      <AiGovernanceSection />

      {/* AI Multi-Agent Center — 전문 Agent 협업/Consensus/Conflict (Production 무변경, 자동 실행 없음) */}
      <MultiAgentCenterSection />

      {/* AI Memory & Knowledge — Long-Term Memory/Graph/Pattern/Replay (Evidence 계층, Production 무변경) */}
      <AiMemoryKnowledgeSection />

      {/* AI Digital Twin & Simulation Lab — Immutable Snapshot + 결정적 Counterfactual (simulated ≠ actual) */}
      <AiDigitalTwinSection />

      {/* Enterprise Fleet Intelligence — 익명 Cross-Enterprise/Region/Industry Benchmark (Production 무변경) */}
      <FleetIntelligenceSection />

      {/* Federated Intelligence — Privacy Gate 통과 익명 Knowledge Federation (Evidence Only) */}
      <FederatedIntelligenceSection />

      {/* AI Self-Healing — Incident/RCA/Twin 검증/복구안 (자동 복구 없음 · Evidence Only) */}
      <SelfHealingSection />

      {/* AI Music OS Executive — 15개 AI 계층 통합 Executive Intelligence (Evidence Only) */}
      <ExecutiveCenterSection />

      {/* AI Operations Center — AI 제안 통합 Queue + 사람 검토/승인/피드백 (자동 승인 없음) */}
      <OperationsCenterSection />

      {/* Mission Control — 전체 통합 관제 (기존 Dashboard 재사용 레이어) */}
      <MissionControlSection />

      {/* Operations Action Center — 운영 실행 계층 (기존 admin RPC 재사용) */}
      <ActionCenterSection />

      {/* Operations Automation Center — 운영 자동화 기반 (Action Center Command/RPC 재사용) */}
      <AutomationCenterSection />

      {/* 회원 통계 (요약 · 결제 현황 · 플랜별 가입자 · 상태) */}
      <MemberStatsSection />

      {/* 회원 성장 (성장 KPI · 가입 추이 · 유형별 · 유료 전환 · 최근 가입) */}
      <MemberGrowthSection />

      {/* 회원 전환 퍼널 (퍼널 · 유형별 · 전환 변화 · Revenue) */}
      <MemberFunnelSection />

      {/* Revenue Intelligence (Overview · Trend · Plans · Forecast · Top) */}
      <RevenueSection />

      {/* Artist Intelligence (Overview · Growth · QC · Tracks · Streaming · Settlement · Rankings) */}
      <ArtistSection />

      {/* Business Intelligence (Overview · Growth · Brands · Stores · Players · Contracts · Health · Rankings) */}
      <BusinessSection />

      {/* Streaming Intelligence (Overview · Playback · Quality · Queue · Fleet · Stores · Timeline · Rankings) */}
      <StreamingSection />

      {/* 핵심 카드 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        <MetricCard
          label="오늘 방문자"
          value={NUM(stats.today_visitors)}
          sub={`고유 ${NUM(stats.today_unique_visitors)}`}
          icon={<Eye size={16} />}
          tone="violet"
        />
        <MetricCard
          label="오늘 스트리밍"
          value={NUM(stats.today_streams)}
          sub="30초+"
          icon={<Headphones size={16} />}
          tone="sky"
        />
        <MetricCard
          label="오늘 신규 가입"
          value={NUM(stats.today_new_users)}
          icon={<Users size={16} />}
          tone="rose"
        />
        <MetricCard
          label="오늘 매출"
          value={KRW(stats.today_revenue)}
          icon={<Wallet size={16} />}
          tone="emerald"
        />
        <MetricCard
          label="이번 주 매출"
          value={KRW(stats.week_revenue)}
          icon={<CalendarDays size={16} />}
          tone="emerald"
        />
        <MetricCard
          label="이번 달 매출"
          value={KRW(stats.month_revenue)}
          icon={<TrendingUp size={16} />}
          tone="emerald"
        />
        <MetricCard
          label="활성 구독자"
          value={NUM(stats.active_subscribers)}
          sub={`전체 ${NUM(stats.total_users)}`}
          icon={<CreditCard size={16} />}
          tone="violet"
        />
        <MetricCard
          label="대기 신청"
          value={NUM(stats.pending_subscriptions)}
          icon={<RefreshCw size={16} />}
          tone="yellow"
        />
      </div>

      {/* 차트 그리드 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartPanel title="최근 7일 방문자">
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={series}>
              <defs>
                <linearGradient id="vgrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#a78bfa" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="d" tick={{ fontSize: 10, fill: '#737373' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#737373' }} axisLine={false} tickLine={false} width={28} />
              <Tooltip
                contentStyle={{
                  background: '#181818',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8,
                  fontSize: 11,
                }}
              />
              <Area type="monotone" dataKey="visitors" stroke="#a78bfa" strokeWidth={2} fill="url(#vgrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel title="최근 7일 스트리밍">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={series}>
              <XAxis dataKey="d" tick={{ fontSize: 10, fill: '#737373' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#737373' }} axisLine={false} tickLine={false} width={28} />
              <Tooltip
                contentStyle={{
                  background: '#181818',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8,
                  fontSize: 11,
                }}
              />
              <Bar dataKey="streams" fill="#10b981" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel title="최근 7일 매출">
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={series}>
              <defs>
                <linearGradient id="rgrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#fbbf24" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#fbbf24" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="d" tick={{ fontSize: 10, fill: '#737373' }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 10, fill: '#737373' }}
                axisLine={false}
                tickLine={false}
                width={48}
                tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip
                contentStyle={{
                  background: '#181818',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8,
                  fontSize: 11,
                }}
                formatter={(v: number) => KRW(v)}
              />
              <Area type="monotone" dataKey="revenue" stroke="#fbbf24" strokeWidth={2} fill="url(#rgrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartPanel>

      </div>

      {/* Top tables */}
      <div className="grid gap-4 lg:grid-cols-2">
        <TopTable title="오늘 인기 곡 TOP 10">
          {topTracks.length === 0 ? (
            <EmptyTable text="오늘 재생된 곡이 없어요" />
          ) : (
            topTracks.map((t, i) => (
              <div
                key={t.track_id}
                className="flex items-center justify-between gap-3 border-t border-line/10 px-3 py-2 first:border-t-0"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="w-6 text-right text-xs text-ink-dim">{i + 1}</span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{t.title}</p>
                    <p className="truncate text-xs text-ink-mute">{t.artist ?? '—'}</p>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-bold tabular-nums">{NUM(Number(t.plays))}</p>
                  <p className="text-[10px] text-ink-dim">완료 {NUM(Number(t.completes))}</p>
                </div>
              </div>
            ))
          )}
        </TopTable>

        <TopTable title="오늘 인기 플레이리스트 TOP 10">
          {topPlaylists.length === 0 ? (
            <EmptyTable text="오늘 재생된 플레이리스트가 없어요" />
          ) : (
            topPlaylists.map((p, i) => (
              <div
                key={p.playlist_id}
                className="flex items-center justify-between gap-3 border-t border-line/10 px-3 py-2 first:border-t-0"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="w-6 text-right text-xs text-ink-dim">{i + 1}</span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{p.title}</p>
                    <p className="truncate text-xs text-ink-mute">{p.category}</p>
                  </div>
                </div>
                <p className="text-sm font-bold tabular-nums">{NUM(Number(p.plays))}</p>
              </div>
            ))
          )}
        </TopTable>
      </div>
    </div>
  );
}

const TONE: Record<string, string> = {
  violet: 'from-violet-500/15 to-bg-card ring-violet-400/20 text-violet-300',
  sky: 'from-sky-500/15 to-bg-card ring-sky-400/50 text-sky-300',
  emerald: 'from-emerald-500/15 to-bg-card ring-emerald-400/50 text-emerald-300',
  rose: 'from-rose-500/15 to-bg-card ring-rose-400/50 text-rose-300',
  yellow: 'from-yellow-500/15 to-bg-card ring-yellow-400/20 text-yellow-300',
};

function MetricCard({
  label,
  value,
  sub,
  icon,
  tone = 'violet',
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  tone?: keyof typeof TONE;
}) {
  return (
    <div className={`rounded-2xl bg-gradient-to-br p-3 ring-1 ${TONE[tone]}`}>
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider opacity-80">
        {icon}
        <span>{label}</span>
      </div>
      <p className="mt-2 text-xl font-extrabold tracking-tight text-ink sm:text-2xl">
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[10px] text-ink-dim">{sub}</p>}
    </div>
  );
}

function ChartPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
      <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-ink-mute">{title}</h3>
      {children}
    </div>
  );
}

function TopTable({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10">
      <header className="border-b border-line/10 px-4 py-3">
        <h3 className="text-sm font-bold">{title}</h3>
      </header>
      <div className="max-h-96 overflow-y-auto">{children}</div>
    </div>
  );
}

function EmptyTable({ text }: { text: string }) {
  return <p className="px-3 py-8 text-center text-xs text-ink-mute">{text}</p>;
}
