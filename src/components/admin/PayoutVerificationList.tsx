/**
 * PayoutVerificationList — 정산 계좌 목록/승인.
 *
 * list_pending_payout_accounts 는 이름과 달리 전 계좌를 반환한다(pending 우선 정렬).
 * 예전엔 그걸 그대로 한 표에 쏟아붓기만 해서, "계좌는 verified 인데 지급 요건(실명·
 * 주민번호·계좌·원천징수 동의) 미완비" 인 행이 102건 사이에 묻혀 있었다. 그 상태는
 * 지급이 보류되는데도 아티스트 화면엔 초록 '확인 완료' 로 보여서(8/31 #525) 2026-05-17~
 * 06-01 등록자 24건이 6월부터 방치됐다.
 *
 * 그래서 상태 필터를 둔다 — 특히 '정보 미완비' 를 한 번에 뽑을 수 있게.
 * 판정은 서버가 내려주는 is_pii_complete 를 그대로 쓴다(홈 처리 대기 줄의
 * payout_incomplete, 0489 와 같은 기준).
 */
import { useCallback, useMemo, useState } from 'react';
import { Wallet, Clock, Pencil } from 'lucide-react';
import { useFreshFetch } from '@/hooks/useFreshFetch';
import {
  listPendingPayoutAccounts,
  verifyArtistPayoutAccount,
  rejectArtistPayoutAccount,
  type AdminPayoutRow,
} from '@/lib/artistApi';
import { toast } from '@/store/toastStore';
import Alert from '@/components/Alert';
import RevealPiiButton from './RevealPiiButton';
import PayoutAccountEditDialog from './PayoutAccountEditDialog';
import {
  AdminBadge, AdminButton, AdminEmpty, AdminTable, FilterBar, ConfirmDialog,
  type AdminTableColumn, type AdminToneName,
} from './ui';
import {
  PAYOUT_ACCOUNT_FILTERS as FILTERS,
  matchesPayoutAccountFilter as matchesFilter,
  countByPayoutAccountFilter,
  type PayoutAccountFilter,
} from '@/lib/payoutAccountFilter';

function taxLabel(t: string): string {
  switch (t) {
    case 'business_income_3_3': return '사업소득 3.3%';
    case 'other_income_8_8': return '기타소득 8.8%';
    case 'none': return '없음';
    default: return t || '—';
  }
}

const STATUS_LABEL: Record<string, { label: string; tone: AdminToneName }> = {
  pending: { label: '확인 대기', tone: 'warning' },
  verified: { label: '승인됨', tone: 'success' },
  rejected: { label: '거절됨', tone: 'danger' },
};

/**
 * 계좌 인증됨 + 지급 요건 미충족 = 실제로는 지급이 나가지 않는 상태.
 * 초록 '승인됨' 하나로 표시하면 관리자도 "다 된 계좌"로 읽는다 — 아티스트 화면에서
 * 같은 모순을 8/31 #525 가 고쳤는데 관리자 화면엔 그대로 남아 있었다.
 */
function statusLabelFor(r: AdminPayoutRow): { label: string; tone: AdminToneName } {
  if (r.verification_status === 'verified' && !r.is_pii_complete) {
    // 라벨로 구분을 유지한다 — 초록 '승인됨' 하나로 보이면 "다 된 계좌" 로 읽힌다.
    return { label: '승인됨 · 지급 보류', tone: 'warning' };
  }
  return STATUS_LABEL[r.verification_status] ?? STATUS_LABEL.pending;
}

export default function PayoutVerificationList({
  initialFilter = 'all',
}: {
  initialFilter?: PayoutAccountFilter;
} = {}) {
  const [rows, setRows] = useState<AdminPayoutRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<PayoutAccountFilter>(initialFilter);
  // 0532 — 계좌 변경 창. 고객센터 문의로 들어온 은행/계좌 변경을 여기서 처리한다.
  const [editRow, setEditRow] = useState<AdminPayoutRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listPendingPayoutAccounts();
      setRows(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useFreshFetch(load, []);

  async function verify(accountId: string) {
    setBusyId(accountId);
    const res = await verifyArtistPayoutAccount(accountId);
    setBusyId(null);
    if (!res.ok) {
      toast.error(res.error ?? '승인 실패');
      return;
    }
    toast.success('계좌 승인 완료');
    await load();
  }

  async function reject(accountId: string) {
    const reason = window.prompt('거절 사유를 입력하세요') ?? '';
    if (!reason.trim()) {
      toast.error('거절 사유는 필수입니다');
      return;
    }
    setBusyId(accountId);
    const res = await rejectArtistPayoutAccount(accountId, reason.trim());
    setBusyId(null);
    if (!res.ok) {
      toast.error(res.error ?? '거절 실패');
      return;
    }
    toast.success('거절 완료');
    await load();
  }

  // 검색은 이미 받아온 rows 안에서만 돈다(listPendingPayoutAccounts 는 전 계좌를 한 번에
  // 가져오므로 서버 pagination 이 없다 — 현재 페이지만 검색하는 상황이 아니다).
  const [search, setSearch] = useState('');
  // 승인은 돈이 나가는 경로다. 확인 단계를 둔다.
  const [verifyRow, setVerifyRow] = useState<AdminPayoutRow | null>(null);

  const counts = useMemo(() => countByPayoutAccountFilter(rows), [rows]);
  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (!matchesFilter(r, filter)) return false;
      if (!q) return true;
      return (
        r.artist_name?.toLowerCase().includes(q) ||
        r.email?.toLowerCase().includes(q) ||
        r.legal_name?.toLowerCase().includes(q) ||
        r.account_holder?.toLowerCase().includes(q) ||
        r.bank_name?.toLowerCase().includes(q)
      );
    });
  }, [rows, filter, search]);

  const activeFilters = (search.trim() ? 1 : 0) + (filter !== 'all' ? 1 : 0);

  const columns: AdminTableColumn<AdminPayoutRow>[] = [
    {
      key: 'artist',
      header: '아티스트',
      cell: (r) => (
        <>
          <p className="font-medium">{r.artist_name ?? '—'}</p>
          <p className="text-[10px] text-ink-mute">{r.email ?? '—'}</p>
        </>
      ),
    },
    {
      key: 'legal',
      header: '실명 / RRN',
      tdClassName: 'text-xs',
      cell: (r) => (
        <>
          <p className="font-medium">{r.legal_name ?? '—'}</p>
          <div className="mt-1">
            {r.is_pii_complete && r.masked_rrn ? (
              <RevealPiiButton
                accountId={r.account_id}
                maskedValue={r.masked_rrn}
                piiType="resident_number"
                className="font-mono text-[11px]"
              />
            ) : (
              <code className="font-mono text-[11px] text-ink-mute">{r.masked_rrn ?? '—'}</code>
            )}
          </div>
        </>
      ),
    },
    {
      key: 'bank',
      header: '은행 / 계좌',
      tdClassName: 'text-xs',
      cell: (r) => (
        <>
          <p>{r.bank_name}</p>
          <p className="mt-0.5 text-[10px] text-ink-mute">예금주: {r.account_holder}</p>
          <div className="mt-1">
            {r.is_pii_complete ? (
              <RevealPiiButton
                accountId={r.account_id}
                maskedValue={r.masked_account_number}
                piiType="account_number"
                className="font-mono text-[11px]"
              />
            ) : (
              <code className="font-mono text-[11px] text-ink-mute">{r.masked_account_number}</code>
            )}
          </div>
        </>
      ),
    },
    {
      key: 'tax',
      header: '세금 / 동의',
      tdClassName: 'text-[11px]',
      cell: (r) => (
        <>
          <p>{taxLabel(r.tax_withholding_type)}</p>
          <p className="mt-0.5">
            <AdminBadge tone={r.has_tax_consent ? 'success' : 'warning'} variant="subtle" size="sm">
              {r.has_tax_consent ? '동의 완료' : '미동의'}
            </AdminBadge>
          </p>
          {r.tax_consent_at && (
            <p className="mt-0.5 text-[10px] text-ink-dim">
              {new Date(r.tax_consent_at).toLocaleString('ko-KR', {
                year: '2-digit', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit',
              })}
            </p>
          )}
          {!r.is_pii_complete && (
            <p className="mt-0.5">
              <AdminBadge tone="danger" variant="subtle" size="sm">PII 미완료</AdminBadge>
            </p>
          )}
        </>
      ),
    },
    {
      key: 'status',
      header: '상태',
      cell: (r) => {
        const s = statusLabelFor(r);
        return (
          <>
            <AdminBadge
              tone={s.tone}
              variant="subtle"
              size="sm"
              icon={r.verification_status === 'pending' ? <Clock size={9} /> : undefined}
            >
              {s.label}
            </AdminBadge>
            {r.rejected_reason && (
              <p className="mt-1 text-[10px] text-ink-mute">{r.rejected_reason}</p>
            )}
          </>
        );
      },
    },
    {
      key: 'created',
      header: '등록일',
      align: 'right',
      tdClassName: 'text-xs text-ink-mute',
      cell: (r) =>
        new Date(r.created_at).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }),
    },
    {
      key: 'actions',
      header: '조치',
      align: 'right',
      cell: (r) => (
        <div className="flex flex-wrap justify-end gap-1">
          <AdminButton
            tone="neutral"
            variant="outline"
            size="sm"
            disabled={busyId === r.account_id}
            title="은행 · 계좌번호 · 예금주 변경 (사유 기록)"
            leftIcon={<Pencil size={11} />}
            onClick={() => setEditRow(r)}
          >
            계좌 변경
          </AdminButton>
          {r.verification_status !== 'verified' && (
            <AdminButton
              tone="success"
              variant="subtle"
              size="sm"
              disabled={busyId === r.account_id || !r.is_pii_complete}
              title={!r.is_pii_complete ? 'PII 미완료 — 승인 불가' : '승인'}
              onClick={() => setVerifyRow(r)}
            >
              승인
            </AdminButton>
          )}
          {r.verification_status !== 'rejected' && (
            <AdminButton
              tone="danger"
              variant="subtle"
              size="sm"
              disabled={busyId === r.account_id}
              onClick={() => void reject(r.account_id)}
            >
              거절
            </AdminButton>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-lg font-bold tracking-tight">
            <Wallet size={16} className="text-accent" /> 정산 계좌 확인
          </h2>
          <p className="text-xs text-ink-mute">
            확인 대기 {counts.pending}건 · 정보 미완비 {counts.incomplete}건 · 계좌번호는 본인+관리자만 조회 가능
          </p>
        </div>
      </div>

      <Alert tone="warning">
        주민등록번호 / 계좌번호는 민감 PII 입니다. 본인 명의 + 동의 + 13자리 검증 확인 후
        승인해주세요. 원본 보기 시 audit log 가 영구 기록됩니다.
      </Alert>

      {/* 상태 필터 — '정보 미완비'(인증됨 + 지급 요건 미충족)를 한 번에 뽑기 위한 것이 핵심.
          칩 자체(개수 표시 · 미완비 강조)는 그대로 두고 FilterBar 로 검색과 한 영역에 모았다. */}
      <FilterBar
        search={
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="아티스트 · 이메일 · 실명 · 예금주 · 은행 검색"
            aria-label="정산 계좌 검색"
            className="input w-full text-sm"
          />
        }
        activeCount={activeFilters}
        onReset={() => { setSearch(''); setFilter('all'); }}
        count={`${visibleRows.length}건 / 전체 ${rows.length}건`}
        filters={FILTERS.map((f) => {
          const active = filter === f.key;
          const n = counts[f.key] ?? 0;
          // 미완비는 0 이 아니면 처리해야 할 건이라 눈에 띄게.
          const alert = f.key === 'incomplete' && n > 0;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              aria-pressed={active}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                active
                  ? 'bg-accent text-black'
                  : alert
                    ? 'bg-amber-500/25 text-amber-100 ring-1 ring-amber-400/50 hover:bg-amber-500/30'
                    : 'bg-bg-soft text-ink-mute ring-1 ring-line/10 hover:text-ink'
              }`}
            >
              {f.label} {n}
            </button>
          );
        })}
      />

      <AdminTable
        caption="정산 계좌 목록"
        columns={columns}
        rows={visibleRows}
        rowKey={(r) => r.account_id}
        loading={loading}
        minWidth={760}
        rowClassName={() => 'align-top'}
        empty={
          <AdminEmpty
            title={
              rows.length === 0
                ? '등록된 정산 계좌가 없어요.'
                : '이 조건에 해당하는 계좌가 없어요.'
            }
          />
        }
      />

      <ConfirmDialog
        open={verifyRow !== null}
        title="정산 계좌 승인"
        target={verifyRow ? `${verifyRow.artist_name ?? '—'} · ${verifyRow.bank_name} ${verifyRow.masked_account_number}` : undefined}
        description="승인 후 이 아티스트는 음원을 업로드할 수 있게 되고, 이 계좌로 정산이 지급됩니다. 본인 명의·동의·계좌번호를 확인했는지 다시 봐주세요."
        confirmLabel="승인"
        pending={verifyRow ? busyId === verifyRow.account_id : false}
        onConfirm={() => {
          const id = verifyRow?.account_id;
          if (!id) return;
          void verify(id).finally(() => setVerifyRow(null));
        }}
        onCancel={() => setVerifyRow(null)}
      />

      {editRow && (
        <PayoutAccountEditDialog
          row={editRow}
          onClose={() => setEditRow(null)}
          onSaved={() => void load()}
        />
      )}
    </div>
  );
}
