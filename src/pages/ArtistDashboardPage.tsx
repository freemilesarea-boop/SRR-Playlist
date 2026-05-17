import { useCallback, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import {
  Mic2,
  CheckCircle2,
  Clock,
  XCircle,
  EyeOff,
  Upload,
  Trash2,
  Music,
  ArrowLeft,
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useFreshFetch } from '@/hooks/useFreshFetch';
import {
  fetchMyArtistProfile,
  fetchMyArtistTracks,
  uploadArtistTrack,
  deleteMyArtistTrack,
  validateArtistAudioFile,
  fetchArtistStreamingSummary,
  fetchArtistDailyStreams,
  fetchArtistUploadEligibility,
  fetchMyPayoutAccount,
  submitArtistPayoutAccount,
  type ArtistProfile,
  type MyArtistTrackRow,
  type ArtistStreamingSummaryRow,
  type ArtistDailyStreamRow,
  type UploadEligibility,
  type PayoutAccount,
} from '@/lib/artistApi';
import { createPayappSubscription } from '@/lib/subscriptionApi';
import { CreditCard, Wallet, FileSignature } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { BarChart3, TrendingUp } from 'lucide-react';
import { toast } from '@/store/toastStore';
import Alert from '@/components/Alert';
import ArtistBatchUploadForm from '@/components/artist/ArtistBatchUploadForm';

import type { LucideIcon } from 'lucide-react';

const STATUS_LABEL: Record<string, { label: string; tone: string; Icon: LucideIcon }> = {
  pending_review: { label: '심사 대기', tone: 'bg-yellow-500/15 text-yellow-200', Icon: Clock },
  approved: { label: '승인됨', tone: 'bg-emerald-500/15 text-emerald-300', Icon: CheckCircle2 },
  rejected: { label: '거절됨', tone: 'bg-red-500/15 text-red-300', Icon: XCircle },
  hidden: { label: '숨김', tone: 'bg-ink/10 text-ink-mute', Icon: EyeOff },
};

export default function ArtistDashboardPage() {
  const { user, profile, loading: authLoading } = useAuthStore();
  const [artist, setArtist] = useState<ArtistProfile | null>(null);
  const [tracks, setTracks] = useState<MyArtistTrackRow[]>([]);
  const [summary, setSummary] = useState<ArtistStreamingSummaryRow[]>([]);
  const [daily, setDaily] = useState<ArtistDailyStreamRow[]>([]);
  const [eligibility, setEligibility] = useState<UploadEligibility | null>(null);
  const [payout, setPayout] = useState<PayoutAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingTrack, setEditingTrack] = useState<MyArtistTrackRow | null>(null);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const [ap, ts, sm, dl, el, po] = await Promise.all([
        fetchMyArtistProfile(user.id),
        fetchMyArtistTracks(),
        fetchArtistStreamingSummary(),
        fetchArtistDailyStreams(30),
        fetchArtistUploadEligibility(),
        fetchMyPayoutAccount(user.id),
      ]);
      setArtist(ap);
      setTracks(ts);
      setSummary(sm);
      setDaily(dl);
      setEligibility(el);
      setPayout(po);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useFreshFetch(load, [user?.id]);

  // 로그인 안 됨
  if (!authLoading && !user) return <Navigate to="/login" replace />;
  // account_type 이 artist 가 아니면 차단
  if (!authLoading && profile && profile.account_type !== 'artist') {
    return <Navigate to="/" replace />;
  }

  const isApproved = artist?.approval_status === 'approved';

  return (
    <div className="space-y-6 px-4 pb-12 pt-6 sm:px-6">
      <header className="flex items-center gap-3">
        <Link to="/profile" className="flex h-9 w-9 items-center justify-center rounded-full bg-bg-card" aria-label="뒤로">
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
            <Mic2 size={20} className="text-accent" /> 아티스트 대시보드
          </h1>
          <p className="text-xs text-ink-mute">{artist?.artist_name ?? '—'}</p>
        </div>
      </header>

      {/* 승인 상태 카드 */}
      {loading ? (
        <div className="h-24 animate-pulse rounded-2xl bg-bg-card" />
      ) : (
        <ApprovalStatusCard artist={artist} />
      )}

      {/* 자격 게이트 — eligibility.reasons 에 따라 단계별 UI */}
      {isApproved && (
        <UploadGate
          eligibility={eligibility}
          payout={payout}
          membershipTier={profile?.membership_tier ?? null}
          userEmail={user?.email ?? ''}
          editingTrack={editingTrack}
          onCancelEdit={() => setEditingTrack(null)}
          onUploaded={() => {
            setEditingTrack(null);
            void load();
          }}
          onPayoutSubmitted={load}
        />
      )}
      {!isApproved && (
        <div className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
          <h2 className="text-sm font-bold">음원 업로드</h2>
          <p className="mt-1 text-xs text-ink-mute">관리자 승인 후 음원 업로드가 가능합니다.</p>
        </div>
      )}

      {/* 스트리밍 분석 (승인된 곡이 1개 이상 + 데이터 있을 때만 의미) */}
      {tracks.length > 0 && (
        <StreamingAnalyticsSection summary={summary} daily={daily} loading={loading} />
      )}

      {/* 내 음원 목록 */}
      <section className="space-y-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-lg font-bold tracking-tight">내 음원 ({tracks.length})</h2>
          <span className="text-xs text-ink-mute">최신순</span>
        </div>
        {loading ? (
          <div className="space-y-2">
            {[0, 1].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-bg-card" />
            ))}
          </div>
        ) : tracks.length === 0 ? (
          <p className="rounded-2xl bg-bg-card/60 p-6 text-center text-sm text-ink-mute ring-1 ring-line/10">
            아직 업로드한 음원이 없어요.
          </p>
        ) : (
          <ul className="overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10">
            {tracks.map((t) => (
              <MyTrackRow
                key={t.track_id}
                track={t}
                onChanged={load}
                onEdit={() => {
                  setEditingTrack(t);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ApprovalStatusCard({ artist }: { artist: ArtistProfile | null }) {
  if (!artist) {
    return (
      <div className="rounded-2xl bg-yellow-500/10 p-4 ring-1 ring-yellow-500/30">
        <p className="text-sm font-bold text-yellow-200">아티스트 프로필이 없습니다</p>
        <p className="mt-1 text-xs text-yellow-100/80">
          회원가입 시 아티스트 정보가 저장되지 않았을 수 있어요. 고객센터로 문의해주세요.
        </p>
      </div>
    );
  }
  if (artist.approval_status === 'pending') {
    return (
      <div className="rounded-2xl bg-yellow-500/10 p-4 ring-1 ring-yellow-500/30">
        <p className="flex items-center gap-2 text-sm font-bold text-yellow-200">
          <Clock size={14} /> 관리자 승인 대기 중입니다
        </p>
        <p className="mt-1 text-xs text-yellow-100/80">
          승인이 완료되면 음원 등록이 가능합니다. 평균 1영업일 이내 처리됩니다.
        </p>
      </div>
    );
  }
  if (artist.approval_status === 'rejected') {
    return (
      <div className="rounded-2xl bg-red-500/10 p-4 ring-1 ring-red-500/30">
        <p className="flex items-center gap-2 text-sm font-bold text-red-200">
          <XCircle size={14} /> 승인이 거절되었습니다
        </p>
        {artist.rejected_reason && (
          <p className="mt-1 text-xs text-red-200/85">사유: {artist.rejected_reason}</p>
        )}
        <p className="mt-2 text-xs text-red-100/70">
          이의가 있으신가요?{' '}
          <a href="mailto:freemilesarea@gmail.com?subject=아티스트 승인 재신청" className="underline">
            고객센터 문의
          </a>
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-2xl bg-emerald-500/10 p-4 ring-1 ring-emerald-500/30">
      <p className="flex items-center gap-2 text-sm font-bold text-emerald-300">
        <CheckCircle2 size={14} /> 승인 완료
      </p>
      <p className="mt-1 text-xs text-emerald-100/80">
        음원을 업로드할 수 있어요. 업로드한 곡은 관리자 검수 후 공개됩니다.
      </p>
    </div>
  );
}

function UploadGate({
  eligibility,
  payout,
  membershipTier,
  userEmail,
  editingTrack,
  onCancelEdit,
  onUploaded,
  onPayoutSubmitted,
}: {
  eligibility: UploadEligibility | null;
  payout: PayoutAccount | null;
  membershipTier: 'free' | 'individual' | 'business' | null;
  userEmail: string;
  editingTrack?: MyArtistTrackRow | null;
  onCancelEdit?: () => void;
  onUploaded: () => void | Promise<void>;
  onPayoutSubmitted: () => void | Promise<void>;
}) {
  if (!eligibility) {
    return <div className="h-24 animate-pulse rounded-2xl bg-bg-card" />;
  }

  // 결제 확인:
  //   - RPC 가 살아있으면 eligibility.has_paid_membership 신뢰 (subscriptions 까지 검사)
  //   - RPC 가 실패해도 profile.membership_tier 로 보강
  // (0025 미적용 환경에서도 동작하도록 보강)
  const isPaid =
    eligibility.has_paid_membership ||
    membershipTier === 'individual' ||
    membershipTier === 'business';

  if (!isPaid) {
    return <PaymentRequiredCard userEmail={userEmail} />;
  }

  // 계약 단계 게이트 (0057). RPC 결과가 없는 환경(0057 미적용)에서는 통과 처리.
  if (
    eligibility.has_signed_contract === false ||
    (eligibility.contract_status && eligibility.contract_status !== 'signed')
  ) {
    return <ContractRequiredCard contractStatus={eligibility.contract_status ?? 'not_created'} />;
  }

  // 결제 완료 — 정산 계좌가 verified 가 아니면 무조건 등록/대기 섹션을 보여준다.
  // payout 상태가 단일 진실의 원천 (RPC 실패에 영향받지 않음).
  const isPayoutVerified = payout?.verification_status === 'verified';
  if (!isPayoutVerified) {
    return <PayoutAccountSection payout={payout} onSubmitted={onPayoutSubmitted} />;
  }

  // 모두 OK — 업로드 폼 + (참고용) 계좌 요약 카드
  // 재제출 모드(editingTrack)는 무조건 단일 업로드. 신규는 단일/일괄 토글.
  return (
    <>
      <VerifiedPayoutSummary payout={payout} />
      {editingTrack ? (
        <ArtistUploadForm
          onUploaded={onUploaded}
          editingTrack={editingTrack}
          onCancelEdit={onCancelEdit}
          key={editingTrack.track_id}
        />
      ) : (
        <UploadModeSwitcher onUploaded={onUploaded} />
      )}
    </>
  );
}

function UploadModeSwitcher({
  onUploaded,
}: {
  onUploaded: () => void | Promise<void>;
}) {
  const [mode, setMode] = useState<'single' | 'batch'>('single');
  return (
    <div className="space-y-2">
      <div className="flex gap-1 rounded-xl bg-bg-card p-1 ring-1 ring-line/10">
        <button
          type="button"
          onClick={() => setMode('single')}
          className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
            mode === 'single'
              ? 'bg-accent text-bg'
              : 'text-ink-mute hover:text-ink'
          }`}
        >
          단일 업로드
        </button>
        <button
          type="button"
          onClick={() => setMode('batch')}
          className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
            mode === 'batch'
              ? 'bg-accent text-bg'
              : 'text-ink-mute hover:text-ink'
          }`}
        >
          일괄 업로드 (최대 30곡)
        </button>
      </div>
      {mode === 'single' ? (
        <ArtistUploadForm onUploaded={onUploaded} key="single" />
      ) : (
        <ArtistBatchUploadForm onUploaded={onUploaded} key="batch" />
      )}
    </div>
  );
}

function VerifiedPayoutSummary({ payout }: { payout: PayoutAccount | null }) {
  if (!payout) return null;
  const masked = maskAccountNumber(payout.account_number);
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-emerald-500/10 p-3 ring-1 ring-emerald-500/30">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300">
        <Wallet size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-emerald-200">정산 계좌 확인 완료</p>
        <p className="truncate text-[11px] text-emerald-100/80">
          {payout.bank_name} · {masked} · {payout.account_holder}
        </p>
      </div>
    </div>
  );
}

function maskAccountNumber(num: string): string {
  if (!num) return '';
  const cleaned = num.replace(/\s+/g, '');
  if (cleaned.length <= 6) return cleaned;
  const head = cleaned.slice(0, 3);
  const tail = cleaned.slice(-3);
  const middle = '*'.repeat(Math.max(cleaned.length - 6, 1));
  return `${head}${middle}${tail}`;
}

function ContractRequiredCard({
  contractStatus,
}: {
  contractStatus: 'not_created' | 'pending_signature' | 'signed' | 'rejected' | 'expired';
}) {
  const titleByStatus: Record<typeof contractStatus, string> = {
    not_created: '계약서 발행 대기 중',
    pending_signature: '계약서 서명이 필요해요',
    signed: '계약 완료',
    rejected: '계약이 거절됐어요',
    expired: '계약 서명 기한이 만료됐어요',
  };
  const bodyByStatus: Record<typeof contractStatus, string> = {
    not_created:
      '결제는 완료됐어요. 관리자가 계약서를 발행하면 이 화면에 알림이 표시되고 서명할 수 있어요. 보통 1영업일 내 발행됩니다.',
    pending_signature:
      '계약서가 발행됐어요. 본문을 확인하고 동의·서명을 완료하면 음원 등록 단계로 진행할 수 있어요.',
    signed: '서명 완료. 다음 단계로 이동하는 중…',
    rejected:
      '이전 계약을 거절하셨어요. 음원 등록을 진행하려면 관리자에게 재발행을 요청해주세요.',
    expired:
      '계약 서명 기한이 만료됐어요. 관리자에게 재발행을 요청해주세요.',
  };

  return (
    <div className="space-y-3 rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
          <FileSignature size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold">음원 유통 계약서 — {titleByStatus[contractStatus]}</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-mute">
            {bodyByStatus[contractStatus]}
          </p>
        </div>
      </div>
      {contractStatus === 'pending_signature' && (
        <Link to="/artist/contract" className="btn-primary block w-full py-2.5 text-center">
          계약서 확인 및 서명
        </Link>
      )}
      {contractStatus !== 'pending_signature' && contractStatus !== 'signed' && (
        <Link
          to="/artist/contract"
          className="block w-full rounded-xl bg-bg-soft py-2.5 text-center text-sm font-semibold text-ink-mute ring-1 ring-line/10 hover:text-ink"
        >
          계약 상태 보기
        </Link>
      )}
    </div>
  );
}

function PaymentRequiredCard({ userEmail }: { userEmail: string }) {
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);

  async function onPay() {
    if (phone.replace(/\D/g, '').length < 9) {
      toast.error('알림 받을 휴대폰 번호를 입력해주세요');
      return;
    }
    setBusy(true);
    try {
      const res = await createPayappSubscription({
        plan_type: 'individual',
        recvphone: phone,
      });
      if (res.ok && res.payurl) {
        window.location.href = res.payurl;
        return;
      }
      toast.error(res.error ?? '결제 생성 실패');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
          <CreditCard size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold">음원 업로드 — 월 4,900원 요금제 결제</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-mute">
            아티스트 음원 업로드는 SRR Playlist 정기이용권(월 4,900원) 결제 후 이용할 수 있어요.
            결제 완료 후 자동으로 업로드 권한이 활성화됩니다.
          </p>
        </div>
      </div>
      <input
        type="tel"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="알림 받을 휴대폰 (010-0000-0000)"
        className="input"
        autoComplete="tel"
      />
      <button onClick={onPay} disabled={busy} className="btn-primary w-full py-2.5">
        {busy ? '결제창 준비중…' : 'PayApp 으로 4,900원 결제하기'}
      </button>
      <p className="text-[11px] text-ink-dim">
        결제 사용자: {userEmail} · 매월 자동 결제 · 마이페이지에서 즉시 해지 가능
      </p>
    </div>
  );
}

function PayoutAccountSection({
  payout,
  onSubmitted,
}: {
  payout: PayoutAccount | null;
  onSubmitted: () => void | Promise<void>;
}) {
  const [bankName, setBankName] = useState(payout?.bank_name ?? '');
  const [accountNumber, setAccountNumber] = useState(payout?.account_number ?? '');
  const [accountHolder, setAccountHolder] = useState(payout?.account_holder ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 폼 노출/입력 가능 조건
  //   - payout 없음                       → 폼 표시 (신규 등록)
  //   - verification_status='pending'    → 폼 숨김 (대기 중 정보만 표시)
  //   - verification_status='rejected'   → 폼 표시 (재등록)
  //   - verification_status='verified'   → 폼 숨김 (이 컴포넌트는 호출되지 않음)
  const status = payout?.verification_status;
  const showForm = !payout || status === 'rejected';

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!bankName.trim() || !accountNumber.trim() || !accountHolder.trim()) {
      setError('은행명 / 계좌번호 / 예금주를 모두 입력해주세요');
      return;
    }
    setBusy(true);
    try {
      const res = await submitArtistPayoutAccount({
        bank_name: bankName,
        account_number: accountNumber,
        account_holder: accountHolder,
      });
      if (!res.ok) {
        setError(res.error ?? '계좌 등록 실패');
        toast.error(res.error ?? '계좌 등록 실패');
        return;
      }
      toast.success('계좌가 등록됐어요. 관리자 확인 후 업로드가 활성화됩니다.');
      await onSubmitted();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '계좌 등록 실패';
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  const title =
    status === 'pending'
      ? '관리자 계좌 확인 대기 중입니다'
      : status === 'rejected'
        ? '계좌 확인이 반려되었습니다'
        : '정산 계좌를 등록해주세요';

  const description =
    status === 'pending'
      ? '등록하신 계좌가 관리자 확인 중입니다. 평균 1영업일 이내 처리됩니다.'
      : status === 'rejected'
        ? '아래 사유를 확인하고 정확한 정보로 다시 등록해주세요.'
        : '아티스트 음원 업로드 전, 정산받을 본인 명의 계좌를 등록해주세요. (MVP 는 관리자 수동 확인)';

  const statusBadge =
    status === 'rejected'
      ? { label: '반려됨', tone: 'bg-red-500/15 text-red-300' }
      : status === 'pending'
        ? { label: '확인 대기 중', tone: 'bg-yellow-500/15 text-yellow-200' }
        : null;

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
          <Wallet size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-bold">{title}</h2>
            {statusBadge && (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusBadge.tone}`}>
                {statusBadge.label}
              </span>
            )}
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-mute">{description}</p>
          {payout?.rejected_reason && (
            <div className="mt-1.5">
              <Alert tone="error" title="반려 사유">
                {payout.rejected_reason}
              </Alert>
            </div>
          )}
        </div>
      </div>

      {/* pending 상태: 등록된 정보를 마스킹하여 표시 (재등록은 불가 — 관리자 처리 대기) */}
      {status === 'pending' && payout && (
        <div className="space-y-1 rounded-lg bg-bg-deep/50 p-3 text-[12px] ring-1 ring-line/10">
          <Row2 label="은행" value={payout.bank_name} />
          <Row2 label="계좌번호" value={maskAccountNumber(payout.account_number)} />
          <Row2 label="예금주" value={payout.account_holder} />
          <p className="pt-1 text-[11px] text-ink-dim">
            관리자 확인이 완료되면 이 화면 대신 업로드 폼이 표시됩니다.
          </p>
        </div>
      )}

      {/* 신규 등록 / 반려 후 재등록 */}
      {showForm && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="은행명 *">
              <input
                type="text"
                required
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                placeholder="예: 신한은행"
                className="input"
              />
            </Field>
            <Field label="예금주명 *">
              <input
                type="text"
                required
                value={accountHolder}
                onChange={(e) => setAccountHolder(e.target.value)}
                placeholder="이름 (본인 명의)"
                className="input"
              />
            </Field>
          </div>
          <Field label="계좌번호 *">
            <input
              type="text"
              required
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
              placeholder="숫자만 또는 하이픈 포함"
              className="input"
              inputMode="numeric"
            />
          </Field>

          {error && <Alert tone="error">{error}</Alert>}

          <button type="submit" disabled={busy} className="btn-primary w-full py-2.5">
            {busy ? '등록 중…' : status === 'rejected' ? '계좌 다시 등록' : '계좌 등록'}
          </button>
          <p className="text-[11px] text-ink-dim">
            등록 후 관리자 확인까지 평균 1영업일이 소요됩니다.
          </p>
        </>
      )}
    </form>
  );
}

function Row2({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] uppercase tracking-wider text-ink-dim">{label}</span>
      <span className="truncate font-mono text-ink">{value}</span>
    </div>
  );
}

const SUITABLE_STORE_OPTIONS = [
  '카페', '와인바', '식당', '베이커리', '헬스장', '필라테스', '미용실', '의류매장', '서점', '기타',
];

function defaultReleaseDate(): string {
  // today + 3 days (KST 기준 단순 처리)
  const d = new Date();
  d.setDate(d.getDate() + 3);
  return d.toISOString().slice(0, 10);
}

function ArtistUploadForm({
  onUploaded,
  editingTrack,
  onCancelEdit,
}: {
  onUploaded: () => void | Promise<void>;
  editingTrack?: MyArtistTrackRow | null;
  onCancelEdit?: () => void;
}) {
  // 재제출 모드: editingTrack 의 기존 메타 preload. audio/cover 는 사용자가 재업로드 (새 파일).
  const isEditing = !!editingTrack;
  const [title, setTitle] = useState(editingTrack?.title ?? '');
  const [albumName, setAlbumName] = useState(editingTrack?.album_name ?? '');
  const [releaseTitle, setReleaseTitle] = useState(editingTrack?.release_title ?? '');
  const [releaseType, setReleaseType] = useState<'single' | 'ep' | 'album'>(
    editingTrack?.release_type ?? 'single',
  );
  const [releaseDate, setReleaseDate] = useState<string>(
    editingTrack?.release_date ?? defaultReleaseDate(),
  );
  const [artistOverride, setArtistOverride] = useState(editingTrack?.artist ?? '');
  const [isrc, setIsrc] = useState(editingTrack?.isrc ?? '');
  const [rightsHolderName, setRightsHolderName] = useState(
    editingTrack?.rights_holder_name ?? '',
  );
  const [explicitContent, setExplicitContent] = useState(editingTrack?.explicit_content ?? false);
  const [instrumental, setInstrumental] = useState(editingTrack?.instrumental ?? false);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);  // 재제출 시에도 다시 체크 필요
  const [mainGenre, setMainGenre] = useState(editingTrack?.main_genre ?? '');
  const [subGenre, setSubGenre] = useState(editingTrack?.sub_genre ?? '');
  const [suitableStore, setSuitableStore] = useState(editingTrack?.suitable_store ?? '');
  const [mood, setMood] = useState(editingTrack?.mood ?? '');
  const [lyrics, setLyrics] = useState(editingTrack?.lyrics ?? '');
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  function pickAudio(f: File | null) {
    if (!f) return setAudioFile(null);
    const v = validateArtistAudioFile(f);
    if (!v.ok) {
      toast.error(v.error ?? '허용되지 않는 파일');
      return;
    }
    setAudioFile(f);
  }

  function missing(): string | null {
    // 재제출 모드: audioFile 미선택이어도 기존 audio_url 유지 가능
    if (!isEditing && !audioFile) return '음원 파일을 선택해주세요';
    if (!title.trim()) return '곡 제목을 입력해주세요';
    if (!albumName.trim()) return '앨범명을 입력해주세요';
    if (!releaseDate) return '발매일을 선택해주세요';
    // 발매일 today + 3 days 검증
    const min = new Date();
    min.setDate(min.getDate() + 3);
    min.setHours(0, 0, 0, 0);
    if (new Date(releaseDate) < min) {
      return '발매일은 오늘 기준 최소 3일 뒤부터 선택할 수 있어요';
    }
    if (!mainGenre.trim()) return '메인 장르를 입력해주세요';
    if (!subGenre.trim()) return '서브 장르를 입력해주세요';
    if (!suitableStore.trim()) return '어울리는 매장을 선택해주세요';
    if (!mood.trim()) return '곡 분위기를 입력해주세요';
    if (!rightsConfirmed) return '권리 확인 체크박스를 동의해주세요';
    return null;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const m = missing();
    if (m) {
      toast.error(m);
      return;
    }
    setBusy(true);
    try {
      const res = await uploadArtistTrack({
        trackId: editingTrack?.track_id ?? null,
        existingAudioUrl: editingTrack?.audio_url ?? null,
        existingCoverUrl: editingTrack?.cover_url ?? null,
        title,
        album_name: albumName,
        release_title: releaseTitle || albumName,
        release_type: releaseType,
        release_date: releaseDate,
        isrc: isrc || undefined,
        rights_holder_name: rightsHolderName || undefined,
        explicit_content: explicitContent,
        instrumental,
        rightsConfirmed,
        artist: artistOverride || undefined,
        main_genre: mainGenre,
        sub_genre: subGenre,
        suitable_store: suitableStore,
        mood,
        lyrics: lyrics || undefined,
        audioFile,
        coverFile,
      });
      if (!res.ok) {
        toast.error(res.error ?? '업로드 실패');
        return;
      }
      toast.success(
        isEditing
          ? '재제출 완료. 관리자 재검수가 진행됩니다.'
          : res.track_code
            ? `업로드 완료 (${res.track_code}). 관리자 검수 후 공개됩니다.`
            : '업로드 완료. 관리자 검수 후 공개됩니다.',
      );
      setTitle('');
      setAlbumName('');
      setReleaseTitle('');
      setReleaseType('single');
      setReleaseDate(defaultReleaseDate());
      setArtistOverride('');
      setIsrc('');
      setRightsHolderName('');
      setExplicitContent(false);
      setInstrumental(false);
      setRightsConfirmed(false);
      setMainGenre('');
      setSubGenre('');
      setSuitableStore('');
      setMood('');
      setLyrics('');
      setAudioFile(null);
      setCoverFile(null);
      await onUploaded();
      onCancelEdit?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-bold">
          <Upload size={14} className="text-accent" />
          {isEditing
            ? `수정 후 재제출 — ${editingTrack?.track_code ?? editingTrack?.title ?? ''}`
            : '새 음원 업로드'}
        </h2>
        {isEditing && onCancelEdit && (
          <button
            type="button"
            onClick={onCancelEdit}
            className="text-xs text-ink-mute hover:text-ink"
          >
            취소
          </button>
        )}
      </div>

      {isEditing && editingTrack?.changes_requested_reason && (
        <Alert tone="warning" title="관리자 수정 요청 사유">
          {editingTrack.changes_requested_reason}
        </Alert>
      )}

      <Field label={isEditing ? '오디오 파일 (선택 — 새 파일 업로드 시 교체)' : '오디오 파일 *'}
        hint="mp3 / wav / m4a / flac · 100MB 이하">
        <input
          type="file"
          accept=".mp3,.wav,.m4a,.flac,audio/*"
          onChange={(e) => pickAudio(e.target.files?.[0] ?? null)}
          className="block w-full text-xs text-ink file:mr-3 file:rounded-md file:border-0 file:bg-bg-deep file:px-3 file:py-1.5 file:text-xs file:text-ink hover:file:bg-ink/10"
        />
        {audioFile && (
          <p className="text-[11px] text-ink-mute">
            {audioFile.name} ({Math.round(audioFile.size / 1024 / 1024)}MB)
          </p>
        )}
      </Field>

      <Field label="아티스트명">
        <input
          type="text"
          value={artistOverride}
          onChange={(e) => setArtistOverride(e.target.value)}
          placeholder="(비우면 가입 시 입력한 아티스트명 사용)"
          className="input"
          maxLength={80}
        />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="앨범명 *">
          <input type="text" required value={albumName} onChange={(e) => setAlbumName(e.target.value)} className="input" maxLength={120} />
        </Field>
        <Field label="곡 제목 *">
          <input type="text" required value={title} onChange={(e) => setTitle(e.target.value)} className="input" maxLength={120} />
        </Field>
        <Field label="메인 장르 *">
          <input type="text" required value={mainGenre} onChange={(e) => setMainGenre(e.target.value)} className="input" placeholder="예: pop, rnb, hiphop, lofi" />
        </Field>
        <Field label="서브 장르 *">
          <input type="text" required value={subGenre} onChange={(e) => setSubGenre(e.target.value)} className="input" placeholder="예: ballad, indie, dance pop" />
        </Field>
        <Field label="어울리는 매장 *">
          <select
            required
            value={suitableStore}
            onChange={(e) => setSuitableStore(e.target.value)}
            className="input"
          >
            <option value="">— 선택 —</option>
            {SUITABLE_STORE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </Field>
        <Field label="곡 분위기 *">
          <input type="text" required value={mood} onChange={(e) => setMood(e.target.value)} className="input" placeholder="예: chill, dreamy, upbeat" />
        </Field>
      </div>

      <Field label="가사" hint="(선택)">
        <textarea
          value={lyrics}
          onChange={(e) => setLyrics(e.target.value)}
          rows={4}
          className="input min-h-[80px]"
          maxLength={4000}
        />
      </Field>

      <Field label="커버 이미지" hint="(선택) 정사각형 권장">
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)}
          className="block w-full text-xs text-ink file:mr-3 file:rounded-md file:border-0 file:bg-bg-deep file:px-3 file:py-1.5 file:text-xs file:text-ink hover:file:bg-ink/10"
        />
      </Field>

      {/* 0063 — 발매 정보 */}
      <hr className="border-line/10" />
      <p className="text-[11px] font-bold uppercase tracking-wider text-accent">발매 정보</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="발매 유형 *">
          <select
            required
            value={releaseType}
            onChange={(e) => setReleaseType(e.target.value as 'single' | 'ep' | 'album')}
            className="input"
          >
            <option value="single">싱글 (Single)</option>
            <option value="ep">EP</option>
            <option value="album">정규 앨범 (Album)</option>
          </select>
        </Field>
        <Field
          label="발매일 *"
          hint="검수 및 출시 준비를 위해 최소 3일 뒤부터 선택할 수 있어요"
        >
          <input
            type="date"
            required
            value={releaseDate}
            min={defaultReleaseDate()}
            onChange={(e) => setReleaseDate(e.target.value)}
            className="input"
          />
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex items-start gap-2 rounded-xl bg-bg-soft p-3 ring-1 ring-line/10">
          <input
            type="checkbox"
            checked={explicitContent}
            onChange={(e) => setExplicitContent(e.target.checked)}
            className="mt-0.5"
          />
          <span className="text-xs leading-relaxed">
            <strong>Explicit</strong> · 선정적/폭력적 가사 포함
          </span>
        </label>
        <label className="flex items-start gap-2 rounded-xl bg-bg-soft p-3 ring-1 ring-line/10">
          <input
            type="checkbox"
            checked={instrumental}
            onChange={(e) => setInstrumental(e.target.checked)}
            className="mt-0.5"
          />
          <span className="text-xs leading-relaxed">
            <strong>Instrumental</strong> · 가사 없음
          </span>
        </label>
      </div>

      {/* 정산·권리 정보 */}
      <hr className="border-line/10" />
      <p className="text-[11px] font-bold uppercase tracking-wider text-accent">
        정산·권리 정보
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="발매명 (선택)" hint="비우면 앨범명 그대로 사용">
          <input
            type="text"
            value={releaseTitle}
            onChange={(e) => setReleaseTitle(e.target.value)}
            className="input"
            maxLength={120}
            placeholder="예: 봄날의 EP"
          />
        </Field>
        <Field label="ISRC (선택)" hint="대문자 12자리. 없으면 비워두세요">
          <input
            type="text"
            value={isrc}
            onChange={(e) => setIsrc(e.target.value.toUpperCase())}
            className="input font-mono"
            maxLength={15}
            placeholder="예: KRA012600001"
          />
        </Field>
      </div>
      <Field label="권리자명" hint="비우면 가입 시 입력한 본명 사용">
        <input
          type="text"
          value={rightsHolderName}
          onChange={(e) => setRightsHolderName(e.target.value)}
          className="input"
          maxLength={120}
          placeholder="예: 홍길동 또는 (주)회사명"
        />
      </Field>
      <label className="flex items-start gap-2 rounded-xl bg-bg-soft p-3 ring-1 ring-line/10">
        <input
          type="checkbox"
          checked={rightsConfirmed}
          onChange={(e) => setRightsConfirmed(e.target.checked)}
          className="mt-0.5"
        />
        <span className="text-[12px] leading-relaxed">
          본인은 업로드하는 음원, 이미지, 메타데이터에 대한 권리자이거나, 해당 콘텐츠를
          유통 및 정산 받을 권한을 보유하고 있음을 <strong className="text-accent">확인합니다.</strong>
        </span>
      </label>

      <button type="submit" disabled={busy || !rightsConfirmed} className="btn-primary w-full py-2.5">
        {busy ? '업로드 중…' : '업로드 신청'}
      </button>
      <p className="text-[11px] text-ink-dim">
        업로드된 음원은 <strong className="text-accent">관리자 검수</strong> 후 서비스에 노출됩니다.
        정산용 트랙코드(SRR-TRK-...)는 업로드 시 자동 부여됩니다.
      </p>
    </form>
  );
}

function MyTrackRow({
  track,
  onChanged,
  onEdit,
}: {
  track: MyArtistTrackRow;
  onChanged: () => void | Promise<void>;
  onEdit?: () => void;
}) {
  const status = STATUS_LABEL[track.visibility_status] ?? STATUS_LABEL.pending_review;
  const Icon = status.Icon;
  const canDelete = track.visibility_status === 'pending_review';
  const canEdit =
    track.release_status === 'draft' || track.release_status === 'changes_requested';

  async function onDelete() {
    if (!window.confirm('이 음원을 삭제하시겠어요? (심사 대기 상태에서만 삭제 가능)')) return;
    const res = await deleteMyArtistTrack(track.track_id);
    if (!res.ok) {
      toast.error(res.error ?? '삭제 실패');
      return;
    }
    toast.success('삭제 완료');
    await onChanged();
  }

  return (
    <li className="flex items-center gap-3 border-b border-line/10 p-3 last:border-b-0">
      <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-bg-hover">
        {track.cover_url ? (
          <img src={track.cover_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-ink-dim">
            <Music size={14} />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{track.title}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-mute">
          <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${status.tone}`}>
            <Icon size={9} /> {status.label}
          </span>
          {track.genre && <span className="text-ink-dim">· {track.genre}</span>}
          <span className="text-ink-dim">
            · {new Date(track.created_at).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' })}
          </span>
        </div>
        {track.changes_requested_reason && (
          <p className="mt-1 text-[11px] text-red-700 dark:text-red-300">
            ⚠️ 관리자 수정 요청: {track.changes_requested_reason}
          </p>
        )}
        {!track.changes_requested_reason && track.rejected_reason && (
          <p className="mt-1 text-[11px] text-red-700 dark:text-red-300">
            거절 사유: {track.rejected_reason}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {canEdit && onEdit && (
          <button
            onClick={onEdit}
            className="inline-flex items-center gap-1 rounded-md bg-accent/15 px-2 py-1 text-[11px] font-semibold text-accent ring-1 ring-accent/30 hover:bg-accent/25"
          >
            수정 후 재제출
          </button>
        )}
        {track.audio_url && (
          <audio src={track.audio_url} controls preload="none" className="h-7 max-w-[180px]" />
        )}
        {canDelete && (
          <button
            onClick={onDelete}
            className="rounded-md p-1.5 text-ink-dim hover:bg-red-500/10 hover:text-red-300"
            aria-label="삭제"
            title="삭제 (심사 대기 상태에서만)"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </li>
  );
}

function StreamingAnalyticsSection({
  summary,
  daily,
  loading,
}: {
  summary: ArtistStreamingSummaryRow[];
  daily: ArtistDailyStreamRow[];
  loading: boolean;
}) {
  // 일자별 합계 — 모든 트랙 합산. KST(Asia/Seoul) 기준 일자.
  // daily.day 는 RPC 가 'YYYY-MM-DD' (KST 캘린더) 로 반환.
  const chartData = (() => {
    const map = new Map<string, number>();
    for (const r of daily) {
      map.set(r.day, (map.get(r.day) ?? 0) + r.daily_streams);
    }
    // 최근 30일 KST 캘린더 키 채우기 (0 으로 시각화)
    const kstFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }); // YYYY-MM-DD
    const out: { day: string; streams: number; label: string }[] = [];
    const now = Date.now();
    const DAY_MS = 24 * 3600 * 1000;
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now - i * DAY_MS);
      const key = kstFmt.format(d); // 'YYYY-MM-DD' in KST
      const [, mm, dd] = key.split('-');
      out.push({
        day: key,
        streams: map.get(key) ?? 0,
        label: `${mm}/${dd}`,
      });
    }
    return out;
  })();

  // 전체 합계 KPI
  const totals = summary.reduce(
    (acc, r) => {
      acc.total += r.total_streams;
      acc.today += r.today_streams;
      acc.last_7d += r.last_7d_streams;
      acc.last_30d += r.last_30d_streams;
      return acc;
    },
    { total: 0, today: 0, last_7d: 0, last_30d: 0 },
  );

  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-2">
        <h2 className="flex items-center gap-1.5 text-lg font-bold tracking-tight">
          <BarChart3 size={16} className="text-accent" /> 스트리밍 분석
        </h2>
        <span className="text-xs text-ink-mute">최근 30일</span>
      </div>

      {/* KPI 4종 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi label="누적" value={totals.total} />
        <Kpi label="오늘" value={totals.today} />
        <Kpi label="최근 7일" value={totals.last_7d} />
        <Kpi label="최근 30일" value={totals.last_30d} />
      </div>

      {/* 일별 라인차트 */}
      <div className="rounded-2xl bg-bg-card p-3 ring-1 ring-line/10">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-ink-mute">
          <TrendingUp size={12} /> 일별 스트리밍 (milestone_30s 기준)
        </p>
        {loading ? (
          <div className="h-[180px] animate-pulse rounded-md bg-bg-hover" />
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.5)' }}
                interval={Math.max(1, Math.floor(chartData.length / 6))}
              />
              <YAxis
                tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.5)' }}
                allowDecimals={false}
                width={28}
              />
              <Tooltip
                contentStyle={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', fontSize: 11 }}
                labelStyle={{ color: 'rgba(255,255,255,0.6)' }}
              />
              <Line
                type="monotone"
                dataKey="streams"
                stroke="rgb(var(--color-accent))"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* 곡별 표 */}
      <div className="overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line/10 text-[11px] uppercase tracking-wider text-ink-dim">
                <th className="px-3 py-2.5 text-left font-semibold">곡</th>
                <th className="px-3 py-2.5 text-right font-semibold">누적</th>
                <th className="px-3 py-2.5 text-right font-semibold">오늘</th>
                <th className="px-3 py-2.5 text-right font-semibold">7일</th>
                <th className="px-3 py-2.5 text-right font-semibold">30일</th>
                <th className="px-3 py-2.5 text-right font-semibold">마지막 재생</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-xs text-ink-mute">
                    불러오는 중…
                  </td>
                </tr>
              )}
              {!loading && summary.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-xs text-ink-mute">
                    아직 스트리밍 데이터가 없어요.
                  </td>
                </tr>
              )}
              {summary.map((r) => (
                <tr key={r.track_id} className="border-b border-line/10 last:border-b-0">
                  <td className="px-3 py-2 text-sm">
                    <p className="truncate font-medium">{r.title}</p>
                    <p className="text-[10px] text-ink-dim">
                      {r.visibility_status === 'approved'
                        ? '✓ 공개'
                        : r.visibility_status === 'pending_review'
                          ? '심사 대기'
                          : r.visibility_status === 'rejected'
                            ? '거절됨'
                            : '숨김'}
                    </p>
                  </td>
                  <td className="px-3 py-2 text-right text-sm font-semibold tabular-nums">
                    {r.total_streams.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums">
                    {r.today_streams.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums">
                    {r.last_7d_streams.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums">
                    {r.last_30d_streams.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right text-[11px] text-ink-mute">
                    {r.last_played_at
                      ? new Date(r.last_played_at).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' })
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-ink-dim">
        집계 기준: <code className="font-mono">stream_events.event_type='milestone_30s'</code> (트랙당 세션당 1회).
        일간 기준: <strong>한국시간(KST, Asia/Seoul)</strong>.
      </p>
    </section>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-bg-card p-3 ring-1 ring-line/10">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-dim">{label}</p>
      <p className="mt-0.5 text-xl font-extrabold tabular-nums">{value.toLocaleString()}</p>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-[11px] font-semibold uppercase tracking-wider text-ink-mute">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-ink-dim">{hint}</span>}
    </label>
  );
}
