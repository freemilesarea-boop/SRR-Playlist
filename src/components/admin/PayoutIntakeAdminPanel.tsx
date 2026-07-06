/**
 * PayoutIntakeAdminPanel — X6.21
 *
 * 정산 정보 신청 (payout_intake_submissions) 관리 화면.
 *   - pending / approved / rejected / needs_revision 필터
 *   - 마스킹 목록 + RevealIntakePiiButton 으로 PII 노출 (audit 자동)
 *   - 승인 / 반려 / 보완 요청 액션
 *   - 신분증 signed URL 다운로드
 *
 * 승인 시 admin_approve_payout_intake RPC 가 artist_payout_accounts 로 자동
 * 마이그레이션 + verified 처리. legacy 41건은 건드리지 않음.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  RefreshCw, Search, CheckCircle2, XCircle, AlertTriangle, Download, Clock,
} from 'lucide-react';
import {
  adminListPayoutIntake,
  adminApprovePayoutIntake,
  adminUpdatePayoutIntakeStatus,
  createIdDocumentSignedUrl,
  type PayoutIntakeRow,
  type IntakeStatus,
} from '@/lib/payoutIntakeAdminApi';
import RevealIntakePiiButton from './RevealIntakePiiButton';
import { toast } from '@/store/toastStore';
import Alert from '@/components/Alert';

type Filter = '' | IntakeStatus;

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: '', label: '전체' },
  { key: 'pending', label: '대기' },
  { key: 'approved', label: '승인됨' },
  { key: 'rejected', label: '반려' },
  { key: 'needs_revision', label: '보완 요청' },
];

const STATUS_TONE: Record<IntakeStatus, { label: string; tone: string }> = {
  pending: { label: '확인 대기', tone: 'bg-yellow-500/25 text-yellow-200' },
  approved: { label: '승인됨', tone: 'bg-emerald-500/25 text-emerald-300' },
  rejected: { label: '반려됨', tone: 'bg-rose-500/25 text-red-300' },
  needs_revision: { label: '보완 요청', tone: 'bg-amber-500/25 text-amber-300' },
  withdrawn: { label: '철회됨', tone: 'bg-ink/5 text-ink-mute' },
};

export default function PayoutIntakeAdminPanel() {
  const [rows, setRows] = useState<PayoutIntakeRow[]>([]);
  const [filter, setFilter] = useState<Filter>('pending');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminListPayoutIntake(filter);
      setRows(data);
    } catch (e) {
      toast.error(`정산 신청 로딩 실패: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  const filtered = rows.filter((r) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      r.legal_name.toLowerCase().includes(q) ||
      r.user_email?.toLowerCase().includes(q) ||
      r.account_holder.toLowerCase().includes(q) ||
      r.bank_name.toLowerCase().includes(q)
    );
  });

  async function approve(row: PayoutIntakeRow) {
    if (!window.confirm(
      `${row.legal_name} 님의 정산 정보 신청을 승인할까요?\n` +
      `→ artist_payout_accounts 에 자동 마이그레이션 (verified)`,
    )) return;
    setBusyId(row.submission_id);
    try {
      await adminApprovePayoutIntake(row.submission_id);
      toast.success('승인 완료 — 정산 보류 자동 해소');
      await load();
    } catch (e) {
      toast.error(`승인 실패: ${(e as Error).message}`);
    } finally {
      setBusyId(null);
    }
  }

  async function reject(row: PayoutIntakeRow, mode: 'rejected' | 'needs_revision') {
    const label = mode === 'rejected' ? '반려' : '보완 요청';
    const reason = window.prompt(`${label} 사유를 입력하세요 (필수)`) ?? '';
    if (!reason.trim()) {
      toast.error('사유는 필수입니다');
      return;
    }
    setBusyId(row.submission_id);
    try {
      await adminUpdatePayoutIntakeStatus(row.submission_id, mode, reason.trim());
      toast.success(`${label} 완료`);
      await load();
    } catch (e) {
      toast.error(`${label} 실패: ${(e as Error).message}`);
    } finally {
      setBusyId(null);
    }
  }

  async function openIdDoc(path: string) {
    const url = await createIdDocumentSignedUrl(path, 60);
    if (!url) {
      toast.error('신분증 URL 생성 실패');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  const pendingCount = rows.filter((r) => r.status === 'pending').length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold tracking-tight">정산 정보 신청</h2>
          <p className="text-[11px] text-ink-mute">
            대기 {pendingCount}건 · 승인 시 정산계좌 자동 등록 + verified
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="inline-flex items-center gap-1 rounded-full bg-bg-soft px-3 py-1.5 text-xs ring-1 ring-line/20 hover:bg-bg-hover"
        >
          <RefreshCw size={12} /> 새로고침
        </button>
      </div>

      <Alert tone="warning">
        주민등록번호 / 계좌번호는 민감 PII 입니다. <strong>본인 명의 확인 후 승인</strong>해주세요.
        원본 보기 시 audit log 영구 기록됩니다. (RRN 15초 / 계좌 30초 자동 마스킹)
      </Alert>

      {/* 필터 + 검색 */}
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key || 'all'}
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              filter === f.key ? 'bg-ink text-bg' : 'bg-bg-soft text-ink-mute hover:bg-bg-hover'
            }`}
          >
            {f.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1">
          <Search size={12} className="text-ink-dim" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름 / 이메일 / 은행 검색"
            className="w-56 rounded-md bg-bg-soft px-2 py-1.5 text-xs ring-1 ring-line/20 placeholder:text-ink-dim focus:outline-none focus:ring-accent/30"
          />
        </div>
      </div>

      {loading && <p className="text-xs text-ink-mute">불러오는 중...</p>}

      <div className="overflow-x-auto rounded-2xl bg-bg-card ring-1 ring-line/10">
        <table className="w-full min-w-[1100px] text-sm">
          <thead className="bg-bg-soft/60">
            <tr className="border-b border-line/10 text-[11px] uppercase tracking-wider text-ink-dim">
              <th className="px-3 py-2.5 text-left font-semibold">신청자</th>
              <th className="px-3 py-2.5 text-left font-semibold">실명 / RRN</th>
              <th className="px-3 py-2.5 text-left font-semibold">휴대폰 / 주소</th>
              <th className="px-3 py-2.5 text-left font-semibold">은행 / 계좌</th>
              <th className="px-3 py-2.5 text-left font-semibold">신분증</th>
              <th className="px-3 py-2.5 text-left font-semibold">상태</th>
              <th className="px-3 py-2.5 text-right font-semibold">접수일</th>
              <th className="px-3 py-2.5 text-right font-semibold">조치</th>
            </tr>
          </thead>
          <tbody>
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-xs text-ink-mute">
                  표시할 신청이 없어요.
                </td>
              </tr>
            )}
            {filtered.map((r) => {
              const s = STATUS_TONE[r.status] ?? STATUS_TONE.pending;
              return (
                <tr key={r.submission_id} className="border-b border-line/10 align-top last:border-b-0">
                  <td className="px-3 py-2.5">
                    <p className="text-[10px] text-ink-mute">{r.user_email ?? '—'}</p>
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    <p className="font-semibold">{r.legal_name}</p>
                    <div className="mt-1">
                      <RevealIntakePiiButton
                        submissionId={r.submission_id}
                        maskedValue={r.masked_rrn}
                        piiType="resident_number"
                        className="font-mono text-[11px]"
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    <p className="font-mono">{r.phone}</p>
                    <p className="mt-0.5 text-[10px] text-ink-mute">{r.address}</p>
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    <p>{r.bank_name}</p>
                    <p className="mt-0.5 text-[10px] text-ink-mute">예금주: {r.account_holder}</p>
                    <div className="mt-1">
                      <RevealIntakePiiButton
                        submissionId={r.submission_id}
                        maskedValue={r.masked_account_number}
                        piiType="account_number"
                        className="font-mono text-[11px]"
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    {r.id_document_url ? (
                      <button
                        onClick={() => void openIdDoc(r.id_document_url)}
                        className="inline-flex items-center gap-1 rounded-md bg-ink/5 px-2 py-1 text-[11px] font-semibold hover:bg-ink/10"
                        title={r.id_document_filename ?? '신분증 다운로드'}
                      >
                        <Download size={11} /> 보기
                      </button>
                    ) : (
                      <span className="text-[10px] text-ink-dim">없음</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${s.tone}`}>
                      {r.status === 'pending' && <Clock size={9} />}
                      {s.label}
                    </span>
                    {r.rejected_reason && (
                      <p className="mt-1 text-[10px] text-red-300" title={r.rejected_reason}>
                        {r.rejected_reason.length > 30
                          ? r.rejected_reason.slice(0, 30) + '…'
                          : r.rejected_reason}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right text-xs text-ink-mute">
                    {new Date(r.created_at).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' })}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col items-end gap-1">
                      {r.status !== 'approved' && (
                        <button
                          onClick={() => void approve(r)}
                          disabled={busyId === r.submission_id}
                          className="inline-flex items-center gap-1 rounded-md bg-emerald-500/25 px-2 py-1 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50"
                        >
                          <CheckCircle2 size={11} /> 승인
                        </button>
                      )}
                      {r.status !== 'needs_revision' && r.status !== 'approved' && (
                        <button
                          onClick={() => void reject(r, 'needs_revision')}
                          disabled={busyId === r.submission_id}
                          className="inline-flex items-center gap-1 rounded-md bg-amber-500/25 px-2 py-1 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/25 disabled:opacity-50"
                        >
                          <AlertTriangle size={11} /> 보완
                        </button>
                      )}
                      {r.status !== 'rejected' && r.status !== 'approved' && (
                        <button
                          onClick={() => void reject(r, 'rejected')}
                          disabled={busyId === r.submission_id}
                          className="inline-flex items-center gap-1 rounded-md bg-rose-500/25 px-2 py-1 text-[11px] font-semibold text-red-300 hover:bg-red-500/25 disabled:opacity-50"
                        >
                          <XCircle size={11} /> 반려
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
