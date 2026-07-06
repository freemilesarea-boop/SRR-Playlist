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
  Lock, ScrollText,
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
  SETTLEMENT_RATE_SOURCE_LABEL,
  type EnterpriseMonthlySettlementRow,
  type EnterpriseMonthlySettlementStatus,
  type EnterpriseMonthlySettlementDetail,
  type EnterpriseMonthlySettlementItem,
  type SettlementRateSource,
} from '@/lib/api/enterpriseMonthlySettlementApi';
import { toast } from '@/store/toastStore';
import {
  AdminSection, AdminCard, AdminBadge, AdminAlert, AdminEmpty,
  AdminSkeleton, AdminButton,
  type AdminToneName,
} from '@/components/admin/ui';
import { adminTypography } from '@/lib/adminTypography';

// 정산 status → DS tone 매핑
const STATUS_TONE: Record<EnterpriseMonthlySettlementStatus, AdminToneName> = {
  pending:   'warning',
  approved:  'info',
  paid:      'success',
  cancelled: 'danger',
};

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
    <AdminSection
      title={<><Wallet size={14} /> 본사 월 정산</>}
      badge={<span className={adminTypography.hint}>총 {total.toLocaleString('ko-KR')}건</span>}
      action={
        <AdminButton
          tone="neutral" variant="subtle" size="sm"
          leftIcon={<RefreshCw size={11} className={loading ? 'animate-spin' : ''} />}
          onClick={() => void load()} disabled={loading}
        >
          새로고침
        </AdminButton>
      }
    >
      {/* 생성 + 필터 */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <AdminCard title="이번 달 정산 생성" subtitle="정산 설정 + active 매장이 있는 본사만 생성됩니다.">
          <div className="flex items-center gap-2">
            <input
              type="month" value={generateMonth}
              onChange={(e) => setGenerateMonth(e.target.value)}
              disabled={generating}
              className="rounded bg-bg-deep px-2 py-1.5 text-xs tabular-nums"
            />
            <AdminButton
              tone="success" variant="solid" size="sm" className="ml-auto"
              leftIcon={generating ? <RefreshCw size={11} className="animate-spin" /> : <Play size={11} />}
              onClick={() => void onGenerate()}
              disabled={generating || !generateMonth}
            >
              {generating ? '생성 중…' : '정산 생성'}
            </AdminButton>
          </div>
        </AdminCard>
        <AdminCard title="필터">
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
            <AdminButton
              tone="neutral" variant="subtle" size="sm" className="ml-auto"
              onClick={() => { setMonthFilter(''); setStatusFilter(''); setOffset(0); }}
            >
              초기화
            </AdminButton>
          </div>
        </AdminCard>
      </div>

      {error && (
        <AdminAlert
          tone="danger"
          title="목록 불러오기 실패"
          description={error}
          action={
            <AdminButton tone="danger" variant="subtle" size="sm" onClick={() => void load()}>
              재시도
            </AdminButton>
          }
        />
      )}

      {/* 목록 */}
      {loading && rows.length === 0 ? (
        <AdminSkeleton variant="table" rows={4} />
      ) : rows.length === 0 ? (
        <AdminEmpty
          icon={<Wallet size={20} />}
          title="조건에 맞는 정산 내역이 없습니다"
          description="월/상태 필터를 조정하거나 위 '정산 생성' 버튼으로 신규 생성하세요."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl bg-bg-card ring-1 ring-line/10">
          <table className="w-full min-w-[1040px] text-xs">
            <thead className="bg-bg-deep text-[10px] uppercase tracking-wider text-ink-dim">
              <tr>
                <th className="px-3 py-2 text-left">월</th>
                <th className="px-3 py-2 text-left">본사</th>
                <th className="px-3 py-2 text-right">활성 매장</th>
                <th className="px-3 py-2 text-right">단가</th>
                <th className="px-3 py-2 text-right">수수료율</th>
                <th className="px-3 py-2 text-center">적용 출처</th>
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
                  <td className="px-3 py-2 text-center">
                    <RateSourceBadge source={r.rate_source} contractNo={r.contract_no} />
                  </td>
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
            <AdminButton tone="neutral" variant="subtle" size="sm" disabled={!hasPrev}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
              이전
            </AdminButton>
            <AdminButton tone="neutral" variant="subtle" size="sm" disabled={!hasNext}
              onClick={() => setOffset(offset + PAGE_SIZE)}>
              다음
            </AdminButton>
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
    </AdminSection>
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
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-3xl flex-col max-h-[95vh] sm:max-h-[90vh]
                   rounded-t-2xl sm:rounded-2xl bg-bg-card ring-1 ring-line/10">
        {/* Sticky Header */}
        <div className="shrink-0 flex items-center justify-between border-b border-line/10 px-4 py-3">
          <h3 className="text-sm font-bold flex items-center gap-1.5">
            <Wallet size={14} /> 월 정산 상세
            {settlement && (
              <span className="ml-2"><StatusBadge status={settlement.status} /></span>
            )}
          </h3>
          <button onClick={onClose} className="rounded p-1 hover:bg-bg-hover"><X size={14} /></button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {loading && !settlement && <div className="h-40 animate-pulse rounded bg-bg-deep" />}
          {error && (
            <div className="rounded bg-rose-500/25 px-3 py-2 text-xs text-rose-300">
              <AlertCircle size={12} className="inline mr-1" />{error}
              <button onClick={() => void load()} className="ml-2 rounded bg-rose-500/30 px-2 py-0.5 font-bold">재시도</button>
            </div>
          )}

          {settlement && (
            <div className="space-y-3 text-xs">
              {/* 요약 */}
              <div className="rounded-lg bg-bg-deep p-3">
                <div>
                  <h4 className="text-sm font-bold">{settlement.enterprise_name}</h4>
                  <p className="text-[11px] text-ink-mute">
                    {settlement.manager_name} · {settlement.manager_email}
                    {settlement.brand_code && ` · ${settlement.brand_code}`}
                  </p>
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                  <KV k="정산월" v={formatSettlementMonth(settlement.settlement_month)} mono />
                  <KV k="활성 매장" v={`${settlement.active_store_count.toLocaleString('ko-KR')}개`} />
                  <KV k="단가" v={`${settlement.monthly_store_price.toLocaleString('ko-KR')}원`} />
                  <KV k="수수료율" v={`${settlement.commission_rate}%`} />
                  <KV k="매장당" v={`${settlement.per_store_commission.toLocaleString('ko-KR')}원`} />
                  <KV k="총 정산금" v={`${settlement.total_commission.toLocaleString('ko-KR')}원`} highlight />
                </dl>
                {/* 0390 — 적용 계약 Snapshot 검증 카드 (생성 시점 고정, read-only) */}
                <ContractSnapshotCard settlement={settlement} />
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
            </div>
          )}
        </div>

        {/* Sticky Footer — status-aware action (always visible) */}
        {settlement && (
          <div className="shrink-0 border-t border-line/10 bg-bg-card/95 px-4 py-3
                          [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))]">
            {/* pending */}
            {settlement.status === 'pending' && !paidMode && !cancelMode && (
              <div className="flex gap-2">
                <AdminButton tone="success" variant="subtle" size="lg" fullWidth
                  leftIcon={<ThumbsUp size={12} />}
                  onClick={() => void onApprove()} disabled={acting}>
                  승인
                </AdminButton>
                <AdminButton tone="danger" variant="subtle" size="lg" fullWidth
                  leftIcon={<Ban size={12} />}
                  onClick={() => setCancelMode(true)} disabled={acting}>
                  취소
                </AdminButton>
              </div>
            )}

            {/* approved */}
            {settlement.status === 'approved' && !paidMode && !cancelMode && (() => {
              // Phase 3-1B — minimum_payout gate 안내.
              // 서버 (0399 admin_mark_paid_*) 가 실제 차단하지만 사용자 경험을 위해 UI 에서도 사전 차단.
              const min = settlement.minimum_payout ?? 0;
              const total = settlement.total_commission ?? 0;
              const belowMinimum = min > 0 && total < min;
              return (
                <>
                  {belowMinimum && (
                    <div className="rounded-md bg-amber-500/25 ring-1 ring-amber-400/50 p-2.5 text-[11px] text-slate-900 dark:text-amber-100 flex items-start gap-2">
                      <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-300" />
                      <div>
                        <div className="font-bold">최소정산금 미달</div>
                        <div className="mt-0.5 opacity-90">
                          이번 달 정산금이 최소정산금 ({min.toLocaleString('ko-KR')}원) 보다 낮아 지급완료 처리할 수 없습니다.
                          보류 처리 후 다음 정산으로 이월하거나 별도 정책을 적용하세요.
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <AdminButton tone="success" variant="subtle" size="lg" fullWidth
                      leftIcon={<BadgeCheck size={12} />}
                      onClick={() => setPaidMode(true)} disabled={acting || belowMinimum}>
                      지급완료 처리
                    </AdminButton>
                    <AdminButton tone="danger" variant="subtle" size="lg" fullWidth
                      leftIcon={<Ban size={12} />}
                      onClick={() => setCancelMode(true)} disabled={acting}>
                      보류
                    </AdminButton>
                  </div>
                </>
              );
            })()}

            {/* paid */}
            {settlement.status === 'paid' && (
              <p className="text-[11px] text-emerald-300 flex items-center gap-1.5">
                <CheckCircle2 size={12} />
                지급완료 — 회계 보존 정책에 따라 변경 불가 (immutable).
              </p>
            )}

            {/* cancelled */}
            {settlement.status === 'cancelled' && (
              <p className="text-[11px] text-rose-300 flex items-center gap-1.5">
                <XCircle size={12} />
                취소됨 — 동일 월 새 정산을 다시 생성할 수 있습니다.
              </p>
            )}

            {/* paid mode — input panel */}
            {paidMode && (
              <div className="space-y-2">
                <input
                  value={paymentRef}
                  onChange={(e) => setPaymentRef(e.target.value)}
                  placeholder="지급 참조 (이체번호/세금계산서 번호 등) *필수"
                  className="w-full rounded bg-bg px-2 py-2 text-xs font-mono"
                  autoFocus
                />
                <textarea
                  value={paidNote}
                  onChange={(e) => setPaidNote(e.target.value)}
                  placeholder="메모 (선택)"
                  className="w-full rounded bg-bg px-2 py-1.5 text-xs min-h-[44px]"
                />
                <div className="flex gap-2">
                  <AdminButton tone="neutral" variant="subtle" size="lg" className="flex-1"
                    onClick={() => { setPaidMode(false); setPaymentRef(''); setPaidNote(''); }}>
                    뒤로
                  </AdminButton>
                  <AdminButton tone="success" variant="solid" size="lg" className="flex-[2]"
                    loading={acting}
                    onClick={() => void onMarkPaid()}
                    disabled={acting || !paymentRef.trim()}>
                    지급완료 확정
                  </AdminButton>
                </div>
              </div>
            )}

            {/* cancel mode — input panel */}
            {cancelMode && (
              <div className="space-y-2">
                <textarea
                  value={cancelNote}
                  onChange={(e) => setCancelNote(e.target.value)}
                  placeholder="취소 사유 (필수)"
                  className="w-full rounded bg-bg px-2 py-2 text-xs min-h-[60px]"
                  autoFocus
                />
                <div className="flex gap-2">
                  <AdminButton tone="neutral" variant="subtle" size="lg" className="flex-1"
                    onClick={() => { setCancelMode(false); setCancelNote(''); }}>
                    뒤로
                  </AdminButton>
                  <AdminButton tone="danger" variant="solid" size="lg" className="flex-[2]"
                    loading={acting}
                    onClick={() => void onCancel()}
                    disabled={acting || !cancelNote.trim()}>
                    취소 확정
                  </AdminButton>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Small components
// =============================================================================

/**
 * 0390 — 적용 계약 Snapshot 검증 카드 (read-only).
 *
 * "이 정산이 어떤 계약/조건으로 계산됐는지" 를 한 화면에서 100% 확인.
 * 모든 값은 정산 생성 시점에 고정된 snapshot 이며, 이후 계약 수정과 무관하다.
 */
function ContractSnapshotCard({ settlement }: { settlement: EnterpriseMonthlySettlementDetail }) {
  const fromContract = settlement.rate_source === 'contract';
  const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('ko-KR') : '—');
  const period = settlement.contract_start_date || settlement.contract_end_date
    ? `${fmtDate(settlement.contract_start_date)} ~ ${settlement.contract_end_date ? fmtDate(settlement.contract_end_date) : '무기한'}`
    : '—';
  return (
    <div className="mt-3 rounded-lg border border-violet-400/30 bg-violet-500/5 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-[11px] font-bold text-slate-900 dark:text-violet-200">
          <ScrollText size={12} /> 적용 계약 Snapshot
        </p>
        <span className="inline-flex items-center gap-1 rounded-full bg-bg-deep px-2 py-0.5 text-[9px] text-ink-dim ring-1 ring-line/20">
          <Lock size={9} /> 생성 시점 고정 · 읽기 전용
        </span>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-[11px]">
        <div>
          <dt className="text-[10px] text-ink-dim">적용 출처</dt>
          <dd className="mt-0.5"><RateSourceBadge source={settlement.rate_source} contractNo={settlement.contract_no} /></dd>
        </div>
        <KV k="계약번호" v={settlement.contract_no ?? (fromContract ? '—' : '계약 없음')} mono />
        <KV k="계약 버전(개정)" v={settlement.contract_version ? new Date(settlement.contract_version).toLocaleString('ko-KR') : '—'} />
        <KV k="계약 기간" v={period} colSpan />
        <KV k="매장 단가" v={`${settlement.monthly_store_price.toLocaleString('ko-KR')}원`} />
        <KV k="수수료율" v={`${settlement.commission_rate}%`} />
        <KV k="최소 정산금" v={settlement.minimum_payout != null ? `${settlement.minimum_payout.toLocaleString('ko-KR')}원` : '—'} />
        <KV k="정산방법" v={settlement.settlement_method ?? '—'} />
        <KV k="생성 시각" v={new Date(settlement.generated_at).toLocaleString('ko-KR')} />
      </dl>
      <p className="mt-2 text-[10px] leading-relaxed text-ink-dim">
        총 정산금 {settlement.total_commission.toLocaleString('ko-KR')}원 =
        활성 매장 {settlement.active_store_count.toLocaleString('ko-KR')}개 ×
        (매장 단가 {settlement.monthly_store_price.toLocaleString('ko-KR')}원 ×
        수수료율 {settlement.commission_rate}% = 매장당 {settlement.per_store_commission.toLocaleString('ko-KR')}원).
        {fromContract
          ? ' 위 조건은 적용 당시 계약 snapshot 이며 이후 계약 수정과 무관하게 고정됩니다.'
          : ' 활성 계약이 없어 정산 프로필/기본값 기준으로 계산되었습니다.'}
      </p>
    </div>
  );
}

/** 0390 — 정산에 적용된 단가/수수료 출처 배지 (계약 적용 시 계약번호 tooltip). */
function RateSourceBadge({ source, contractNo }: {
  source: SettlementRateSource | null;
  contractNo: string | null;
}) {
  if (!source) return <span className="text-ink-dim">—</span>;
  const cls = source === 'contract'
    ? 'bg-violet-500/20 text-slate-900 dark:text-violet-200 ring-violet-400/40'
    : source === 'profile'
      ? 'bg-sky-500/20 text-slate-900 dark:text-sky-200 ring-sky-400/40'
      : 'bg-zinc-500/20 text-slate-500 dark:text-zinc-300 ring-zinc-400/40';
  return (
    <span
      title={contractNo ? `계약 ${contractNo}` : undefined}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${cls}`}
    >
      {SETTLEMENT_RATE_SOURCE_LABEL[source]}
    </span>
  );
}

function StatusBadge({ status }: { status: EnterpriseMonthlySettlementStatus }) {
  const ICON = {
    pending:   <ClockIcon size={10} />,
    approved:  <ThumbsUp size={10} />,
    paid:      <CheckCircle2 size={10} />,
    cancelled: <XCircle size={10} />,
  } as const;
  return (
    <AdminBadge tone={STATUS_TONE[status]} icon={ICON[status]}>
      {SETTLEMENT_STATUS_LABEL[status]}
    </AdminBadge>
  );
}

function ItemBadge({ status }: { status: 'included' | 'excluded' }) {
  return status === 'included'
    ? <AdminBadge tone="success" icon={<CheckCircle2 size={9} />}>포함</AdminBadge>
    : <AdminBadge tone="neutral" icon={<AlertTriangle size={9} />}>제외</AdminBadge>;
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
