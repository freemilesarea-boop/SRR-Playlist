/**
 * PayoutAccountChangesList — 정산 계좌 변경 신청 승인 큐 (0495)
 *
 * 왜 별도 뷰인가:
 *   '계좌 목록' 의 pending 에는 신규 등록과 변경 신청이 섞여 있다. 둘은 위험도가
 *   전혀 다르다 — 신규는 아직 돈이 나간 적 없는 계좌지만, 변경은 이미 승인돼서
 *   정산이 잡혀 있을 수 있는 계좌가 바뀐 것이다. 계정이 털린 뒤 계좌만 바꿔두고
 *   기다리면 다음 정산이 그쪽으로 나가는 경로이기도 하다.
 *   그래서 "무엇이 → 무엇으로 바뀌었는지" 와 "지금 지급 대기 금액이 얼마인지" 를
 *   나란히 놓고 판단하도록 화면을 따로 둔다.
 *
 * 승인/거절은 새로 만들지 않고 기존 verify/reject_artist_payout_account 를 쓴다.
 * 그 두 함수가 0495 에서 열린 신청까지 함께 종결하도록 확장됐다 — 관리자 동선 무변경.
 */
import { useCallback, useMemo, useState } from 'react';
import { ArrowRight, Check, ShieldAlert, X } from 'lucide-react';
import { useFreshFetch } from '@/hooks/useFreshFetch';
import {
  listPayoutAccountChanges,
  payoutChangeFieldLabels,
  verifyArtistPayoutAccount,
  rejectArtistPayoutAccount,
  type AdminPayoutAccountChange,
  type PayoutChangeStatus,
} from '@/lib/artistApi';
import { toast } from '@/store/toastStore';
import Alert from '@/components/Alert';
import { adminTypography } from '@/lib/adminTypography';

const TABS: Array<{ key: PayoutChangeStatus | 'all'; label: string }> = [
  { key: 'pending', label: '대기' },
  { key: 'approved', label: '승인됨' },
  { key: 'rejected', label: '거절됨' },
  { key: 'all', label: '전체' },
];

function won(n: number): string {
  return `${Math.round(n).toLocaleString('ko-KR')}원`;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', {
    year: '2-digit', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

/** 변경 전 → 변경 후 한 줄. 실제로 바뀐 항목만 보여준다. */
function Delta({ label, before, after }: { label: string; before: string | null; after: string | null }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
      <span className="text-ink-dim">{label}</span>
      <span className="font-mono text-ink-mute line-through decoration-ink-dim/60">{before || '—'}</span>
      <ArrowRight size={10} className="text-ink-dim" />
      <span className="font-mono font-semibold text-ink">{after || '—'}</span>
    </div>
  );
}

export default function PayoutAccountChangesList() {
  const [rows, setRows] = useState<AdminPayoutAccountChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tab, setTab] = useState<PayoutChangeStatus | 'all'>('pending');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listPayoutAccountChanges(tab, 200));
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useFreshFetch(load, [tab]);

  async function approve(r: AdminPayoutAccountChange) {
    if (!r.account_id) return;
    const warn = r.pending_settlement_amount > 0
      ? `\n\n⚠ 이 아티스트는 지급 대기 ${r.pending_settlement_count}건 / ${won(r.pending_settlement_amount)} 이 잡혀 있습니다. 승인하면 다음 지급은 새 계좌로 나갑니다.`
      : '';
    if (!window.confirm(`${r.artist_name ?? '이 아티스트'} 의 계좌 변경을 승인할까요?${warn}`)) return;
    setBusyId(r.change_id);
    const res = await verifyArtistPayoutAccount(r.account_id);
    setBusyId(null);
    if (!res.ok) { toast.error(res.error ?? '승인 실패'); return; }
    toast.success('변경 승인 완료');
    await load();
  }

  async function reject(r: AdminPayoutAccountChange) {
    if (!r.account_id) return;
    const reason = window.prompt('거절 사유를 입력하세요 (아티스트에게 표시됩니다)') ?? '';
    if (!reason.trim()) { toast.error('거절 사유는 필수입니다'); return; }
    setBusyId(r.change_id);
    const res = await rejectArtistPayoutAccount(r.account_id, reason.trim());
    setBusyId(null);
    if (!res.ok) { toast.error(res.error ?? '거절 실패'); return; }
    toast.success('거절 완료');
    await load();
  }

  const pendingCount = useMemo(
    () => rows.filter((r) => r.status === 'pending').length,
    [rows],
  );

  return (
    <div className="space-y-3">
      <div>
        <h2 className="flex items-center gap-1.5 text-lg font-bold tracking-tight">
          <ShieldAlert size={16} className="text-accent" /> 계좌 변경 신청
        </h2>
        <p className={adminTypography.hint}>
          이미 승인된 계좌가 바뀐 건. 승인 전까지 해당 아티스트의 지급은 자동으로 보류됩니다.
        </p>
      </div>

      <Alert tone="warning">
        본인 명의 확인이 끝난 뒤에만 승인하세요. 지급 대기 금액이 있는 상태의 계좌 변경은
        계정 탈취 시 정산금이 빠져나가는 경로가 됩니다 — 아래 '지급 대기' 금액을 반드시 확인하세요.
      </Alert>

      <div className="flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-pressed={tab === t.key}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              tab === t.key
                ? 'bg-accent text-black'
                : 'bg-bg-soft text-ink-mute ring-1 ring-line/10 hover:text-ink'
            }`}
          >
            {t.label}
            {t.key === 'pending' && pendingCount > 0 && tab === 'pending' ? ` ${pendingCount}` : ''}
          </button>
        ))}
      </div>

      {loading && <div className="h-32 animate-pulse rounded-2xl bg-bg-card" />}

      {!loading && rows.length === 0 && (
        <div className="rounded-2xl bg-bg-card p-8 text-center text-xs text-ink-mute ring-1 ring-line/10">
          {tab === 'pending' ? '대기 중인 계좌 변경 신청이 없어요.' : '해당하는 신청이 없어요.'}
        </div>
      )}

      <div className="space-y-2">
        {!loading && rows.map((r) => {
          const changed = new Set(r.changed_fields ?? []);
          const atRisk = r.status === 'pending' && r.pending_settlement_amount > 0;
          return (
            <div
              key={r.change_id}
              className={`rounded-2xl bg-bg-card p-3.5 ring-1 ${
                atRisk ? 'ring-amber-400/50' : 'ring-line/10'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{r.artist_name ?? '—'}</p>
                  <p className="text-[10px] text-ink-mute">{r.email ?? '—'}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-ink-dim">{when(r.created_at)}</p>
                  <p className="mt-0.5 text-[10px] font-semibold text-ink-mute">
                    변경 항목: {payoutChangeFieldLabels(r.changed_fields)}
                  </p>
                </div>
              </div>

              <div className="mt-2.5 space-y-1 rounded-lg bg-bg-deep/50 p-2.5">
                {changed.has('bank_name') && (
                  <Delta label="은행" before={r.prev_bank_name} after={r.new_bank_name} />
                )}
                {changed.has('account_number') && (
                  <Delta label="계좌" before={r.prev_masked_account_number} after={r.new_masked_account_number} />
                )}
                {changed.has('account_holder') && (
                  <Delta label="예금주" before={r.prev_account_holder} after={r.new_account_holder} />
                )}
                {changed.has('legal_name') && (
                  <Delta label="실명" before={r.prev_legal_name} after={r.new_legal_name} />
                )}
                {changed.has('resident_registration_number') && (
                  <p className="text-[11px] font-semibold text-red-300">
                    주민등록번호가 변경됐습니다 — 명의 확인 필수
                  </p>
                )}
              </div>

              {atRisk && (
                <p className="mt-2 rounded-lg bg-amber-400/30 px-2.5 py-1.5 text-[11px] font-semibold text-slate-900 ring-1 ring-amber-400/60 dark:text-amber-50">
                  지급 대기 {r.pending_settlement_count}건 · {won(r.pending_settlement_amount)} — 승인 시 새 계좌로 지급됩니다
                </p>
              )}

              {r.status === 'pending' ? (
                <div className="mt-2.5 flex justify-end gap-1.5">
                  <button
                    onClick={() => approve(r)}
                    disabled={busyId === r.change_id}
                    className="inline-flex items-center gap-1 rounded-md bg-emerald-500/25 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-50"
                  >
                    <Check size={11} /> 승인
                  </button>
                  <button
                    onClick={() => reject(r)}
                    disabled={busyId === r.change_id}
                    className="inline-flex items-center gap-1 rounded-md bg-rose-500/25 px-2.5 py-1 text-[11px] font-semibold text-red-300 hover:bg-rose-500/30 disabled:opacity-50"
                  >
                    <X size={11} /> 거절
                  </button>
                </div>
              ) : (
                <p className="mt-2 text-right text-[10px] text-ink-dim">
                  {r.status === 'approved' ? '승인됨' : '거절됨'}
                  {r.reviewed_at ? ` · ${when(r.reviewed_at)}` : ''}
                  {r.review_note ? ` · ${r.review_note}` : ''}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
