/**
 * ConsolidatedBillingCard — 본사 '일괄청구' 설정 + 실시간 청구예정액.
 *
 * 브랜드(본사)를 '일괄청구' 대상으로 체크하면, 그 브랜드코드로 신규 가맹점이 가입할 때마다
 * 활성 매장 수가 자동 증가 → 청구예정액(활성매장 × 매장단가)이 실시간으로 올라간다.
 * 매월 1일 크론이 대상 본사의 청구서(draft)를 자동 생성한다(발행/수금은 관리자 수동).
 *
 * SQL: supabase/migrations/0479_enterprise_consolidated_billing.sql
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, RefreshCw, TrendingUp, Store, Check } from 'lucide-react';
import { AdminBadge, AdminButton } from '@/components/admin/ui';
import {
  getConsolidatedBillingPreview, setEnterpriseConsolidatedBilling, setEnterpriseBrandCode,
  type ConsolidatedBillingPreviewRow,
} from '@/lib/api/enterpriseBillingApi';

const fmtKRW = (n: number) => `${n.toLocaleString('ko-KR')}원`;

export default function ConsolidatedBillingCard() {
  const [rows, setRows] = useState<ConsolidatedBillingPreviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [codeDraft, setCodeDraft] = useState<Record<string, string>>({});
  const [savingCode, setSavingCode] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      setRows(await getConsolidatedBillingPreview());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onToggle = useCallback(async (row: ConsolidatedBillingPreviewRow) => {
    setBusyId(row.enterprise_account_id);
    // 낙관적 업데이트
    setRows((prev) => prev.map((r) =>
      r.enterprise_account_id === row.enterprise_account_id
        ? { ...r, consolidated_billing_enabled: !r.consolidated_billing_enabled }
        : r));
    try {
      await setEnterpriseConsolidatedBilling(row.enterprise_account_id, !row.consolidated_billing_enabled);
      await load(true);
    } catch (e) {
      // 실패 시 롤백
      setRows((prev) => prev.map((r) =>
        r.enterprise_account_id === row.enterprise_account_id
          ? { ...r, consolidated_billing_enabled: row.consolidated_billing_enabled }
          : r));
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }, [load]);

  const saveCode = useCallback(async (row: ConsolidatedBillingPreviewRow) => {
    const draft = (codeDraft[row.enterprise_account_id] ?? row.brand_code ?? '').trim();
    if (draft === (row.brand_code ?? '')) return; // 변경 없음
    setSavingCode(row.enterprise_account_id);
    setError(null);
    try {
      await setEnterpriseBrandCode(row.enterprise_account_id, draft || null);
      setCodeDraft((prev) => {
        const nxt = { ...prev };
        delete nxt[row.enterprise_account_id];
        return nxt;
      });
      await load(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingCode(null);
    }
  }, [codeDraft, load]);

  const { enabledCount, projectedTotal, month } = useMemo(() => {
    const enabled = rows.filter((r) => r.consolidated_billing_enabled);
    return {
      enabledCount: enabled.length,
      projectedTotal: enabled.reduce((s, r) => s + (r.projected_amount || 0), 0),
      month: rows[0]?.current_month ?? null,
    };
  }, [rows]);

  return (
    <div className="overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <Building2 size={15} className="text-accent" />
          <h3 className="text-sm font-bold">일괄청구 설정 · 실시간 청구예정액</h3>
          <AdminBadge tone="primary" variant="subtle">본사 단위</AdminBadge>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="font-mono text-base font-bold tabular-nums text-accent">
              {fmtKRW(projectedTotal)}
            </div>
            <div className="text-[10px] text-ink-mute">
              {month ? `${new Date(month).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit' })} · ` : ''}
              일괄청구 {enabledCount}개 본사 합산(예정)
            </div>
          </div>
          <AdminButton tone="neutral" variant="subtle" size="sm"
            leftIcon={<RefreshCw size={12} className={loading ? 'animate-spin' : ''} />}
            onClick={() => void load()} disabled={loading}>새로고침</AdminButton>
        </div>
      </header>

      <p className="border-b border-line/10 px-4 py-2 text-[11px] leading-relaxed text-ink-mute">
        브랜드를 <b className="text-ink-soft">일괄청구 ON</b> 으로 체크하면, 그 브랜드로 신규 가맹점이
        가입할 때마다 활성 매장이 자동 인식되어 청구예정액이 실시간으로 올라갑니다.
        매월 1일 대상 본사의 청구서(초안)가 자동 생성됩니다(발행·수금은 수동).
        <br />
        <b className="text-ink-soft">진입 코드</b>는 가맹점주가 매장 플레이어 진입·가입 시 입력하는 코드입니다.
        REFINE·카공시대처럼 외우기 쉽게 설정하면 됩니다(대소문자 무시, 기존 STORE-코드도 계속 유효).
      </p>

      {error && (
        <p className="px-4 py-2 text-xs text-danger">{error}</p>
      )}

      <div className="overflow-x-auto">
        {loading && rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-ink-mute">불러오는 중…</p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-ink-mute">활성 본사가 없습니다.</p>
        ) : (
          <table className="w-full min-w-[640px] text-xs">
            <thead>
              <tr className="border-b border-line/10 text-left text-[10px] uppercase tracking-wide text-ink-mute">
                <th className="px-4 py-2 font-semibold">본사 / 브랜드</th>
                <th className="px-2 py-2 text-right font-semibold">활성 매장</th>
                <th className="px-2 py-2 text-right font-semibold">매장 단가</th>
                <th className="px-2 py-2 text-right font-semibold">청구예정액</th>
                <th className="px-2 py-2 text-center font-semibold">이번달 청구서</th>
                <th className="px-4 py-2 text-center font-semibold">일괄청구</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const on = r.consolidated_billing_enabled;
                return (
                  <tr key={r.enterprise_account_id} className="border-b border-line/5 last:border-0">
                    <td className="px-4 py-2.5">
                      <div className="font-semibold text-ink">{r.enterprise_name || '—'}</div>
                      <div className="mt-1 flex items-center gap-1">
                        <span className="text-[9px] uppercase tracking-wide text-ink-mute">진입코드</span>
                        <input
                          value={codeDraft[r.enterprise_account_id] ?? r.brand_code ?? ''}
                          onChange={(e) => setCodeDraft((p) => ({ ...p, [r.enterprise_account_id]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') void saveCode(r); }}
                          placeholder="예: REFINE / 카공시대"
                          className="w-32 rounded-md bg-bg-deep px-2 py-0.5 font-mono text-[11px] text-ink outline-none ring-line/20 focus:ring-1"
                        />
                        {(codeDraft[r.enterprise_account_id] ?? r.brand_code ?? '').trim() !== (r.brand_code ?? '') && (
                          <button
                            type="button"
                            onClick={() => void saveCode(r)}
                            disabled={savingCode === r.enterprise_account_id}
                            title="진입 코드 저장"
                            className="inline-flex items-center rounded-md bg-accent/15 px-1.5 py-0.5 text-accent ring-1 ring-accent/30 hover:bg-accent/25 disabled:opacity-50"
                          >
                            <Check size={12} />
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      <span className="inline-flex items-center gap-1 tabular-nums text-ink-soft">
                        <Store size={11} className="text-ink-mute" />{r.active_store_count}
                      </span>
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-ink-mute">{fmtKRW(r.monthly_store_price)}</td>
                    <td className="px-2 py-2.5 text-right">
                      <span className={`inline-flex items-center gap-1 font-mono font-bold tabular-nums ${on ? 'text-accent' : 'text-ink-mute'}`}>
                        {on && <TrendingUp size={11} />}{fmtKRW(r.projected_amount)}
                      </span>
                    </td>
                    <td className="px-2 py-2.5 text-center">
                      {r.current_invoice_id
                        ? <AdminBadge tone="info" variant="subtle">{r.current_invoice_status}</AdminBadge>
                        : <span className="text-[10px] text-ink-mute">미생성</span>}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={on}
                        disabled={busyId === r.enterprise_account_id}
                        onClick={() => void onToggle(r)}
                        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                          on ? 'bg-accent' : 'bg-ink/20'
                        }`}
                        title={on ? '일괄청구 ON — 클릭하면 OFF' : '일괄청구 OFF — 클릭하면 ON'}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
