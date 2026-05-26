import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Store, AlertTriangle, X } from 'lucide-react';
import {
  fetchSalespersonSummary, fetchSalespersonStores, fetchSalespersonStoreDetail,
  type SalespersonSummary, type SalespersonStore, type SalespersonStoreDetail,
} from '@/lib/salespersonApi';
import { toast } from '@/store/toastStore';

const won = (n: number | null | undefined) => `${(n ?? 0).toLocaleString('ko-KR')}원`;
const dt = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString('ko-KR') : '—');

export default function SalespersonDashboardPage() {
  const [summary, setSummary] = useState<SalespersonSummary | null>(null);
  const [stores, setStores] = useState<SalespersonStore[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SalespersonStoreDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await fetchSalespersonSummary();
      setSummary(s);
      if (s.is_agent) setStores(await fetchSalespersonStores());
    } catch (e) { toast.error(`불러오기 실패: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function openDetail(id: string) {
    setDetailId(id); setDetail(null); setDetailLoading(true);
    try { setDetail(await fetchSalespersonStoreDetail(id)); }
    catch (e) { toast.error(`상세 실패: ${(e as Error).message}`); setDetailId(null); }
    finally { setDetailLoading(false); }
  }

  if (loading) return <div className="mx-auto max-w-5xl p-4"><div className="h-40 animate-pulse rounded-2xl bg-bg-card" /></div>;

  if (!summary?.is_agent) {
    return (
      <div className="mx-auto max-w-5xl p-4">
        <div className="rounded-2xl bg-bg-card p-8 text-center text-sm text-ink-mute">
          영업인 계정이 아니거나 영업인 코드가 연결되지 않았어요. 관리자에게 문의해주세요.
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">영업인 대시보드</p>
          <h1 className="text-lg font-bold">{summary.agent_name} <span className="text-sm font-normal text-ink-mute">· 코드 {summary.code} · 수수료율 {summary.commission_rate}%</span></h1>
        </div>
        <button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-lg bg-bg-card px-3 py-2 text-xs font-semibold hover:bg-bg-hover"><RefreshCw size={13} /> 새로고침</button>
      </div>

      {/* A. 요약 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="총 영업 매장" v={`${summary.total_stores}개`} />
        <Stat label="활성 매장" v={`${summary.active_stores}개`} />
        <Stat label="최근 7일 재생 매장" v={`${summary.play_stores_7d}개`} />
        <Stat label="최근 30일 재생 매장" v={`${summary.play_stores_30d}개`} />
        <Stat label="총 매출" v={won(summary.total_revenue)} />
        <Stat label="이번 달 매출" v={won(summary.month_revenue)} />
        <Stat label="예상 수수료(누적)" v={won(summary.est_total_commission)} accent />
        <Stat label="이번 달 수수료" v={won(summary.month_commission)} accent />
        <Stat label="미정산 수수료" v={won(summary.unsettled_commission)} />
        <Stat label="정산 완료 수수료" v={won(summary.paid_commission)} />
      </div>
      <p className="text-[11px] text-ink-dim">매출은 결제 완료(환불/취소 제외) 기준이며, 수수료는 매출 × {summary.commission_rate}% 로 산정한 예상값입니다. 실제 지급은 관리자 확인 후 진행됩니다.</p>

      {/* B. 매장 목록 */}
      <div className="rounded-2xl bg-bg-card p-3">
        <h2 className="mb-2 flex items-center gap-1.5 text-sm font-bold"><Store size={15} className="text-accent" /> 매장 목록 ({stores.length})</h2>
        {stores.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-ink-dim">연결된 매장이 없어요.</p>
        ) : (
          <ul className="space-y-1.5">
            {stores.map((s) => {
              const risk = s.plays_30d === 0 || s.subscription_status === 'canceled';
              return (
                <li key={s.store_user_id}>
                  <button onClick={() => void openDetail(s.store_user_id)} className="flex w-full flex-wrap items-center gap-2 rounded-lg bg-bg-soft px-3 py-2 text-left text-[11px] hover:bg-bg-hover">
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold">{s.store_name} <span className="font-normal text-ink-dim">{s.owner_name ?? ''}</span></span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] ${s.subscription_status === 'active' ? 'bg-emerald-500/15 text-emerald-600' : 'bg-bg-card text-ink-mute'}`}>{s.subscription_status ?? '구독없음'}</span>
                    <span className="text-ink-dim">가입 {dt(s.joined_at)}</span>
                    <span className="text-ink-dim">최근재생 {dt(s.last_play_at)}</span>
                    <span className="text-ink-dim">30일 {s.plays_30d}회</span>
                    <span>{won(s.monthly_amount)}/월</span>
                    <span className="font-semibold text-accent">수수료 {won(s.est_commission)}</span>
                    {risk && <span className="inline-flex items-center gap-0.5 rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600"><AlertTriangle size={10} /> 위험</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* C. 매장 상세 */}
      {detailId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => { setDetailId(null); setDetail(null); }}>
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-bg-card p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold">{detail?.store_name ?? '매장 상세'}</h3>
              <button onClick={() => { setDetailId(null); setDetail(null); }} className="rounded p-1 hover:bg-bg-hover"><X size={16} /></button>
            </div>
            {detailLoading || !detail ? <p className="py-8 text-center text-sm text-ink-dim">불러오는 중…</p> : (
              <div className="space-y-3 text-[11px]">
                <div className="grid grid-cols-2 gap-2">
                  <Info label="사업자명" v={detail.owner_name ?? '—'} />
                  <Info label="업종" v={detail.business_type ?? '—'} />
                  <Info label="가입일" v={dt(detail.joined_at)} />
                  <Info label="최근 30일 재생" v={`${detail.plays_30d}회`} />
                  <Info label="최근 재생일" v={dt(detail.last_play_at)} />
                  <Info label="해지/미사용 위험" v={detail.at_risk ? (detail.risk_reason ?? '위험') : '정상'} danger={detail.at_risk} />
                </div>
                <Section title="구독/결제 내역">
                  {detail.subscriptions.map((s, i) => <p key={i}>· {s.plan_type ?? '플랜'} · {s.status} · {won(s.amount)} ({dt(s.period_start)}~{dt(s.period_end)})</p>)}
                  {detail.payments.slice(0, 8).map((p, i) => <p key={`p${i}`} className="text-ink-dim">· 결제 {won(p.amount)} · {p.status} · {dt(p.paid_at)}{p.refunded_at ? ' · 환불됨' : ''}</p>)}
                </Section>
                <Section title="사용 중인 플레이리스트 (최근 30일)">
                  {detail.recent_playlists.length ? detail.recent_playlists.map((t, i) => <span key={i} className="mr-1 inline-block rounded bg-bg-soft px-1.5 py-0.5">{t}</span>) : <span className="text-ink-dim">없음</span>}
                </Section>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, v, accent }: { label: string; v: string; accent?: boolean }) {
  return (
    <div className="rounded-xl bg-bg-card p-3">
      <p className="text-[10px] text-ink-dim">{label}</p>
      <p className={`mt-0.5 text-base font-bold ${accent ? 'text-accent' : ''}`}>{v}</p>
    </div>
  );
}
function Info({ label, v, danger }: { label: string; v: string; danger?: boolean }) {
  return <div><span className="text-ink-dim">{label}: </span><span className={danger ? 'font-semibold text-rose-600' : ''}>{v}</span></div>;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-bg-soft p-2">
      <p className="mb-1 font-bold text-ink-mute">{title}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}
