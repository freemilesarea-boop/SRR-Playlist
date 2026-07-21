import { useCallback, useEffect, useRef, useState } from 'react';
import { Calculator, RefreshCw, Wallet, ArrowRightCircle, X, Download } from 'lucide-react';
import { useModalA11y } from '@/hooks/useModalA11y';
import {
  adminListSettlements,
  adminGenerateMonthlySettlement,
  type AdminSettlementRow,
  type SettlementStatus,
  type GenerateSettlementResult,
} from '@/lib/artistSettlementApi';
import { toast } from '@/store/toastStore';
import Alert from '@/components/Alert';
import { friendlyError } from '@/lib/errorMessages';
import ArtistSettlementDetail from './ArtistSettlementDetail';
import CarryoverModal from './CarryoverModal';
import {
  summarizeSettlements, settlementRowsToCsv, buildSettlementDisplayModel, applySettlementFilters,
  SETTLEMENT_FACET_LABELS, type SettlementSummary, type SettlementFacet,
} from '@/lib/settlementDisplayModel';
import { StatusBadge, RequiredActionBadge } from './settlement/SettlementParts';

function fmtKrw(n: number | null | undefined): string {
  return `₩${(n ?? 0).toLocaleString()}`;
}
function fmtMonth(s: string): string {
  return s.slice(0, 7);
}

// X6.27: held 도 수동 이월 가능 (paid / carried_over / disputed 만 차단).
function carryoverEligible(r: AdminSettlementRow): boolean {
  return (r.status === 'pending' || r.status === 'payable' || r.status === 'held')
    && r.merged_into_settlement_id == null;
}

function defaultMonth(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const prev = new Date(Date.UTC(y, m - 1, 1));
  return prev.toISOString().slice(0, 10);
}

export default function ArtistSettlementsList() {
  const [rows, setRows] = useState<AdminSettlementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [month, setMonth] = useState<string>('');
  const [facet, setFacet] = useState<SettlementFacet>('all');
  const [search, setSearch] = useState('');
  const [genModalOpen, setGenModalOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [carryoverRow, setCarryoverRow] = useState<AdminSettlementRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 월만 서버 필터. 상태/필요조치/이월 facet + 검색은 클라이언트에서 모델 기반으로 적용
      // → 목록·Summary·CSV 가 항상 동일한 filteredRows 를 공유한다.
      setRows(await adminListSettlements({ month: month || null }));
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { void load(); }, [load]);

  const filteredRows = applySettlementFilters(rows, facet, search);
  const resetFilters = () => { setFacet('all'); setSearch(''); };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-lg font-bold tracking-tight">
            <Wallet size={16} className="text-accent" /> 아티스트 정산
          </h2>
          <p className="text-xs text-ink-mute">
            {filteredRows.length}건{filteredRows.length !== rows.length ? ` / 전체 ${rows.length}건` : ''} · paid 상태는 영구 immutable
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-1 rounded-lg bg-bg-card px-3 py-2 text-xs font-semibold ring-1 ring-line/10 hover:bg-bg-hover"
          >
            <RefreshCw size={12} /> 새로고침
          </button>
          <button
            onClick={() => downloadSettlementsCsv(filteredRows, month)}
            disabled={filteredRows.length === 0}
            className="inline-flex items-center gap-1 rounded-lg bg-bg-card px-3 py-2 text-xs font-semibold ring-1 ring-line/10 hover:bg-bg-hover disabled:opacity-40"
            title="현재 필터된 정산을 CSV로 내보내기 (화면 합계와 일치)"
          >
            <Download size={12} /> CSV
          </button>
          <button
            onClick={() => setGenModalOpen(true)}
            className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-black hover:bg-accent/90"
          >
            <Calculator size={12} /> 월별 정산 생성
          </button>
        </div>
      </div>

      {error && (
        <Alert tone="error" title="조회 실패">
          정산 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
          <div className="mt-2">
            <button
              onClick={() => void load()}
              className="inline-flex items-center gap-1 rounded-lg bg-bg-card px-3 py-1.5 text-xs font-semibold ring-1 ring-line/10 hover:bg-bg-hover"
            >
              <RefreshCw size={12} /> 다시 시도
            </button>
          </div>
        </Alert>
      )}

      {!loading && !error && filteredRows.length > 0 && <SettlementSummaryCards rows={filteredRows} />}

      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="settlement-month">정산월</label>
        <input
          id="settlement-month" type="month"
          value={month ? month.slice(0, 7) : ''}
          onChange={(e) => setMonth(e.target.value ? `${e.target.value}-01` : '')}
          className="input w-auto text-sm"
        />
        <label className="sr-only" htmlFor="settlement-facet">상태 필터</label>
        <select
          id="settlement-facet" value={facet}
          onChange={(e) => setFacet(e.target.value as SettlementFacet)}
          className="input w-auto text-sm"
        >
          {(Object.keys(SETTLEMENT_FACET_LABELS) as SettlementFacet[]).map((f) => (
            <option key={f} value={f}>{SETTLEMENT_FACET_LABELS[f]}</option>
          ))}
        </select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="회원명 · 아티스트명 · 이메일 · 사용자 ID 검색"
          aria-label="정산 검색"
          className="input flex-1 min-w-[220px] text-sm"
        />
      </div>

      {loading ? (
        <SettlementListSkeleton />
      ) : error ? null : filteredRows.length === 0 ? (
        <SettlementEmpty onReset={resetFilters} hasAnyRows={rows.length > 0} />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10 md:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1200px] text-sm">
                <thead>
                  <tr className="border-b border-line/10 text-[11px] uppercase text-ink-dim [&_th]:whitespace-nowrap">
                    <th className="px-3 py-2.5 text-left font-semibold">회원/아티스트</th>
                    <th className="px-3 py-2.5 text-left font-semibold">정산월</th>
                    <th className="px-3 py-2.5 text-right font-semibold">당월 순정산</th>
                    <th className="px-3 py-2.5 text-right font-semibold">이전 이월</th>
                    <th className="px-3 py-2.5 text-right font-semibold">원천징수</th>
                    <th className="px-3 py-2.5 text-right font-semibold">현재 지급 가능</th>
                    <th className="px-3 py-2.5 text-right font-semibold">지급 완료</th>
                    <th className="px-3 py-2.5 text-right font-semibold">다음 달 이월</th>
                    <th className="px-3 py-2.5 text-left font-semibold">상태</th>
                    <th className="px-3 py-2.5 text-left font-semibold">필요 조치</th>
                    <th className="w-px px-3 py-2.5 text-right font-semibold">상세</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((r) => (
                    <SettlementDesktopRow
                      key={r.id} row={r}
                      onOpen={() => setDetailId(r.id)}
                      onCarryover={() => setCarryoverRow(r)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {filteredRows.map((r) => (
              <SettlementMobileCard
                key={r.id} row={r}
                onOpen={() => setDetailId(r.id)}
                onCarryover={() => setCarryoverRow(r)}
              />
            ))}
          </div>
        </>
      )}

      {genModalOpen && (
        <GenerateModal
          defaultMonth={defaultMonth()}
          onClose={() => setGenModalOpen(false)}
          onApplied={() => { setGenModalOpen(false); void load(); }}
        />
      )}

      {detailId && (
        <ArtistSettlementDetail
          settlementId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={() => void load()}
        />
      )}

      {carryoverRow && (
        <CarryoverModal
          row={carryoverRow}
          onClose={() => setCarryoverRow(null)}
          onApplied={() => { setCarryoverRow(null); void load(); }}
        />
      )}
    </div>
  );
}

// ── 이월 Cell (미과세/기과세; 둘 다 0 → 없음) ──
function CarryoverCell({ untaxed, taxed }: { untaxed: number; taxed: number }) {
  if (untaxed === 0 && taxed === 0) return <span className="text-ink-dim">없음</span>;
  return (
    <div className="text-xs leading-tight">
      {untaxed > 0 && <p className="tabular-nums">미과세 {fmtKrw(untaxed)}</p>}
      {taxed > 0 && <p className="tabular-nums text-ink-mute">기과세 {fmtKrw(taxed)}</p>}
    </div>
  );
}

function DetailButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="rounded-lg bg-bg-soft px-2 py-1 text-[11px] font-semibold ring-1 ring-line/10 hover:bg-bg-hover"
    >
      상세 보기
    </button>
  );
}

function SettlementDesktopRow({ row, onOpen, onCarryover }: {
  row: AdminSettlementRow; onOpen: () => void; onCarryover: () => void;
}) {
  const m = buildSettlementDisplayModel(row);
  return (
    <tr className="border-b border-line/10 align-top hover:bg-bg-hover">
      <td className="px-3 py-2.5">
        <p className="font-medium">{row.artist_nickname || '—'}</p>
        <p className="text-xs text-ink-mute">{row.artist_email || '—'}</p>
      </td>
      <td className="px-3 py-2.5 font-mono text-xs">{fmtMonth(row.settlement_month)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{fmtKrw(m.currentNetAmount)}</td>
      <td className="px-3 py-2.5 text-right">
        <CarryoverCell untaxed={m.previousUntaxedCarryoverAmount} taxed={m.previousTaxedCarryoverAmount} />
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-ink-mute">
        {m.withholdingTaxAmount > 0 ? `−${fmtKrw(m.withholdingTaxAmount)}` : '—'}
      </td>
      <td className="px-3 py-2.5 text-right">
        <p className={`tabular-nums font-bold ${m.effectivePayableAmount > 0 ? 'text-accent' : 'text-ink-dim'}`}>
          {fmtKrw(m.effectivePayableAmount)}
        </p>
        {m.isManualCarryover && m.historicalCalculatedPayoutAmount > 0 && (
          <p className="text-[10px] text-ink-dim">과거 계산액 {fmtKrw(m.historicalCalculatedPayoutAmount)}</p>
        )}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-emerald-600 dark:text-emerald-300">
        {m.effectivePaidAmount > 0 ? fmtKrw(m.effectivePaidAmount) : '—'}
      </td>
      <td className="px-3 py-2.5 text-right">
        <CarryoverCell untaxed={m.nextUntaxedCarryoverAmount} taxed={m.nextTaxedCarryoverAmount} />
      </td>
      <td className="px-3 py-2.5"><StatusBadge model={m} /></td>
      <td className="px-3 py-2.5"><RequiredActionBadge model={m} /></td>
      <td className="px-3 py-2.5 text-right">
        <div className="inline-flex items-center gap-1">
          <DetailButton onOpen={onOpen} />
          {carryoverEligible(row) && (
            <button
              onClick={onCarryover}
              className="rounded p-1.5 text-amber-600 hover:bg-amber-500/20 dark:text-amber-300"
              aria-label="이월 신청"
              title="이월 신청 — 다음 달로 넘기기"
            >
              <ArrowRightCircle size={14} />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

function SettlementMobileCard({ row, onOpen, onCarryover }: {
  row: AdminSettlementRow; onOpen: () => void; onCarryover: () => void;
}) {
  const m = buildSettlementDisplayModel(row);
  return (
    <div className="rounded-2xl bg-bg-card p-3 ring-1 ring-line/10">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">{row.artist_nickname || '—'}</p>
          <p className="text-xs text-ink-mute">{fmtMonth(row.settlement_month)} · {row.artist_email || '—'}</p>
        </div>
        <StatusBadge model={m} />
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <div><p className="text-[10px] text-ink-dim">현재 지급 가능</p><p className="tabular-nums text-sm font-bold text-accent">{fmtKrw(m.effectivePayableAmount)}</p></div>
        <div><p className="text-[10px] text-ink-dim">지급 완료</p><p className="tabular-nums text-sm text-emerald-600 dark:text-emerald-300">{fmtKrw(m.effectivePaidAmount)}</p></div>
        <div><p className="text-[10px] text-ink-dim">다음 달 이월</p><p className="tabular-nums text-sm text-amber-600 dark:text-amber-300">{fmtKrw(m.effectiveNextCarryoverAmount)}</p></div>
      </div>
      {m.isManualCarryover && m.historicalCalculatedPayoutAmount > 0 && (
        <p className="mt-1 text-[10px] text-ink-dim">과거 계산액 {fmtKrw(m.historicalCalculatedPayoutAmount)}</p>
      )}
      <div className="mt-2 flex items-center justify-between gap-2">
        <RequiredActionBadge model={m} />
        <div className="flex items-center gap-1">
          {carryoverEligible(row) && (
            <button
              onClick={onCarryover}
              className="rounded-lg p-2 text-amber-600 ring-1 ring-line/10 dark:text-amber-300"
              aria-label="이월 신청"
            >
              <ArrowRightCircle size={14} />
            </button>
          )}
          <DetailButton onOpen={onOpen} />
        </div>
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-[10px] text-ink-dim">금액 상세</summary>
        <div className="mt-1 space-y-0.5 text-[11px] text-ink-mute">
          <p>당월 순정산 {fmtKrw(m.currentNetAmount)}</p>
          <p>이전 이월 · 미과세 {fmtKrw(m.previousUntaxedCarryoverAmount)} / 기과세 {fmtKrw(m.previousTaxedCarryoverAmount)}</p>
          <p>원천징수 {fmtKrw(m.withholdingTaxAmount)}</p>
          <p>다음 이월 · 미과세 {fmtKrw(m.nextUntaxedCarryoverAmount)} / 기과세 {fmtKrw(m.nextTaxedCarryoverAmount)}</p>
        </div>
      </details>
    </div>
  );
}

function SettlementListSkeleton() {
  return (
    <div aria-label="정산 목록을 불러오는 중" aria-busy="true" className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-14 animate-pulse rounded-xl bg-bg-card ring-1 ring-line/10" />
        ))}
      </div>
      <div className="hidden space-y-2 md:block">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded-xl bg-bg-card ring-1 ring-line/10" />
        ))}
      </div>
      <div className="space-y-2 md:hidden">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-2xl bg-bg-card ring-1 ring-line/10" />
        ))}
      </div>
    </div>
  );
}

function SettlementEmpty({ onReset, hasAnyRows }: { onReset: () => void; hasAnyRows: boolean }) {
  return (
    <div className="rounded-2xl bg-bg-card px-4 py-10 text-center ring-1 ring-line/10">
      <p className="text-sm text-ink-mute">
        {hasAnyRows
          ? '선택한 조건에 해당하는 정산 내역이 없습니다.'
          : '정산 데이터가 없어요. "월별 정산 생성" 으로 시작하세요.'}
      </p>
      {hasAnyRows && (
        <button
          onClick={onReset}
          className="mt-3 inline-flex items-center gap-1 rounded-lg bg-bg-soft px-3 py-1.5 text-xs font-semibold ring-1 ring-line/10 hover:bg-bg-hover"
        >
          필터 초기화
        </button>
      )}
    </div>
  );
}

function GenerateModal({
  defaultMonth: dm,
  onClose,
  onApplied,
}: {
  defaultMonth: string;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [monthInput, setMonthInput] = useState<string>(dm.slice(0, 7));
  const [busy, setBusy] = useState(false);
  const [dryResult, setDryResult] = useState<GenerateSettlementResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runDry() {
    setError(null);
    setBusy(true);
    try {
      const r = await adminGenerateMonthlySettlement(`${monthInput}-01`, true);
      setDryResult(r);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function runReal() {
    if (!dryResult) return;
    if (
      !window.confirm(
        `${monthInput} 정산서를 실제 생성합니다.\n신규: ${dryResult.generated}건, 재생성(version+1): ${dryResult.overwritten}건, 스킵(FINALIZED/PAID): ${dryResult.skipped}건.\n기존 정산은 삭제되지 않고 이전 version 으로 보존됩니다. 계속할까요?`,
      )
    )
      return;
    setError(null);
    setBusy(true);
    try {
      await adminGenerateMonthlySettlement(`${monthInput}-01`, false);
      toast.success('정산서가 생성됐어요. 상세 확인 후 finalize 진행하세요.');
      onApplied();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  const dialogRef = useRef<HTMLDivElement>(null);
  useModalA11y(dialogRef, { onClose });

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl space-y-4 rounded-t-3xl bg-bg-soft p-5 ring-1 ring-line/15 sm:rounded-3xl"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold">월별 정산서 생성</h3>
          <button onClick={onClose} className="rounded-full p-1.5 hover:bg-ink/5">
            <X size={16} />
          </button>
        </div>

        <Alert tone="warning">
          반드시 <strong>dry-run</strong> 으로 먼저 검토하세요.{' '}
          <strong>PENDING 상태 정산은 재생성 시 최신 데이터로 덮어쓰기 됩니다.
          FINALIZED/PAID 상태만 잠금됩니다.</strong>{' '}
          기존 정산은 삭제되지 않고 version 으로 보존되며, 최신 version 만 활성화됩니다.
        </Alert>

        <label className="block space-y-1">
          <span className="text-xs font-semibold text-ink-mute">정산 월 (KST 기준)</span>
          <input
            type="month"
            value={monthInput}
            onChange={(e) => setMonthInput(e.target.value)}
            className="input"
          />
        </label>

        <div className="flex gap-2">
          <button
            onClick={runDry}
            disabled={busy}
            className="flex-1 rounded-xl bg-bg-card py-2.5 text-sm font-semibold ring-1 ring-line/10 hover:bg-bg-hover disabled:opacity-50"
          >
            {busy && !dryResult ? '계산 중…' : 'Dry-run (계산만)'}
          </button>
          <button
            onClick={runReal}
            disabled={busy || !dryResult}
            className="flex-1 btn-primary py-2.5 text-sm"
          >
            {busy && dryResult ? '생성 중…' : '실제 생성'}
          </button>
        </div>

        {error && <Alert tone="error">{error}</Alert>}

        {dryResult && (
          <div className="space-y-2 rounded-xl bg-bg-card p-3 ring-1 ring-line/10">
            <p className="text-xs font-bold text-ink">
              Dry-run 결과 — {dryResult.dry_run ? '계산만 함 (DB 변경 없음)' : '생성됨'}
            </p>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <Kv label="플랫폼 매출" value={fmtKrw(dryResult.platform_revenue)} />
              <Kv
                label={`분배 풀${dryResult.platform_revenue > 0 ? ` (${Math.round((dryResult.pool_revenue / dryResult.platform_revenue) * 100)}%)` : ''}`}
                value={fmtKrw(dryResult.pool_revenue)}
              />
              <Kv label="총 유효 스트림" value={dryResult.total_pool_streams.toLocaleString() + '건'} />
              <Kv label="신규 생성" value={`${dryResult.generated}건`} />
              <Kv label="재생성 (version+1)" value={`${dryResult.overwritten}건`} />
              <Kv label="스킵 (FINALIZED/PAID)" value={`${dryResult.skipped}건`} tone={dryResult.skipped > 0 ? 'text-yellow-700 dark:text-yellow-300' : ''} />
              <Kv label="지급 대상" value={`${dryResult.payable}건`} />
              <Kv
                label={
                  dryResult.min_payout_amount != null
                    ? `이월 (최소 ${fmtKrw(dryResult.min_payout_amount)} 미만)`
                    : '이월 (최소 지급 기준 미달)'
                }
                value={`${dryResult.carried_over}건`}
              />
              <Kv label="총 최종 지급액" value={fmtKrw(dryResult.total_final_payout)} tone="text-accent font-bold" />
            </div>
            {dryResult.skipped_artists.length > 0 && (
              <Alert tone="warning">
                <strong>{dryResult.skipped_artists.length}건 스킵됨</strong> — finalized/paid
                상태는 재계산 불가. 보정이 필요하면 adjustment row 로 별도 생성하세요.
              </Alert>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Kv({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-md bg-bg-soft px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-wider text-ink-dim">{label}</p>
      <p className={`mt-0.5 font-mono text-xs ${tone ?? ''}`}>{value}</p>
    </div>
  );
}

/** 현재 필터된 rows 를 SettlementDisplayModel 기반 CSV 로 내보낸다 (화면 합계와 일치). */
function downloadSettlementsCsv(rows: AdminSettlementRow[], month: string): void {
  const csv = settlementRowsToCsv(rows);
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `settlements_${month ? month.slice(0, 7) : 'all'}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Status-aware 요약 카드 — 지급/이월 금액을 중복 없이 집계 (summarizeSettlements). */
function SettlementSummaryCards({ rows }: { rows: AdminSettlementRow[] }) {
  const s: SettlementSummary = summarizeSettlements(rows);
  const cards: Array<{ label: string; value: string; tone?: string }> = [
    { label: '정산 대상', value: `${s.count}명` },
    { label: '당월 순정산', value: fmtKrw(s.totalCurrentNet) },
    { label: '이전 이월', value: fmtKrw(s.totalPreviousCarryover) },
    { label: '원천징수', value: fmtKrw(s.totalWithholding) },
    { label: '현재 지급 가능', value: fmtKrw(s.totalEffectivePayable), tone: 'text-accent font-bold' },
    { label: '지급 완료', value: fmtKrw(s.totalPaid), tone: 'text-emerald-600 dark:text-emerald-300' },
    { label: '다음 달 이월', value: fmtKrw(s.totalNextCarryover), tone: 'text-amber-600 dark:text-amber-300' },
    { label: '지급 보류', value: `${s.heldCount}명` },
    { label: '정산정보 미완료', value: `${s.identityIncompleteCount}명` },
    { label: '계좌 확인 필요', value: `${s.accountIncompleteCount}명` },
    { label: '세율 확인 필요', value: `${s.taxReviewCount}명` },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {cards.map((c) => (
        <div key={c.label} className="rounded-xl bg-bg-card px-3 py-2.5 ring-1 ring-line/10">
          <p className="text-[10px] uppercase tracking-wider text-ink-dim">{c.label}</p>
          <p className={`mt-0.5 tabular-nums text-sm ${c.tone ?? 'text-ink'}`}>{c.value}</p>
        </div>
      ))}
    </div>
  );
}

export { type AdminSettlementRow, type SettlementStatus };
