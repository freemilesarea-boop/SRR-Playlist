import { useEffect, useState } from 'react';
import { Calculator, Eye, RefreshCw, Wallet, Pause, Check, X } from 'lucide-react';
import {
  adminListSettlements,
  adminGenerateMonthlySettlement,
  adminFinalizeSettlement,
  adminMarkSettlementPaid,
  adminMarkSettlementHeld,
  type AdminSettlementRow,
  type SettlementStatus,
  type GenerateSettlementResult,
} from '@/lib/artistSettlementApi';
import { toast } from '@/store/toastStore';
import Alert from '@/components/Alert';
import ArtistSettlementDetail from './ArtistSettlementDetail';

function fmtKrw(n: number | null | undefined): string {
  return `₩${(n ?? 0).toLocaleString()}`;
}
function fmtMonth(s: string): string {
  return s.slice(0, 7);
}
function fmtDate(s: string | null): string {
  return s ? new Date(s).toLocaleDateString('ko-KR') : '—';
}

const STATUS_TONE: Record<SettlementStatus, string> = {
  pending: 'bg-ink/10 text-ink-dim',
  carried_over: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200',
  payable: 'bg-sky-100 text-sky-900 dark:bg-sky-500/15 dark:text-sky-200',
  paid: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-300',
  held: 'bg-yellow-100 text-yellow-900 dark:bg-yellow-500/15 dark:text-yellow-200',
  disputed: 'bg-red-100 text-red-900 dark:bg-red-500/15 dark:text-red-300',
};

const STATUS_LABEL: Record<SettlementStatus, string> = {
  pending: '대기 (미확정)',
  carried_over: '이월',
  payable: '지급 대상',
  paid: '지급 완료',
  held: '보류',
  disputed: '분쟁',
};

function defaultMonth(): string {
  // 직전월 1일 (KST). 운영자가 이번 달 정산을 익월에 생성하는 패턴.
  const now = new Date();
  // KST 기준 직전월 = 이번 달 - 1
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-indexed, 직전월 사용
  const prev = new Date(Date.UTC(y, m - 1, 1));
  return prev.toISOString().slice(0, 10);
}

export default function ArtistSettlementsList() {
  const [rows, setRows] = useState<AdminSettlementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [month, setMonth] = useState<string>('');
  const [status, setStatus] = useState<SettlementStatus | ''>('');
  const [search, setSearch] = useState('');
  const [genModalOpen, setGenModalOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await adminListSettlements({
        month: month || null,
        status: status || undefined,
        search: search || undefined,
      });
      setRows(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, status]);

  useEffect(() => {
    const t = window.setTimeout(load, 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-lg font-bold tracking-tight">
            <Wallet size={16} className="text-accent" /> 아티스트 정산
          </h2>
          <p className="text-xs text-ink-mute">
            {rows.length}건 · paid 상태는 영구 immutable · finalize 후 계산값 변경 불가
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
            onClick={() => setGenModalOpen(true)}
            className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-black hover:bg-accent/90"
          >
            <Calculator size={12} /> 월별 정산 생성
          </button>
        </div>
      </div>

      {error && <Alert tone="error" title="조회 실패">{error}</Alert>}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="month"
          value={month ? month.slice(0, 7) : ''}
          onChange={(e) => setMonth(e.target.value ? `${e.target.value}-01` : '')}
          className="input w-auto text-sm"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as SettlementStatus | '')}
          className="input w-auto text-sm"
        >
          <option value="">전체 상태</option>
          <option value="pending">대기</option>
          <option value="payable">지급 대상</option>
          <option value="carried_over">이월</option>
          <option value="paid">지급 완료</option>
          <option value="held">보류</option>
          <option value="disputed">분쟁</option>
        </select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="아티스트 닉네임/이메일 검색"
          className="input flex-1 min-w-[200px] text-sm"
        />
      </div>

      <div className="overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1400px] text-sm">
            <thead>
              <tr className="border-b border-line/10 text-[11px] uppercase text-ink-dim [&_th]:whitespace-nowrap">
                <th className="px-3 py-2.5 text-left font-semibold">월</th>
                <th className="px-3 py-2.5 text-left font-semibold">아티스트</th>
                <th className="px-3 py-2.5 text-right font-semibold">gross</th>
                <th className="px-3 py-2.5 text-right font-semibold">회사 수수료</th>
                <th className="px-3 py-2.5 text-right font-semibold">영업인 수수료</th>
                <th className="px-3 py-2.5 text-right font-semibold">이월금</th>
                <th className="px-3 py-2.5 text-right font-semibold">총 정산</th>
                <th className="px-3 py-2.5 text-right font-semibold">원천징수</th>
                <th className="px-3 py-2.5 text-right font-semibold">최종 지급</th>
                <th className="px-3 py-2.5 text-left font-semibold">상태</th>
                <th className="px-3 py-2.5 text-right font-semibold">지급일</th>
                <th className="w-px px-3 py-2.5 text-right font-semibold">액션</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={12} className="px-3 py-8 text-center text-xs text-ink-mute">
                    불러오는 중…
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && !error && (
                <tr>
                  <td colSpan={12} className="px-3 py-8 text-center text-xs text-ink-mute">
                    정산 데이터가 없어요. "월별 정산 생성" 으로 시작하세요.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line/10 hover:bg-bg-hover">
                  <td className="px-3 py-2.5 font-mono text-xs">{fmtMonth(r.settlement_month)}</td>
                  <td className="px-3 py-2.5">
                    <p className="font-medium">{r.artist_nickname || '—'}</p>
                    <p className="text-xs text-ink-mute">{r.artist_email || '—'}</p>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtKrw(r.gross_settlement_amount)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink-mute">−{fmtKrw(r.company_fee_amount)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink-mute">−{fmtKrw(r.sales_agent_fee_amount)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {r.previous_carried_amount > 0 ? `+${fmtKrw(r.previous_carried_amount)}` : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-bold">{fmtKrw(r.total_settlement_amount)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink-mute">
                    {r.withholding_tax_amount > 0 ? `−${fmtKrw(r.withholding_tax_amount)}` : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-bold text-accent">
                    {fmtKrw(r.final_payout_amount)}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_TONE[r.status]}`}>
                      {STATUS_LABEL[r.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right text-xs text-ink-mute">{fmtDate(r.paid_at)}</td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      onClick={() => setDetailId(r.id)}
                      className="rounded p-1.5 hover:bg-ink/5"
                      title="상세"
                    >
                      <Eye size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {genModalOpen && (
        <GenerateModal
          defaultMonth={defaultMonth()}
          onClose={() => setGenModalOpen(false)}
          onApplied={() => {
            setGenModalOpen(false);
            void load();
          }}
        />
      )}

      {detailId && (
        <ArtistSettlementDetail
          settlementId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={() => void load()}
        />
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
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function runReal() {
    if (!dryResult) return;
    if (
      !window.confirm(
        `${monthInput} 정산서를 실제 생성합니다.\n생성: ${dryResult.generated}건, 덮어쓰기: ${dryResult.overwritten}건, 스킵: ${dryResult.skipped}건.\n계속할까요?`,
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
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
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
          반드시 <strong>dry-run</strong> 으로 먼저 검토하세요. 실제 생성은 status='pending' 만
          덮어쓰며 payable/paid/carried_over/held/disputed 는 절대 수정하지 않습니다.
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
              <Kv label="덮어쓰기 (pending)" value={`${dryResult.overwritten}건`} />
              <Kv label="스킵 (finalized)" value={`${dryResult.skipped}건`} tone={dryResult.skipped > 0 ? 'text-yellow-700 dark:text-yellow-300' : ''} />
              <Kv label="지급 대상" value={`${dryResult.payable}건`} />
              <Kv label="이월 (5만원 미만)" value={`${dryResult.carried_over}건`} />
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

export { type AdminSettlementRow, type SettlementStatus };
