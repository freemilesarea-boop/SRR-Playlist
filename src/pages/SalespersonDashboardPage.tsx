import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  RefreshCw, Store, AlertTriangle, X, Download, ChevronRight, TrendingUp, Wallet, Activity, CreditCard,
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import {
  fetchMySalespersonProfile, fetchSalespersonSummary, fetchSalespersonStores, fetchSalespersonStoreDetail,
  fetchSalespersonTrends, storeRisk,
  type SalespersonSummary, type SalespersonStore, type SalespersonStoreDetail, type SalespersonTrends,
} from '@/lib/salespersonApi';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/toastStore';

const won = (n: number | null | undefined) => `₩${(n ?? 0).toLocaleString('ko-KR')}`;
const dt = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }) : '—');
const ACCENT = 'rgb(var(--color-accent))';
const TIP = { background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, fontSize: 11 } as const;

export default function SalespersonDashboardPage() {
  const [summary, setSummary] = useState<SalespersonSummary | null>(null);
  const [stores, setStores] = useState<SalespersonStore[]>([]);
  const [trends, setTrends] = useState<SalespersonTrends | null>(null);
  const [loading, setLoading] = useState(true);
  const [riskOnly, setRiskOnly] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SalespersonStoreDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const isAdmin = useAuthStore((s) => s.profile?.role === 'admin');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const prof = await fetchMySalespersonProfile();
      if (!prof.is_salesperson) { setSummary({ is_agent: false }); return; }
      const [s, st, tr] = await Promise.all([fetchSalespersonSummary(), fetchSalespersonStores(), fetchSalespersonTrends()]);
      setSummary(s); setStores(st); setTrends(tr);
    } catch (e) { toast.error(`불러오기 실패: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const enriched = useMemo(() => stores.map((s) => ({ s, risk: storeRisk(s) })), [stores]);
  const riskStores = useMemo(() => enriched.filter((e) => e.risk.level === 'risk'), [enriched]);
  const shown = useMemo(() => (riskOnly ? enriched.filter((e) => e.risk.level !== 'ok') : enriched), [enriched, riskOnly]);
  const paidStores = useMemo(() => stores.filter((s) => s.payment_status === 'paid' || s.subscription_status === 'active').length, [stores]);
  const newThisMonth = trends?.monthly?.[trends.monthly.length - 1]?.new_stores ?? 0;

  async function openDetail(id: string) {
    setDetailId(id); setDetail(null); setDetailLoading(true);
    try { setDetail(await fetchSalespersonStoreDetail(id)); }
    catch (e) { toast.error(`상세 실패: ${(e as Error).message}`); setDetailId(null); }
    finally { setDetailLoading(false); }
  }
  function downloadCsv() {
    const head = '매장명,사업자,상태,결제,가입일,최근재생,30일재생,월구독료,예상수수료,위험';
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const body = enriched.map(({ s, risk }) => [s.store_name, s.owner_name, s.subscription_status, s.payment_status, s.joined_at?.slice(0, 10), s.last_play_at?.slice(0, 10) ?? '', s.plays_30d, s.monthly_amount, s.est_commission, risk.reason ?? '정상'].map(esc).join(',')).join('\n');
    const blob = new Blob(['﻿' + head + '\n' + body], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `영업매장_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(a.href);
  }

  if (loading) return <SkeletonPage />;

  if (!summary?.is_agent) {
    return (
      <div className="mx-auto max-w-6xl p-4">
        <div className="space-y-3 rounded-3xl bg-bg-card p-10 text-center text-sm text-ink-mute ring-1 ring-line/10">
          <Store size={28} className="mx-auto text-ink-dim" />
          <p className="text-base font-semibold text-ink">영업인 계정만 접근할 수 있습니다.</p>
          {isAdmin && <p className="text-[12px]">관리자는 <Link to="/admin" className="font-semibold text-accent underline">관리자 페이지</Link>의 영업인 관리에서 전체 영업인·매출을 조회할 수 있어요.</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 pb-24">
      {/* 헤더 */}
      <header className="flex flex-wrap items-center gap-4 rounded-3xl bg-gradient-to-br from-bg-card to-bg-soft/40 p-5 ring-1 ring-line/10">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-accent/15 text-xl font-extrabold text-accent">
          {(summary.agent_name ?? '?').slice(0, 1)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">영업 매장 관리</p>
          <h1 className="truncate text-xl font-extrabold">{summary.agent_name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-mute">
            <span>코드 <b className="text-ink">{summary.code}</b></span>
            <span>수수료율 <b className="text-ink">{summary.commission_rate}%</b></span>
            <span className="inline-flex items-center gap-1 text-emerald-500"><TrendingUp size={12} /> 최근 7일 재생 매장 {summary.play_stores_7d}곳</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="text-right">
            <p className="text-[10px] text-ink-dim">이번 달 예상 수익</p>
            <p className="text-2xl font-extrabold text-accent">{won(summary.month_commission)}</p>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setRiskOnly((v) => !v)} className={`rounded-full px-2.5 py-1.5 text-[11px] font-semibold transition ${riskOnly ? 'bg-rose-500/15 text-rose-500' : 'bg-bg-soft text-ink-mute hover:bg-bg-hover'}`}>⚠ 위험만</button>
            <button onClick={downloadCsv} className="inline-flex items-center gap-1 rounded-full bg-bg-soft px-2.5 py-1.5 text-[11px] font-semibold hover:bg-bg-hover"><Download size={12} /> CSV</button>
            <button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-full bg-bg-soft px-2.5 py-1.5 text-[11px] font-semibold hover:bg-bg-hover"><RefreshCw size={12} /> 새로고침</button>
          </div>
        </div>
      </header>

      {/* 위험 경고 배너 */}
      {riskStores.length > 0 && (
        <button onClick={() => setRiskOnly(true)} className="flex w-full items-center gap-3 rounded-2xl bg-rose-500/10 px-4 py-3 text-left ring-1 ring-rose-500/20 transition hover:bg-rose-500/15">
          <AlertTriangle size={18} className="shrink-0 text-rose-500" />
          <span className="flex-1 text-sm font-semibold text-rose-600">관리 필요 매장 {riskStores.length}곳 — 재생 급감·결제 문제 등</span>
          <ChevronRight size={16} className="text-rose-400" />
        </button>
      )}

      {/* KPI 1순위 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi big icon={<Wallet size={16} />} label="이번 달 예상 수수료" value={won(summary.month_commission)} sub={`누적 ${won(summary.est_total_commission)}`} tone="accent" />
        <Kpi big icon={<Store size={16} />} label="활성 매장" value={`${summary.active_stores}곳`} sub={`전체 ${summary.total_stores}곳`} tone="emerald" />
        <Kpi big icon={<Activity size={16} />} label="최근 30일 재생" value={`${summary.play_stores_30d}곳 이용`} sub={`7일 ${summary.play_stores_7d}곳`} />
        <Kpi big icon={<CreditCard size={16} />} label="결제중 매장" value={`${paidStores}곳`} sub="구독/결제 활성" />
      </div>

      {/* KPI 2순위 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="총 영업 매장" value={`${summary.total_stores}곳`} />
        <Kpi label="해지 위험 매장" value={`${riskStores.length}곳`} tone={riskStores.length ? 'rose' : undefined} />
        <Kpi label="미정산 수수료" value={won(summary.unsettled_commission)} />
        <Kpi label="이번 달 신규 가입" value={`${newThisMonth}곳`} />
      </div>

      {/* 차트 */}
      {trends && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <ChartCard title="최근 30일 재생량">
            <ResponsiveContainer width="100%" height={150}>
              <AreaChart data={trends.daily_plays} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                <defs><linearGradient id="gp" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={ACCENT} stopOpacity={0.4} /><stop offset="100%" stopColor={ACCENT} stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="d" tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.35)' }} interval={6} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.35)' }} axisLine={false} tickLine={false} width={28} />
                <Tooltip contentStyle={TIP} />
                <Area type="monotone" dataKey="n" name="재생" stroke={ACCENT} strokeWidth={2} fill="url(#gp)" />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>
          <ChartCard title="월별 예상 수수료">
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={trends.monthly} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="m" tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.35)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.35)' }} axisLine={false} tickLine={false} width={28} />
                <Tooltip contentStyle={TIP} formatter={(v: number) => won(v)} />
                <Bar dataKey="commission" name="수수료" fill="#10b981" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
          <ChartCard title="누적 매장 추이">
            <ResponsiveContainer width="100%" height={150}>
              <LineChart data={trends.monthly} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="m" tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.35)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.35)' }} axisLine={false} tickLine={false} width={28} />
                <Tooltip contentStyle={TIP} />
                <Line type="monotone" dataKey="cumulative_stores" name="누적 매장" stroke="#6366f1" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      )}

      {/* 매장 리스트 */}
      <section className="rounded-3xl bg-bg-card p-4 ring-1 ring-line/10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-sm font-bold"><Store size={15} className="text-accent" /> 매장 {shown.length}곳 {riskOnly && <span className="text-[11px] font-normal text-rose-500">(위험만)</span>}</h2>
        </div>
        {shown.length === 0 ? (
          <p className="px-2 py-10 text-center text-sm text-ink-dim">{riskOnly ? '위험 매장이 없어요 👍' : '연결된 매장이 없어요.'}</p>
        ) : (
          <>
            {/* 데스크톱 테이블 헤더 */}
            <div className="hidden grid-cols-12 gap-2 border-b border-line/10 px-2 pb-2 text-[10px] font-semibold uppercase tracking-wide text-ink-dim sm:grid">
              <span className="col-span-3">매장</span><span className="col-span-2">상태</span><span className="col-span-2">최근 재생</span>
              <span className="col-span-2 text-right">월 구독료</span><span className="col-span-2 text-right">예상 수수료</span><span className="col-span-1" />
            </div>
            <ul className="divide-y divide-line/5">
              {shown.map(({ s, risk }) => (
                <li key={s.store_user_id}>
                  <button onClick={() => void openDetail(s.store_user_id)} className="grid w-full grid-cols-2 items-center gap-2 rounded-xl px-2 py-3 text-left text-xs transition hover:bg-bg-soft/60 sm:grid-cols-12">
                    <span className="col-span-2 min-w-0 sm:col-span-3">
                      <span className="block truncate font-semibold">{s.store_name}</span>
                      <span className="block truncate text-[10px] text-ink-dim">{s.owner_name ?? ''}</span>
                    </span>
                    <span className="col-span-1 sm:col-span-2"><StatusBadge sub={s.subscription_status} risk={risk} /></span>
                    <span className="col-span-1 text-[11px] text-ink-mute sm:col-span-2">{dt(s.last_play_at)} · {s.plays_30d}회</span>
                    <span className="col-span-1 text-right text-[11px] sm:col-span-2">{won(s.monthly_amount)}</span>
                    <span className="col-span-1 text-right text-[11px] font-bold text-accent sm:col-span-2">{won(s.est_commission)}</span>
                    <span className="hidden justify-end sm:col-span-1 sm:flex"><ChevronRight size={15} className="text-ink-dim" /></span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* 매장 상세 Drawer */}
      <div className={`fixed inset-0 z-50 transition ${detailId ? 'pointer-events-auto' : 'pointer-events-none'}`}>
        <div className={`absolute inset-0 bg-black/50 transition-opacity ${detailId ? 'opacity-100' : 'opacity-0'}`} onClick={() => { setDetailId(null); setDetail(null); }} />
        <aside className={`absolute right-0 top-0 h-full w-full max-w-md overflow-y-auto bg-bg-card shadow-2xl transition-transform duration-300 ${detailId ? 'translate-x-0' : 'translate-x-full'}`}>
          <div className="sticky top-0 flex items-center justify-between border-b border-line/10 bg-bg-card/90 px-4 py-3 backdrop-blur">
            <h3 className="text-sm font-bold">{detail?.store_name ?? '매장 상세'}</h3>
            <button onClick={() => { setDetailId(null); setDetail(null); }} className="rounded-lg p-1 hover:bg-bg-hover"><X size={16} /></button>
          </div>
          {detailId && (detailLoading || !detail ? (
            <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-bg-soft" />)}</div>
          ) : (
            <div className="space-y-4 p-4 text-[11px]">
              <div className="grid grid-cols-2 gap-2">
                <Info label="사업자명" v={detail.owner_name ?? '—'} />
                <Info label="업종" v={detail.business_type ?? '—'} />
                <Info label="가입일" v={dt(detail.joined_at)} />
                <Info label="최근 30일 재생" v={`${detail.plays_30d}회`} />
                <Info label="최근 접속" v={dt(detail.last_play_at)} />
                <Info label="위험" v={detail.at_risk ? (detail.risk_reason ?? '위험') : '정상'} danger={detail.at_risk} />
              </div>
              <DrawerSection title="구독 / 결제 내역">
                {detail.subscriptions.map((s, i) => <p key={i}>· {s.plan_type ?? '플랜'} · <b>{s.status}</b> · {won(s.amount)} <span className="text-ink-dim">({dt(s.period_start)}~{dt(s.period_end)})</span></p>)}
                {detail.payments.slice(0, 6).map((p, i) => <p key={`p${i}`} className="text-ink-dim">· 결제 {won(p.amount)} · {p.status} · {dt(p.paid_at)}{p.refunded_at ? ' · 환불' : ''}</p>)}
                {detail.subscriptions.length === 0 && detail.payments.length === 0 && <p className="text-ink-dim">내역 없음</p>}
              </DrawerSection>
              <DrawerSection title="최근 30일 이용 플레이리스트">
                {detail.recent_playlists.length ? <div className="flex flex-wrap gap-1">{detail.recent_playlists.map((t, i) => <span key={i} className="rounded-full bg-bg-soft px-2 py-0.5">{t}</span>)}</div> : <p className="text-ink-dim">없음</p>}
              </DrawerSection>
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, icon, tone, big }: { label: string; value: string; sub?: string; icon?: React.ReactNode; tone?: 'accent' | 'emerald' | 'rose'; big?: boolean }) {
  const toneCls = tone === 'accent' ? 'text-accent' : tone === 'emerald' ? 'text-emerald-500' : tone === 'rose' ? 'text-rose-500' : '';
  return (
    <div className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10 transition hover:ring-line/25">
      <div className="flex items-center gap-1.5 text-[10px] font-medium text-ink-dim">{icon && <span className={toneCls || 'text-ink-mute'}>{icon}</span>}{label}</div>
      <p className={`mt-1.5 font-extrabold ${big ? 'text-xl' : 'text-base'} ${toneCls}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[10px] text-ink-dim">{sub}</p>}
    </div>
  );
}
function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-bg-card p-3 ring-1 ring-line/10">
      <p className="mb-1 px-1 text-[11px] font-semibold text-ink-mute">{title}</p>
      {children}
    </div>
  );
}
function StatusBadge({ sub, risk }: { sub: string | null; risk: { level: 'risk' | 'warn' | 'ok'; reason: string | null } }) {
  if (risk.level === 'risk') return <Badge cls="bg-rose-500/15 text-rose-500" title={risk.reason ?? undefined}>⚠ {risk.reason}</Badge>;
  if (risk.level === 'warn') return <Badge cls="bg-amber-500/15 text-amber-500" title={risk.reason ?? undefined}>{risk.reason}</Badge>;
  if (sub === 'active') return <Badge cls="bg-emerald-500/15 text-emerald-500">정상 이용중</Badge>;
  if (sub === 'pending') return <Badge cls="bg-amber-500/15 text-amber-500">결제 대기</Badge>;
  return <Badge cls="bg-ink/10 text-ink-mute">{sub ?? '비활성'}</Badge>;
}
function Badge({ cls, title, children }: { cls: string; title?: string; children: React.ReactNode }) {
  return <span title={title} className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>{children}</span>;
}
function Info({ label, v, danger }: { label: string; v: string; danger?: boolean }) {
  return <div className="rounded-xl bg-bg-soft/60 p-2"><p className="text-[10px] text-ink-dim">{label}</p><p className={`mt-0.5 font-semibold ${danger ? 'text-rose-500' : ''}`}>{v}</p></div>;
}
function DrawerSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <div><p className="mb-1.5 text-[11px] font-bold text-ink-mute">{title}</p><div className="space-y-1 rounded-xl bg-bg-soft/40 p-2.5">{children}</div></div>;
}
function SkeletonPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4">
      <div className="h-24 animate-pulse rounded-3xl bg-bg-card" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-bg-card" />)}</div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="h-44 animate-pulse rounded-2xl bg-bg-card" />)}</div>
      <div className="h-64 animate-pulse rounded-3xl bg-bg-card" />
    </div>
  );
}
