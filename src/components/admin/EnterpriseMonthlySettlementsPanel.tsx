/**
 * EnterpriseMonthlySettlementsPanel — Phase 1-11
 *
 * Admin 월 정산 탭. 본사별 월 정산 스냅샷 목록 + 생성/승인/지급/취소.
 *
 * SQL: supabase/migrations/0372_enterprise_monthly_settlement.sql
 * API: src/lib/api/enterpriseMonthlySettlementApi.ts
 */
import { useCallback, useEffect, useState } from 'react';
import {
  RefreshCw, AlertCircle, Wallet, Play, ThumbsUp, BadgeCheck, X, Ban,
  FileText, CheckCircle2, XCircle, Clock as ClockIcon, AlertTriangle,
} from 'lucide-react';
import {
  adminGenerateEnterpriseMonthlySettlement,
  adminListEnterpriseMonthlySettlements,
  adminGetEnterpriseMonthlySettlement,
  adminApproveEnterpriseMonthlySettlement,
  adminMarkPaidEnterpriseMonthlySettlement,
  adminCancelEnterpriseMonthlySettlement,
  currentMonthFirstDay,
  formatSettlementMonth,
  SETTLEMENT_STATUS_LABEL,
  type EnterpriseMonthlySettlementRow,
  type EnterpriseMonthlySettlementStatus,
  type EnterpriseMonthlySettlementDetail,
  type EnterpriseMonthlySettlementItem,
} from '@/lib/api/enterpriseMonthlySettlementApi';
import { toast } from '@/store/toastStore';

const STATUS_OPTIONS: ReadonlyArray<{ value: EnterpriseMonthlySettlementStatus; label: string }> = [
  { value: 'pending',   label: SETTLEMENT_STATUS_LABEL.pending },
  { value: 'approved',  label: SETTLEMENT_STATUS_LABEL.approved },
  { value: 'paid',      label: SETTLEMENT_STATUS_LABEL.paid },
  { value: 'cancelled', label: SETTLEMENT_STATUS_LABEL.cancelled },
];

const PAGE_SIZE = 50;

export default function EnterpriseMonthlySettlementsPanel() {
  const [rows, setRows] = useState<EnterpriseMonthlySettlementRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 월 필터: 'YYYY-MM' (input type=month). 빈 문자열 = 전체
  const [monthFilter, setMonthFilter] = useState<string>(currentMonthFirstDay().slice(0, 7));
  const [statusFilter, setStatusFilter] = useState<EnterpriseMonthlySettlementStatus | ''>('');
  const [offset, setOffset] = useState(0);
  const [generating, setGenerating] = useState(false);
  // 생성 대상 월: 'YYYY-MM' (헤더 input). 기본 = 현재 월
  const [generateMonth, setGenerateMonth] = useState<string>(currentMonthFirstDay().slice(0, 7));
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await adminListEnterpriseMonthlySettlements({
        month: monthFilter ? `${monthFilter}-01` : null,
        status: statusFilter || null,
        limit: PAGE_SIZE,
        offset,
      });
      setRows(r.rows);
      setTotal(r.total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [monthFilter, statusFilter, offset]);

  useEffect(() => { void load(); }, [load]);

  const onGenerate = async () => {
    if (!generateMonth) {
      toast.error('생성할 월을 선택해주세요.');
      return;
    }
    if (!confirm(`${generateMonth} 정산을 생성하시겠습니까? (이미 존재하는 본사는 skip)`)) return;
    setGenerating(true);
    try {
      const r = await adminGenerateEnterpriseMonthlySettlement(`${generateMonth}-01`);
      toast.success(`${generateMonth} 생성 완료 — 신규 ${r.created} / 스킵 ${r.skipped}`);
      // 새로 만든 월로 필터 이동
      setMonthFilter(generateMonth);
      setOffset(0);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  return (
    <div className="space-y-3">
      {/* 헤더 */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-extrabold flex items-center gap-1.5">
          <Wallet size={14} /> 본사 월 정산
        </h2>
        <span className="text-[10px] text-ink-dim">총 {total.toLocaleString('ko-KR')}건</span>
        <button onClick={() => void load()} disabled={loading}
          className="ml-auto inline-flex items-center gap-1 rounded bg-bg-deep px-2 py-1 text-xs hover:bg-bg-hover disabled:opacity-50">
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> 새로고침
        </button>
      </div>

      {/* 생성 + 필터 */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-xl bg-bg-card p-3 ring-1 ring-line/10">
          <p className="text-[10px] uppercase tracking-wider text-ink-dim mb-1.5">이번 달 정산 생성</p>
          <div className="flex items-center gap-2">
            <input
              type="month" value={generateMonth}
              onChange={(e) => setGenerateMonth(e.target.value)}
              disabled={generating}
              className="rounded bg-bg-deep px-2 py-1.5 text-xs tabular-nums"
            />
            <button
              type="button"
              onClick={() => void onGenerate()}
              disabled={generating || !generateMonth}
              className="ml-auto inline-flex items-center gap-1 rounded bg-emerald-500/20 px-3 py-1.5 text-xs font-bold text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-30"
            >
              {generating ? <RefreshCw size={11} className="animate-spin" /> : <Play size={11} />}
              {generating ? '생성 중…' : '정산 생성'}
            </button>
          </div>
          <p className="mt-1.5 text-[10px] text-ink-dim">
            정산 설정 + active 매장이 있는 본사만 생성됩니다.
          </p>
        </div>
        <div className="rounded-xl bg-bg-card p-3 ring-1 ring-line/10">
          <p className="text-[10px] uppercase tracking-wider text-ink-dim mb-1.5">필터</p>
          <div className="flex items-center gap-2">
            <input
              type="month" value={monthFilter}
              onChange={(e) => { setMonthFilter(e.target.value); setOffset(0); }}
              className="rounded bg-bg-deep px-2 py-1.5 text-xs tabular-nums"
              aria-label="월 필터"
            />
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value as EnterpriseMonthlySettlementStatus | ''); setOffset(0); }}
              className="rounded bg-bg-deep px-2 py-1.5 text-xs"
              aria-label="상태 필터"
            >
              <option value="">전체 상태</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => { setMonthFilter(''); setStatusFilter(''); setOffset(0); }}
              className="ml-auto rounded bg-bg-deep px-2 py-1 text-[11px] hover:bg-bg-hover"
            >
              초기화
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded bg-rose-500/15 px-3 py-2 text-xs text-rose-300">
          <AlertCircle size={12} className="inline mr-1" />{error}
          <button onClick={() => void load()} className="ml-2 rounded bg-rose-500/30 px-2 py-0.5 font-bold">재시도</button>
        </div>
      )}

      {/* 목록 */}
      {loading && rows.length === 0 ? (
        <div className="space-y-2">
          <div className="h-12 animate-pulse rounded bg-bg-card" />
          <div className="h-12 animate-pulse rounded bg-bg-card" />
          <div className="h-12 animate-pulse rounded bg-bg-card" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl bg-bg-card p-6 text-center text-xs text-ink-mute ring-1 ring-line/10">
          조건에 맞는 정산 내역이 없습니다.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-bg-card ring-1 ring-line/10">
          <table className="w-full min-w-[920px] text-xs">
            <thead className="bg-bg-deep text-[10px] uppercase tracking-wider text-ink-dim">
              <tr>
                <th className="px-3 py-2 text-left">월</th>
                <th className="px-3 py-2 text-left">본사</th>
                <th className="px-3 py-2 text-right">활성 매장</th>
                <th className="px-3 py-2 text-right">단가</th>
                <th className="px-3 py-2 text-right">수수료율</th>
                <th className="px-3 py-2 text-right">매장당</th>
                <th className="px-3 py-2 text-right">총 정산금</th>
                <th className="px-3 py-2 text-center">상태</th>
                <th className="px-3 py-2 text-left">일자</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/10">
              {rows.map((r) => (
                <tr key={r.id}
                  onClick={() => setDetailId(r.id)}
                  className="cursor-pointer hover:bg-bg-hover/50">
                  <td className="px-3 py-2 font-mono tabular-nums">{formatSettlementMonth(r.settlement_month)}</td>
                  <td className="px-3 py-2">
                    <div className="font-semibold">{r.enterprise_name}</div>
                    {r.brand_code && <div className="text-[10px] text-ink-dim font-mono">{r.brand_code}</div>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.active_store_count.toLocaleString('ko-KR')}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.monthly_store_price.toLocaleString('ko-KR')}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.commission_rate}%</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.per_store_commission.toLocaleString('ko-KR')}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-bold text-emerald-300">{r.total_commission.toLocaleString('ko-KR')}</td>
                  <td className="px-3 py-2 text-center"><StatusBadge status={r.status} /></td>
                  <td className="px-3 py-2 text-[10px] text-ink-dim">
                    <DateLine label="생성" value={r.generated_at} />
                    {r.approved_at && <DateLine label="승인" value={r.approved_at} />}
                    {r.paid_at && <DateLine label="지급" value={r.paid_at} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 페이지네이션 */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-xs text-ink-mute">
          <span>
            {offset + 1} – {Math.min(offset + PAGE_SIZE, total)} / {total.toLocaleString('ko-KR')}
          </span>
          <div className="flex gap-2">
            <button disabled={!hasPrev}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              className="rounded bg-bg-deep px-2 py-1 disabled:opacity-30">이전</button>
            <button disabled={!hasNext}
              onClick={() => setOffset(offset + PAGE_SIZE)}
              className="rounded bg-bg-deep px-2 py-1 disabled:opacity-30">다음</button>
          </div>
        </div>
      )}

      {detailId && (
        <DetailModal
          settlementId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}

// =============================================================================
// Detail modal — items + 상태 변경
// =============================================================================

function DetailModal({
  settlementId, onClose, onChanged,
}: { settlementId: string; onClose: () => void; onChanged: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settlement, setSettlement] = useState<EnterpriseMonthlySettlementDetail | null>(null);
  const [items, setItems] = useState<EnterpriseMonthlySettlementItem[]>([]);
  const [acting, setActing] = useState(false);
  const [paidMode, setPaidMode] = useState(false);
  const [paymentRef, setPaymentRef] = useState('');
  const [paidNote, setPaidNote] = useState('');
  const [cancelMode, setCancelMode] = useState(false);
  const [cancelNote, setCancelNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await adminGetEnterpriseMonthlySettlement(settlementId);
      setSettlement(r.settlement);
      setItems(r.items);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [settlementId]);
  useEffect(() => { void load(); }, [load]);

  const onApprove = async () => {
    if (!confirm('이 정산을 승인하시겠습니까?')) return;
    setActing(true);
    try {
      await adminApproveEnterpriseMonthlySettlement(settlementId);
      toast.success('승인 완료');
      await load();
      onChanged();
    } catch (e) { toast.error((e as Error).message); }
    finally { setActing(false); }
  };

  const onMarkPaid = async () => {
    if (!paymentRef.trim()) { toast.error('지급 참조(이체번호 등)를 입력하세요.'); return; }
    setActing(true);
    try {
      await adminMarkPaidEnterpriseMonthlySettlement(
        settlementId, paymentRef.trim(), paidNote.trim() || null);
      toast.success('지급완료 처리됨');
      setPaidMode(false); setPaymentRef(''); setPaidNote('');
      await load();
      onChanged();
    } catch (e) { toast.error((e as Error).message); }
    finally { setActing(false); }
  };

  const onCancel = async () => {
    if (!cancelNote.trim()) { toast.error('취소 사유를 입력하세요.'); return; }
    setActing(true);
    try {
      await adminCancelEnterpriseMonthlySettlement(settlementId, cancelNote.trim());
      toast.success('취소 처리됨');
      setCancelMode(false); setCancelNote('');
      await load();
      onChanged();
    } catch (e) { toast.error((e as Error).message); }
    finally { setActing(false); }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold flex items-center gap-1.5">
            <Wallet size={14} /> 월 정산 상세
          </h3>
          <button onClick={onClose} className="rounded p-1 hover:bg-bg-hover"><X size={14} /></button>
        </div>

        {loading && !settlement && <div className="h-40 animate-pulse rounded bg-bg-deep" />}
        {error && (
          <div className="rounded bg-rose-500/15 px-3 py-2 text-xs text-rose-300">
            <AlertCircle size={12} className="inline mr-1" />{error}
            <button onClick={() => void load()} className="ml-2 rounded bg-rose-500/30 px-2 py-0.5 font-bold">재시도</button>
          </div>
        )}

        {settlement && (
          <div className="space-y-3 text-xs">
            {/* 요약 */}
            <div className="rounded-lg bg-bg-deep p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h4 className="text-sm font-bold">{settlement.enterprise_name}</h4>
                  <p className="text-[11px] text-ink-mute">
                    {settlement.manager_name} · {settlement.manager_email}
                    {settlement.brand_code && ` · ${settlement.brand_code}`}
                  </p>
                </div>
                <StatusBadge status={settlement.status} />
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                <KV k="정산월" v={formatSettlementMonth(settlement.settlement_month)} mono />
                <KV k="활성 매장" v={`${settlement.active_store_count.toLocaleString('ko-KR')}개`} />
                <KV k="단가" v={`${settlement.monthly_store_price.toLocaleString('ko-KR')}원`} />
                <KV k="수수료율" v={`${settlement.commission_rate}%`} />
                <KV k="매장당" v={`${settlement.per_store_commission.toLocaleString('ko-KR')}원`} />
                <KV k="총 정산금" v={`${settlement.total_commission.toLocaleString('ko-KR')}원`} highlight />
              </dl>
              <dl className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-ink-dim">
                <KV k="생성" v={new Date(settlement.generated_at).toLocaleString('ko-KR')} />
                {settlement.approved_at && <KV k="승인" v={new Date(settlement.approved_at).toLocaleString('ko-KR')} />}
                {settlement.paid_at && <KV k="지급" v={new Date(settlement.paid_at).toLocaleString('ko-KR')} />}
                {settlement.payment_reference && <KV k="지급 참조" v={settlement.payment_reference} mono />}
                {settlement.admin_note && <KV k="메모" v={settlement.admin_note} colSpan />}
              </dl>
            </div>

            {/* items */}
            <div className="rounded-lg bg-bg-deep p-3">
              <p className="text-[10px] uppercase tracking-wider text-ink-dim mb-2 flex items-center gap-1.5">
                <FileText size={11} /> 매장별 정산 근거 ({items.length}개)
              </p>
              <ul className="divide-y divide-line/10">
                {items.map((it) => (
                  <li key={it.id} className="flex items-center gap-2 py-1.5 text-[11px]">
                    <ItemBadge status={it.status} />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold truncate">{it.store_name ?? '(매장명 없음)'}</div>
                      <div className="text-[10px] text-ink-dim truncate">
                        {it.franchise_name}
                        {it.region_name && ` · ${it.region_name}`}
                        {it.reason && ` · ${it.reason}`}
                      </div>
                    </div>
                    <span className="shrink-0 tabular-nums">
                      {it.per_store_commission.toLocaleString('ko-KR')}원
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {/* 상태 변경 */}
            <div className="rounded-lg bg-bg-deep p-3">
              <p className="text-[10px] uppercase tracking-wider text-ink-dim mb-2">상태 변경</p>

              {settlement.status === 'pending' && !paidMode && !cancelMode && (
                <div className="flex gap-2">
                  <button onClick={() => void onApprove()} disabled={acting}
                    className="flex-1 inline-flex items-center justify-center gap-1 rounded bg-emerald-500/20 px-3 py-2 font-bold text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-30">
                    <ThumbsUp size={12} /> 승인
                  </button>
                  <button onClick={() => setCancelMode(true)} disabled={acting}
                    className="flex-1 inline-flex items-center justify-center gap-1 rounded bg-rose-500/20 px-3 py-2 font-bold text-rose-300 hover:bg-rose-500/30 disabled:opacity-30">
                    <Ban size={12} /> 취소
                  </button>
                </div>
              )}

              {settlement.status === 'approved' && !paidMode && !cancelMode && (
                <div className="flex gap-2">
                  <button onClick={() => setPaidMode(true)} disabled={acting}
                    className="flex-1 inline-flex items-center justify-center gap-1 rounded bg-emerald-500/20 px-3 py-2 font-bold text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-30">
                    <BadgeCheck size={12} /> 지급완료 처리
                  </button>
                  <button onClick={() => setCancelMode(true)} disabled={acting}
                    className="flex-1 inline-flex items-center justify-center gap-1 rounded bg-rose-500/20 px-3 py-2 font-bold text-rose-300 hover:bg-rose-500/30 disabled:opacity-30">
                    <Ban size={12} /> 취소
                  </button>
                </div>
              )}

              {settlement.status === 'paid' && (
                <p className="text-[11px] text-emerald-300">
                  <CheckCircle2 size={11} className="inline mr-1" />
                  지급완료 — 회계 보존 정책에 따라 변경 불가 (immutable).
                </p>
              )}

              {settlement.status === 'cancelled' && (
                <p className="text-[11px] text-rose-300">
                  <XCircle size={11} className="inline mr-1" />
                  취소됨 — 동일 월 새 정산을 다시 생성할 수 있습니다.
                </p>
              )}

              {paidMode && (
                <div className="space-y-2">
                  <input
                    value={paymentRef}
                    onChange={(e) => setPaymentRef(e.target.value)}
                    placeholder="지급 참조 (이체번호/세금계산서 번호 등)"
                    className="w-full rounded bg-bg px-2 py-1.5 text-xs font-mono"
                  />
                  <textarea
                    value={paidNote}
                    onChange={(e) => setPaidNote(e.target.value)}
                    placeholder="메모 (선택)"
                    className="w-full rounded bg-bg px-2 py-1.5 text-xs min-h-[50px]"
                  />
                  <div className="flex gap-2">
                    <button onClick={() => void onMarkPaid()} disabled={acting || !paymentRef.trim()}
                      className="flex-1 rounded bg-emerald-500/30 px-3 py-2 font-bold text-emerald-200 disabled:opacity-30">
                      지급완료 확정
                    </button>
                    <button onClick={() => { setPaidMode(false); setPaymentRef(''); setPaidNote(''); }}
                      className="rounded bg-bg-card px-3 py-2 font-bold hover:bg-bg-hover">취소</button>
                  </div>
                </div>
              )}

              {cancelMode && (
                <div className="space-y-2">
                  <textarea
                    value={cancelNote}
                    onChange={(e) => setCancelNote(e.target.value)}
                    placeholder="취소 사유 (필수)"
                    className="w-full rounded bg-bg px-2 py-1.5 text-xs min-h-[60px]"
                  />
                  <div className="flex gap-2">
                    <button onClick={() => void onCancel()} disabled={acting || !cancelNote.trim()}
                      className="flex-1 rounded bg-rose-500/30 px-3 py-2 font-bold text-rose-200 disabled:opacity-30">
                      취소 확정
                    </button>
                    <button onClick={() => { setCancelMode(false); setCancelNote(''); }}
                      className="rounded bg-bg-card px-3 py-2 font-bold hover:bg-bg-hover">닫기</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Small components
// =============================================================================

function StatusBadge({ status }: { status: EnterpriseMonthlySettlementStatus }) {
  const map = {
    pending:   { tone: 'bg-amber-500/15 text-amber-300',     icon: <ClockIcon size={10} /> },
    approved:  { tone: 'bg-sky-500/15 text-sky-300',         icon: <ThumbsUp size={10} /> },
    paid:      { tone: 'bg-emerald-500/15 text-emerald-300', icon: <CheckCircle2 size={10} /> },
    cancelled: { tone: 'bg-rose-500/15 text-rose-300',       icon: <XCircle size={10} /> },
  } as const;
  const v = map[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${v.tone}`}>
      {v.icon} {SETTLEMENT_STATUS_LABEL[status]}
    </span>
  );
}

function ItemBadge({ status }: { status: 'included' | 'excluded' }) {
  return status === 'included'
    ? <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
        <CheckCircle2 size={9} /> 포함
      </span>
    : <span className="inline-flex items-center gap-1 rounded bg-ink/10 px-1.5 py-0.5 text-[10px] font-bold text-ink-mute">
        <AlertTriangle size={9} /> 제외
      </span>;
}

function KV({ k, v, colSpan, mono, highlight }: {
  k: string; v: string; colSpan?: boolean; mono?: boolean; highlight?: boolean;
}) {
  return (
    <div className={colSpan ? 'col-span-2' : ''}>
      <dt className="text-[10px] text-ink-dim">{k}</dt>
      <dd className={`${mono ? 'font-mono' : ''} ${highlight ? 'font-bold text-emerald-300' : ''} text-[11px]`}>
        {v}
      </dd>
    </div>
  );
}

function DateLine({ label, value }: { label: string; value: string }) {
  return (
    <div>{label} {new Date(value).toLocaleDateString('ko-KR')}</div>
  );
}
