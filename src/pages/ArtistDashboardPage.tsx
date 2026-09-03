import { useCallback, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
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
  ChevronDown,
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useFreshFetch } from '@/hooks/useFreshFetch';
import { fetchMyTrackQcReport, type MyTrackQcRow } from '@/lib/audioQcGuideApi';
import { friendlyError } from '@/lib/errorMessages';
import TrackQcBadge from '@/components/artist/TrackQcBadge';
import TrackQcDetailModal from '@/components/artist/TrackQcDetailModal';
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
  fetchMyPayoutAccountMasked,
  submitArtistPayoutAccountV2,
  fetchMySettlementHoldStatus,
  TAX_CONSENT_TEXT,
  type ArtistProfile,
  type MyArtistTrackRow,
  type ArtistStreamingSummaryRow,
  type ArtistDailyStreamRow,
  type UploadEligibility,
  type PayoutAccount,
  type PayoutAccountMasked,
  type TaxWithholdingType,
  type SettlementHoldStatus,
  type SettlementHoldReason,
} from '@/lib/artistApi';
import { createPayappSubscription } from '@/lib/subscriptionApi';
import { useArtistBillingAccess } from '@/hooks/useArtistBillingAccess';
import { fetchMyArtistPlan, type ArtistPlanInfo, planBadgeTone } from '@/lib/artistPlanApi';
import { CreditCard, Wallet, FileSignature, GraduationCap, Music2, Shield } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { BarChart3, TrendingUp } from 'lucide-react';
import SupportInquiryButton from '@/components/SupportInquiryButton';
import { toast } from '@/store/toastStore';
import Alert from '@/components/Alert';
import ArtistBatchUploadForm from '@/components/artist/ArtistBatchUploadForm';
import UploadDebugPanel from '@/components/artist/UploadDebugPanel';
import TrackMetaSelectors from '@/components/artist/TrackMetaSelectors';
import {
  emptySelectedMeta, validateSelectedMeta, setTrackSelectedMetadata, type SelectedMeta,
} from '@/lib/trackMetadataOptions';

import type { LucideIcon } from 'lucide-react';

// 긴급 hotfix — /15 alpha + text-*-200 는 WCAG AA fail. /25 + text-*-100 으로 강화.
const STATUS_LABEL: Record<string, { label: string; tone: string; Icon: LucideIcon }> = {
  pending_review: { label: '심사 대기', tone: 'bg-yellow-500/25 text-slate-900 dark:text-yellow-100 ring-1 ring-yellow-400/40', Icon: Clock },
  approved: { label: '승인됨', tone: 'bg-emerald-500/25 text-slate-900 dark:text-emerald-100 ring-1 ring-emerald-400/40', Icon: CheckCircle2 },
  rejected: { label: '거절됨', tone: 'bg-red-500/25 text-slate-900 dark:text-red-100 ring-1 ring-red-400/40', Icon: XCircle },
  hidden: { label: '숨김', tone: 'bg-ink/15 text-ink ring-1 ring-line/20', Icon: EyeOff },
};

export default function ArtistDashboardPage() {
  const { user, profile, loading: authLoading } = useAuthStore();
  // RESUME-PAUSED-SUBSCRIPTION-1 — 정지(해지) 상태면 결제 카드 문구를 '재개' 로 바꾼다.
  const { access: billingAccess } = useArtistBillingAccess(true);
  // ARTIST-BILLING-ACCESS-ENFORCEMENT — 결제 제한 배너는 공통 ArtistLayout 최상단에서
  // 렌더된다. 업로드/유통 신청 클릭 시 서버 pre-check(uploadArtistTrack)가 billing_required
  // 를 반환하면 아래 handleSubmit 에서 결제 페이지로 안내한다.
  const [artist, setArtist] = useState<ArtistProfile | null>(null);
  const [tracks, setTracks] = useState<MyArtistTrackRow[]>([]);
  // X6.36 — 본인 트랙 QC 리포트 (track_id → row)
  const [qcMap, setQcMap] = useState<Map<string, MyTrackQcRow>>(new Map());
  // X6.37 — QC 상세 모달 (선택된 트랙)
  const [qcDetailTrack, setQcDetailTrack] = useState<{ id: string; title: string } | null>(null);
  const [summary, setSummary] = useState<ArtistStreamingSummaryRow[]>([]);
  const [daily, setDaily] = useState<ArtistDailyStreamRow[]>([]);
  const [eligibility, setEligibility] = useState<UploadEligibility | null>(null);
  const [payout, setPayout] = useState<PayoutAccount | null>(null);
  // X6.14 — RRN 등 PII 포함된 마스킹 정보 (본인 화면용)
  const [payoutMasked, setPayoutMasked] = useState<PayoutAccountMasked | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingTrack, setEditingTrack] = useState<MyArtistTrackRow | null>(null);
  // ARTIST-HIDE-REJECTED — 거절(탈락) 음원은 기본 접힘. "펼치기"로만 노출.
  const [showRejected, setShowRejected] = useState(false);
  const [plan, setPlan] = useState<ArtistPlanInfo | null>(null);
  // X6.16 — 정산 보류 상태
  const [holdStatus, setHoldStatus] = useState<SettlementHoldStatus | null>(null);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const [ap, ts, sm, dl, el, po, pom, pl, hs, qc] = await Promise.all([
        fetchMyArtistProfile(user.id),
        fetchMyArtistTracks(),
        fetchArtistStreamingSummary(),
        fetchArtistDailyStreams(30),
        fetchArtistUploadEligibility(),
        fetchMyPayoutAccount(user.id),
        fetchMyPayoutAccountMasked(),
        fetchMyArtistPlan(),
        fetchMySettlementHoldStatus(),
        // X6.36 — QC report fetch 실패해도 다른 데이터 영향 없음
        fetchMyTrackQcReport(100).catch(() => [] as MyTrackQcRow[]),
      ]);
      setArtist(ap);
      setTracks(ts);
      setQcMap(new Map(qc.map((r) => [r.track_id, r])));
      setSummary(sm);
      setDaily(dl);
      setEligibility(el);
      setPayout(po);
      setPayoutMasked(pom);
      setPlan(pl);
      setHoldStatus(hs);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useFreshFetch(load, [user?.id]);

  // 로그인 안 됨
  if (!authLoading && !user) return <Navigate to="/login" replace />;
  // source of truth = artist_profiles. account_type 은 미러일 뿐이므로 단독으로 차단하지 않는다.
  // 프로필 로딩이 끝났는데도 아티스트 프로필이 없고 account_type 도 artist 가 아닐 때만 차단
  // (미러가 깨진 승인 아티스트가 대시보드에서 튕기지 않도록 보호).
  if (!authLoading && !loading && !artist && profile && profile.account_type !== 'artist') {
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
        <div className="ml-auto">
          <SupportInquiryButton variant="chip" defaultType="음원 등록 문의" />
        </div>
      </header>

      {/* 플랜 배지 */}
      {plan && <ArtistPlanCard plan={plan} />}

      {/* X6.16 / X6.17 — 정산 보류 안내 (사유별 정확한 CTA 라우팅) */}
      {holdStatus && holdStatus.is_held && (
        <SettlementHoldCard
          status={holdStatus}
          eligibility={eligibility}
          payout={payout}
        />
      )}

      {/* X6.18 — 정산 정보 입력 폼: UploadGate 의존성 제거.
          payout 미verified 면 항상 노출 → 보류 카드 CTA 스크롤이 항상 작동. */}
      {!loading && payout?.verification_status !== 'verified' && (
        <PayoutAccountSection
          payout={payout}
          masked={payoutMasked}
          onSubmitted={load}
        />
      )}

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
          payoutMasked={payoutMasked}
          billingPaused={billingAccess?.reason === 'cancelled'}
          userEmail={user?.email ?? ''}
          plan={plan}
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

      {/* 내 음원 목록 — 거절(탈락) 음원은 기본 접힘 */}
      {(() => {
        const rejectedTracks = tracks.filter((t) => t.visibility_status === 'rejected');
        const activeTracks = tracks.filter((t) => t.visibility_status !== 'rejected');
        const renderRow = (t: MyArtistTrackRow) => (
          <MyTrackRow
            key={t.track_id}
            track={t}
            qc={qcMap.get(t.track_id) ?? null}
            onChanged={load}
            onEdit={() => {
              setEditingTrack(t);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            onOpenQcDetail={() => setQcDetailTrack({ id: t.track_id, title: t.title })}
          />
        );
        return (
          <section className="space-y-3">
            <div className="flex items-baseline gap-2">
              <h2 className="text-lg font-bold tracking-tight">내 음원 ({activeTracks.length})</h2>
              <span className="text-xs text-ink-mute">최신순</span>
            </div>
            {loading ? (
              <div className="space-y-2">
                {[0, 1].map((i) => (
                  <div key={i} className="h-16 animate-pulse rounded-xl bg-bg-card" />
                ))}
              </div>
            ) : activeTracks.length === 0 && rejectedTracks.length === 0 ? (
              <p className="rounded-2xl bg-bg-card/60 p-6 text-center text-sm text-ink-mute ring-1 ring-line/10">
                아직 업로드한 음원이 없어요.
              </p>
            ) : (
              <>
                {activeTracks.length > 0 ? (
                  <ul className="overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10">
                    {activeTracks.map(renderRow)}
                  </ul>
                ) : (
                  <p className="rounded-2xl bg-bg-card/60 p-6 text-center text-sm text-ink-mute ring-1 ring-line/10">
                    표시할 음원이 없어요. (거절된 음원은 아래에서 확인할 수 있어요.)
                  </p>
                )}

                {/* 거절(탈락) 음원 — 기본 접힘, 펼치기로만 노출 */}
                {rejectedTracks.length > 0 && (
                  <div className="rounded-2xl bg-bg-card/50 ring-1 ring-line/10">
                    <button
                      type="button"
                      onClick={() => setShowRejected((v) => !v)}
                      aria-expanded={showRejected}
                      className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
                    >
                      <span className="flex items-center gap-2 text-sm font-semibold text-ink-mute">
                        <EyeOff size={14} />
                        거절된 음원 {rejectedTracks.length}개
                      </span>
                      <span className="flex items-center gap-1 text-xs text-ink-mute">
                        {showRejected ? '숨기기' : '펼치기'}
                        <ChevronDown
                          size={14}
                          className={`transition-transform ${showRejected ? 'rotate-180' : ''}`}
                        />
                      </span>
                    </button>
                    {showRejected && (
                      <ul className="overflow-hidden border-t border-line/10">
                        {rejectedTracks.map(renderRow)}
                      </ul>
                    )}
                  </div>
                )}
              </>
            )}
          </section>
        );
      })()}

      {/* X6.37 — QC 상세 모달 */}
      {qcDetailTrack && (
        <TrackQcDetailModal
          trackId={qcDetailTrack.id}
          trackTitle={qcDetailTrack.title}
          onClose={() => setQcDetailTrack(null)}
        />
      )}
    </div>
  );
}

function ArtistPlanCard({ plan }: { plan: ArtistPlanInfo }) {
  const isPro = plan.is_verified_pro;
  const isGeneral = plan.plan_type === 'general_artist';
  const Icon = isPro ? GraduationCap : isGeneral ? Music2 : Shield;
  return (
    <div className={`rounded-2xl p-4 ring-1 ${planBadgeTone(plan.plan_type)}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon size={18} />
          <div>
            <div className="flex items-center gap-1.5">
              <h2 className="text-sm font-bold">{plan.plan_label}</h2>
              {isPro && (
                <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-slate-900 dark:text-emerald-200">
                  VERIFIED
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[11px] opacity-80">
              월 업로드 한도 <strong className="font-bold">{plan.monthly_quota}곡</strong>
              {!plan.can_create_playlist && ' · 플리/큐레이터 제한'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ApprovalStatusCard({ artist }: { artist: ArtistProfile | null }) {
  if (!artist) {
    return (
      <div className="rounded-2xl bg-yellow-500/20 p-4 ring-1 ring-yellow-500/30">
        <p className="text-sm font-bold text-slate-900 dark:text-yellow-200">아티스트 프로필이 없습니다</p>
        <p className="mt-1 text-xs text-slate-700 dark:text-yellow-100/80">
          회원가입 시 아티스트 정보가 저장되지 않았을 수 있어요. 고객센터로 문의해주세요.
        </p>
      </div>
    );
  }
  if (artist.approval_status === 'pending') {
    return (
      <div className="rounded-2xl bg-yellow-500/20 p-4 ring-1 ring-yellow-500/30">
        <p className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-yellow-200">
          <Clock size={14} /> 관리자 승인 대기 중입니다
        </p>
        <p className="mt-1 text-xs text-slate-700 dark:text-yellow-100/80">
          승인이 완료되면 음원 등록이 가능합니다. 평균 1영업일 이내 처리됩니다.
        </p>
      </div>
    );
  }
  if (artist.approval_status === 'rejected') {
    return (
      <Alert tone="error" title="승인이 거절되었습니다">
        {artist.rejected_reason && (
          <p className="mt-1 text-xs opacity-85">사유: {artist.rejected_reason}</p>
        )}
        <p className="mt-2 text-xs opacity-70">
          이의가 있으신가요?{' '}
          <a
            href="mailto:freemilesarea@gmail.com?subject=아티스트 승인 재신청"
            className="underline"
          >
            고객센터 문의
          </a>
        </p>
      </Alert>
    );
  }
  return (
    <div className="rounded-2xl bg-emerald-500/20 p-4 ring-1 ring-emerald-500/30">
      <p className="flex items-center gap-2 text-sm font-bold text-emerald-300">
        <CheckCircle2 size={14} /> 승인 완료
      </p>
      <p className="mt-1 text-xs text-slate-700 dark:text-emerald-100/80">
        음원을 업로드할 수 있어요. 업로드한 곡은 관리자 검수 후 공개됩니다.
      </p>
    </div>
  );
}

function UploadGate({
  eligibility,
  payout,
  payoutMasked,
  billingPaused,
  userEmail,
  plan,
  editingTrack,
  onCancelEdit,
  onUploaded,
  onPayoutSubmitted,
}: {
  eligibility: UploadEligibility | null;
  payout: PayoutAccount | null;
  payoutMasked: PayoutAccountMasked | null;
  /** 이전에 결제한 이력이 있고 지금은 정지(해지) 상태 — 재결제 문구 분기용. */
  billingPaused: boolean;
  userEmail: string;
  plan: ArtistPlanInfo | null;
  editingTrack?: MyArtistTrackRow | null;
  onCancelEdit?: () => void;
  onUploaded: () => void | Promise<void>;
  onPayoutSubmitted: () => void | Promise<void>;
}) {
  if (!eligibility) {
    return <div className="h-24 animate-pulse rounded-2xl bg-bg-card" />;
  }

  // RESUME-PAUSED-SUBSCRIPTION-1 — 결제 확인은 서버 판정(has_paid_membership) 하나만
  // 신뢰한다. 0495 이후 이 값은 실제 게이트(artist_has_paid_access)와 동일하다.
  // membership_tier 를 OR 로 얹으면 해지 유예기간 동안 "결제됨" 으로 보여서, 유통은
  // 0467 트리거에 막히는데 재결제 카드는 뜨지 않는 교착이 생긴다.
  const isPaid = eligibility.has_paid_membership === true;

  if (!isPaid) {
    return <PaymentRequiredCard userEmail={userEmail} plan={plan} paused={billingPaused} />;
  }

  // 계약 단계 게이트 (0057). RPC 결과가 없는 환경(0057 미적용)에서는 통과 처리.
  if (
    eligibility.has_signed_contract === false ||
    (eligibility.contract_status && eligibility.contract_status !== 'signed')
  ) {
    return <ContractRequiredCard contractStatus={eligibility.contract_status ?? 'not_created'} />;
  }

  // X6.18 — 정산 정보 입력 폼은 부모(ArtistDashboardPage)가 직접 렌더링.
  // UploadGate 는 verified 여부만 체크해서 안내만 표시 (중복 폼 차단).
  const isPayoutVerified = payout?.verification_status === 'verified';
  if (!isPayoutVerified) {
    return (
      <div className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
        <p className="text-sm font-semibold">정산 정보 등록 후 음원 업로드가 가능해요</p>
        <p className="mt-1 text-xs text-ink-mute">
          위 정산 정보 입력 폼을 작성하면 관리자 검토 후 업로드 권한이 활성화됩니다.
        </p>
      </div>
    );
  }
  // payoutMasked 는 verified 후 안내 카드/요약 표시에 사용
  void onPayoutSubmitted;

  // 모두 OK — 업로드 폼 + (참고용) 계좌 요약 카드
  // 재제출 모드(editingTrack)는 무조건 단일 업로드. 신규는 단일/일괄 토글.
  return (
    <>
      <VerifiedPayoutSummary payout={payout} masked={payoutMasked} />
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
      <UploadDebugPanel />
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

function VerifiedPayoutSummary({
  payout,
  masked: maskedAcct,
}: {
  payout: PayoutAccount | null;
  masked: PayoutAccountMasked | null;
}) {
  if (!payout) return null;
  const masked = maskAccountNumber(payout.account_number);

  // 계좌 인증(verification_status)과 지급 요건(실명·주민번호·원천징수 동의)은 별개다.
  // 구 폼으로 계좌만 등록한 사용자는 verified 지만 지급이 보류되므로,
  // '확인 완료' 로 표시하면 "다 됐는데 왜 입금이 안 되지" 로 이어진다.
  const piiIncomplete = maskedAcct != null && !maskedAcct.is_pii_complete;

  if (piiIncomplete) {
    return (
      <div className="flex items-center gap-3 rounded-2xl bg-amber-500/20 p-3 ring-1 ring-amber-500/30">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-300">
          <Wallet size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-slate-900 dark:text-amber-200">
            정산 정보 추가 입력이 필요합니다
          </p>
          <p className="text-[11px] text-slate-700 dark:text-amber-100/80">
            계좌는 등록됐지만 실명·주민등록번호·원천징수 동의가 없어 <strong>정산금 지급이 보류</strong>됩니다.
            아래 정산 탭에서 마저 입력해주세요.
          </p>
          <p className="mt-0.5 truncate text-[11px] text-slate-600 dark:text-amber-100/60">
            {payout.bank_name} · {masked} · {payout.account_holder}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-emerald-500/20 p-3 ring-1 ring-emerald-500/30">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300">
        <Wallet size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-slate-900 dark:text-emerald-200">정산 계좌 확인 완료</p>
        <p className="truncate text-[11px] text-slate-700 dark:text-emerald-100/80">
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
      '결제는 완료됐어요. 아래 버튼을 누르면 계약서가 자동 발행되며, 본문을 확인 후 동의·서명할 수 있어요.',
    pending_signature:
      '계약서가 발행됐어요. 본문을 확인하고 동의·서명을 완료하면 음원 등록 단계로 진행할 수 있어요.',
    signed: '서명 완료. 다음 단계로 이동하는 중…',
    rejected:
      '이전 계약을 거절하셨어요. 음원 등록을 진행하려면 관리자에게 재발행을 요청해주세요.',
    expired:
      '계약 서명 기한이 만료됐어요. 관리자에게 재발행을 요청해주세요.',
  };

  return (
    <div id="contract-required" className="space-y-3 rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
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
      {(contractStatus === 'pending_signature' || contractStatus === 'not_created') && (
        <Link to="/artist/contract" className="btn-primary block w-full py-2.5 text-center">
          {contractStatus === 'not_created' ? '계약서 발행 + 확인' : '계약서 확인 및 서명'}
        </Link>
      )}
      {(contractStatus === 'rejected' || contractStatus === 'expired') && (
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

function PaymentRequiredCard({
  userEmail,
  plan,
  paused = false,
}: {
  userEmail: string;
  plan: ArtistPlanInfo | null;
  /** 정지(해지) 후 재개 흐름이면 문구를 '다시 시작' 으로 바꾼다. */
  paused?: boolean;
}) {
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);

  // X6.22 — get_my_artist_plan 결과 기준 결제 금액/플랜 단일 진입점.
  // plan 미로딩 시 legacy individual 4900 으로 폴백.
  const priceWon = plan?.monthly_price ?? 4900;
  const paymentPlanType = plan?.payment_plan_type ?? 'individual';
  const isPro = plan?.is_verified_pro === true;
  const isGeneralArtist = plan?.plan_type === 'general_artist';

  // 헤드라인 / 안내 문구 동적
  const resumeHeading = `유통 재개 — 월 ${priceWon.toLocaleString('ko-KR')}원 요금제 다시 결제`;
  const resumeDescription =
    `구독이 정지된 상태라 음원 등록·유통 신청이 제한돼요. 이전 요금제 기간이 끝나기를 기다릴 필요 없이 ` +
    `지금 바로 다시 결제하면 즉시 이어서 진행할 수 있어요. 결제하는 시점부터 새 결제 주기(1개월)가 시작됩니다.`;
  const heading = isPro
    ? `음원 업로드 — 월 ${priceWon.toLocaleString('ko-KR')}원 수강생 PRO 요금제 결제`
    : `음원 업로드 — 월 ${priceWon.toLocaleString('ko-KR')}원 요금제 결제`;
  const description = isPro
    ? `수강생 아티스트 PRO 정기이용권(월 ${priceWon.toLocaleString('ko-KR')}원) 결제 후 이용할 수 있어요. 결제 완료 후 자동으로 업로드 권한이 활성화됩니다.`
    : isGeneralArtist
    ? `일반 아티스트 정기이용권(월 ${priceWon.toLocaleString('ko-KR')}원) 결제 후 이용할 수 있어요. 결제 완료 후 자동으로 업로드 권한이 활성화됩니다.`
    : `듣다 정기이용권(월 ${priceWon.toLocaleString('ko-KR')}원) 결제 후 이용할 수 있어요. 결제 완료 후 자동으로 업로드 권한이 활성화됩니다.`;

  async function onPay() {
    if (phone.replace(/\D/g, '').length < 9) {
      toast.error('알림 받을 휴대폰 번호를 입력해주세요');
      return;
    }
    setBusy(true);
    try {
      const res = await createPayappSubscription({
        plan_type: paymentPlanType,
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
    <div id="payment-required" className="space-y-3 rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
          <CreditCard size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold">{paused ? resumeHeading : heading}</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-mute">
            {paused ? resumeDescription : description}
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
        {busy
          ? '결제창 준비중…'
          : paused
            ? `PayApp 으로 ${priceWon.toLocaleString('ko-KR')}원 결제하고 바로 재개하기`
            : `PayApp 으로 ${priceWon.toLocaleString('ko-KR')}원 결제하기`}
      </button>
      <p className="text-[11px] text-ink-dim">
        결제 사용자: {userEmail} · 매월 자동 결제 · 마이페이지에서 즉시 해지 가능
      </p>
    </div>
  );
}

function PayoutAccountSection({
  payout,
  masked,
  onSubmitted,
}: {
  payout: PayoutAccount | null;
  masked: PayoutAccountMasked | null;
  onSubmitted: () => void | Promise<void>;
}) {
  const [legalName, setLegalName] = useState(masked?.legal_name ?? '');
  const [residentNumber, setResidentNumber] = useState('');
  const [bankName, setBankName] = useState(payout?.bank_name ?? '');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountHolder, setAccountHolder] = useState(payout?.account_holder ?? '');
  const [taxType, setTaxType] = useState<TaxWithholdingType>(
    masked?.tax_withholding_type ?? 'business_income_3_3',
  );
  const [consentChecked, setConsentChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = payout?.verification_status;
  // 폼 노출 조건 (X6.14):
  //   - PII 미완료 (legal_name/rrn/계좌/동의 중 하나라도 없음) → 폼 표시
  //   - 반려됨 → 폼 표시
  //   - verified → 호출되지 않음
  const showForm = !masked || !masked.is_pii_complete || status === 'rejected';

  function formatRrn(raw: string): string {
    // 숫자만 추출 후 6-7 형식으로 표시
    const d = raw.replace(/\D/g, '').slice(0, 13);
    return d.length > 6 ? `${d.slice(0, 6)}-${d.slice(6)}` : d;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!legalName.trim()) return setError('실명을 입력해주세요');
    const rrnDigits = residentNumber.replace(/\D/g, '');
    if (rrnDigits.length !== 13) return setError('주민등록번호 13자리를 정확히 입력해주세요');
    if (!bankName.trim() || !accountNumber.trim() || !accountHolder.trim()) {
      return setError('은행명 / 계좌번호 / 예금주를 모두 입력해주세요');
    }
    if (!consentChecked) return setError('수집·이용 동의가 필요합니다');

    setBusy(true);
    try {
      const res = await submitArtistPayoutAccountV2({
        legal_name: legalName,
        resident_registration_number: rrnDigits,
        bank_name: bankName,
        account_number: accountNumber,
        account_holder: accountHolder,
        tax_consent_text: TAX_CONSENT_TEXT,
        tax_withholding_type: taxType,
      });
      if (!res.ok) {
        setError(res.error ?? '계좌 등록 실패');
        toast.error(res.error ?? '계좌 등록 실패');
        return;
      }
      // 입력 RRN/계좌 즉시 폐기 (메모리에 남기지 않음)
      setResidentNumber('');
      setAccountNumber('');
      toast.success('정산 계좌가 등록됐어요. 관리자 확인 후 업로드가 활성화됩니다.');
      await onSubmitted();
    } catch (e) {
      const msg = friendlyError(e, '계좌 등록 실패');
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
      ? { label: '반려됨', tone: 'bg-red-500/25 text-slate-900 dark:text-red-100 ring-1 ring-red-400/40' }
      : status === 'pending'
        ? { label: '확인 대기 중', tone: 'bg-yellow-500/25 text-slate-900 dark:text-yellow-100 ring-1 ring-yellow-400/40' }
        : null;

  return (
    <form id="payout-account-form" onSubmit={onSubmit} className="space-y-3 rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
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

      {/* pending 상태: 마스킹된 PII 정보 표시 (재등록은 verified 전까지 불가) */}
      {status === 'pending' && masked && masked.is_pii_complete && (
        <div className="space-y-1 rounded-lg bg-bg-deep/50 p-3 text-[12px] ring-1 ring-line/10">
          <Row2 label="실명" value={masked.legal_name ?? '—'} />
          <Row2 label="주민번호" value={masked.masked_rrn ?? '—'} />
          <Row2 label="은행" value={masked.bank_name} />
          <Row2 label="계좌번호" value={masked.masked_account_number} />
          <Row2 label="예금주" value={masked.account_holder} />
          <Row2 label="원천징수" value={taxWithholdingLabel(masked.tax_withholding_type)} />
          <Row2 label="동의" value={masked.has_tax_consent ? '✓ 완료' : '미동의'} />
          <p className="pt-1 text-[11px] text-ink-dim">
            관리자 확인이 완료되면 이 화면 대신 업로드 폼이 표시됩니다.
          </p>
        </div>
      )}

      {/* 신규 등록 / 반려 후 재등록 / PII 미완료 보완 */}
      {showForm && (
        <>
          <Field label="실명 (주민등록상) *">
            <input
              type="text"
              required
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              placeholder="홍길동"
              className="input"
              autoComplete="name"
            />
          </Field>

          <Field
            label="주민등록번호 * (13자리)"
            hint="평문 저장하지 않으며 암호화되어 보관됩니다. 본인 화면에서도 다시 표시되지 않습니다."
          >
            <input
              type="password"
              required
              value={residentNumber}
              onChange={(e) => setResidentNumber(formatRrn(e.target.value))}
              placeholder="000000-0000000"
              className="input font-mono"
              inputMode="numeric"
              autoComplete="off"
              maxLength={14}
            />
          </Field>

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
              className="input font-mono"
              inputMode="numeric"
              autoComplete="off"
            />
          </Field>

          <Field label="원천징수 유형 *">
            <select
              value={taxType}
              onChange={(e) => setTaxType(e.target.value as TaxWithholdingType)}
              className="input"
            >
              <option value="business_income_3_3">사업소득 (3.3%)</option>
              <option value="other_income_8_8">기타소득 (8.8%)</option>
              <option value="none">원천징수 없음</option>
            </select>
          </Field>

          {/* X6.14 — 수집·이용 동의 */}
          <div className="rounded-lg bg-bg-deep/40 p-3 text-[11px] ring-1 ring-line/10">
            <p className="font-semibold text-ink">PII 수집·이용 동의 (필수)</p>
            <p className="mt-1 leading-relaxed text-ink-mute">
              {TAX_CONSENT_TEXT}
            </p>
            <label className="mt-2 flex items-start gap-2">
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
                className="mt-0.5"
              />
              <span className="text-ink">위 내용에 동의합니다.</span>
            </label>
          </div>

          {error && <Alert tone="error">{error}</Alert>}

          <button
            type="submit"
            disabled={busy || !consentChecked}
            className="btn-primary w-full py-2.5"
          >
            {busy ? '등록 중…' : status === 'rejected' ? '정산 계좌 다시 등록' : '정산 계좌 등록'}
          </button>
          <p className="text-[11px] text-ink-dim">
            등록 후 관리자 확인까지 평균 1영업일이 소요됩니다.
          </p>
        </>
      )}
    </form>
  );
}

function taxWithholdingLabel(t: TaxWithholdingType): string {
  switch (t) {
    case 'business_income_3_3': return '사업소득 3.3%';
    case 'other_income_8_8': return '기타소득 8.8%';
    case 'none': return '없음';
    default: return t;
  }
}

const HOLD_REASON_LABEL: Record<SettlementHoldReason, { title: string; desc: string }> = {
  identity_not_verified: {
    title: '본인인증 미완료',
    desc: '내 정보 → 본인인증을 완료해주세요.',
  },
  account_missing: {
    title: '정산계좌 미등록',
    desc: '본인 명의의 은행 계좌 정보를 등록해주세요.',
  },
  rrn_missing: {
    title: '주민등록번호 미등록',
    desc: '원천징수 신고를 위해 주민등록번호 + 동의가 필요합니다.',
  },
  account_not_verified: {
    title: '계좌 검증 미완료',
    desc: '관리자 검토 대기 중입니다. 평균 1영업일.',
  },
};

/**
 * scrollToIdOrToast — 해당 id 요소가 DOM 에 있으면 스크롤, 없으면 toast.
 * silent no-op 방지 (X6.17).
 */
function scrollToIdOrToast(id: string, fallbackMessage: string): void {
  const el = document.getElementById(id);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else {
    if (import.meta.env.DEV) console.warn(`[SettlementHoldCard] scroll target #${id} not in DOM`);
    toast.info(fallbackMessage);
  }
}

interface HoldPrimaryAction {
  label: string;
  variant: 'primary' | 'disabled';
  onClick: () => void;
}

/**
 * 우선순위 결정 (앞쪽이 먼저 차단되는 단계):
 *   1. 결제 미완료      → #payment-required 로 스크롤
 *   2. 계약 미서명      → #contract-required 로 스크롤
 *   3. 본인인증 미완료  → /profile 라우팅
 *   4. 계좌 검증 대기   → toast (검토 대기 중)
 *   5. RRN/계좌 누락    → #payout-account-form 로 스크롤
 */
function computeHoldPrimaryAction(
  status: SettlementHoldStatus,
  eligibility: UploadEligibility | null,
  payout: PayoutAccount | null,
  navigate: (to: string) => void,
): HoldPrimaryAction {
  const reasons = new Set(status.hold_reasons);

  // RESUME-PAUSED-SUBSCRIPTION-1 — UploadGate 와 동일 기준(서버 판정)만 사용.
  const isPaid = eligibility?.has_paid_membership === true;
  if (!isPaid) {
    return {
      label: '결제 진행하기',
      variant: 'primary',
      onClick: () => scrollToIdOrToast(
        'payment-required',
        '음원 등록 결제를 먼저 완료해주세요.',
      ),
    };
  }

  const contractOk =
    eligibility?.has_signed_contract !== false &&
    (!eligibility?.contract_status || eligibility.contract_status === 'signed');
  if (!contractOk) {
    return {
      label: '계약 진행하기',
      variant: 'primary',
      onClick: () => scrollToIdOrToast(
        'contract-required',
        '계약 서명을 먼저 완료해주세요.',
      ),
    };
  }

  if (reasons.has('identity_not_verified')) {
    return {
      label: '본인인증 하러가기',
      variant: 'primary',
      // X6.18: 큐레이터 프로필이 아닌 내 정보의 본인인증 섹션으로 이동.
      // ProfilePage 의 useLayoutEffect 가 hash 를 보고 #identity-verification 으로 스크롤.
      onClick: () => navigate('/profile#identity-verification'),
    };
  }

  // account_not_verified 는 폼이 이미 제출된 상태 — 관리자 검토 대기
  if (
    reasons.has('account_not_verified') &&
    !reasons.has('rrn_missing') &&
    !reasons.has('account_missing')
  ) {
    return {
      label: '검토 대기 중',
      variant: 'disabled',
      onClick: () => toast.info(
        '정산 정보는 제출되었습니다. 관리자 검토를 기다려주세요. (평균 1영업일)',
      ),
    };
  }

  // X6.18: 사유별로 라벨을 명확히. account_missing 우선 (계좌가 더 기본 단위).
  if (reasons.has('account_missing')) {
    return {
      label: '정산계좌 등록하기',
      variant: 'primary',
      onClick: () => scrollToIdOrToast(
        'payout-account-form',
        '정산 정보 입력 폼을 찾을 수 없어요. 화면을 새로고침해 주세요.',
      ),
    };
  }
  if (reasons.has('rrn_missing')) {
    return {
      label: '주민등록번호 등록하기',
      variant: 'primary',
      onClick: () => scrollToIdOrToast(
        'payout-account-form',
        '정산 정보 입력 폼을 찾을 수 없어요. 화면을 새로고침해 주세요.',
      ),
    };
  }

  // fallback (정의되지 않은 사유 조합)
  return {
    label: '내 정보 확인하기',
    variant: 'primary',
    onClick: () => navigate('/profile'),
  };
}

function SettlementHoldCard({
  status, eligibility, payout,
}: {
  status: SettlementHoldStatus;
  eligibility: UploadEligibility | null;
  payout: PayoutAccount | null;
}) {
  const navigate = useNavigate();
  const formatAmount = (n: number) => `${n.toLocaleString('ko-KR')}원`;
  const uniqueReasons = Array.from(new Set(status.hold_reasons));
  const primary = computeHoldPrimaryAction(status, eligibility, payout, navigate);
  const isDisabled = primary.variant === 'disabled';

  return (
    <div className="space-y-3 rounded-2xl bg-amber-500/20 p-4 ring-1 ring-amber-500/30">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-300">
          <Wallet size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-amber-100">
            정산 보류 중
            <span className="rounded-full bg-amber-500/30 px-2 py-0.5 text-[10px] font-semibold text-slate-900 dark:text-amber-50">
              지급 대기
            </span>
          </h2>
          <p className="mt-0.5 text-[11px] leading-relaxed text-slate-700 dark:text-amber-100/80">
            아래 사유가 해결되면 다음 정산 회차에 자동 지급됩니다.
            정산금은 <strong>소멸되지 않고 누적</strong>됩니다.
          </p>
        </div>
      </div>

      {/* 0388 — "예상" 표현 금지 (실시간 추정 오해 방지).
              hold_status RPC 가 반환하는 금액은 admin 이 이미 확정한
              held + carried_over 합산 (지급만 보류된 상태). */}
      <div className="grid grid-cols-2 gap-2 rounded-xl bg-bg-deep/40 p-3 text-[12px] ring-1 ring-line/10">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-ink-dim">보류 정산금 (확정·미지급)</p>
          <p className="mt-0.5 font-mono text-lg font-bold text-emerald-300">
            {formatAmount(status.total_pending_amount)}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-ink-dim">보류 회차</p>
          <p className="mt-0.5 font-mono text-lg font-bold text-slate-900 dark:text-amber-200">
            {status.held_settlement_count}회
          </p>
        </div>
        {status.pending_payout_amount > 0 && (
          <div className="col-span-2 text-[10px] text-ink-mute">
            지급 대기 {formatAmount(status.pending_payout_amount)} · 이월 {formatAmount(status.carried_over_amount)}
          </div>
        )}
      </div>

      {/* 보류 사유 체크리스트 */}
      {uniqueReasons.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-700 dark:text-amber-100/70">
            보류 사유 ({uniqueReasons.length})
          </p>
          <ul className="space-y-1.5">
            {uniqueReasons.map((r) => {
              const meta = HOLD_REASON_LABEL[r];
              return (
                <li key={r} className="flex items-start gap-2 rounded-lg bg-bg-card/60 p-2.5 ring-1 ring-line/10">
                  <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-500/30 text-[10px] font-bold text-slate-900 dark:text-amber-200">
                    !
                  </span>
                  <div>
                    <p className="text-xs font-semibold text-ink">{meta.title}</p>
                    <p className="mt-0.5 text-[11px] text-ink-mute">{meta.desc}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* 사유별 정확한 CTA */}
      <button
        type="button"
        onClick={primary.onClick}
        aria-disabled={isDisabled}
        className={
          isDisabled
            ? 'inline-flex w-full items-center justify-center rounded-full bg-amber-500/25 px-4 py-2.5 text-xs font-semibold text-slate-900 dark:text-amber-100 ring-1 ring-amber-400/50 cursor-default'
            : 'btn-primary w-full py-2.5 text-xs'
        }
      >
        {primary.label}
      </button>
    </div>
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
  const navigate = useNavigate();
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
  const [rightsConfirmed, setRightsConfirmed] = useState(false);  // 재제출 시에도 다시 체크 필요
  const [meta, setMeta] = useState<SelectedMeta>(() => {
    const e = editingTrack as unknown as Partial<SelectedMeta> | null;
    return e
      ? {
          genre_tags: e.genre_tags ?? [],
          mood_tags: e.mood_tags ?? [],
          business_type_tags: e.business_type_tags ?? [],
          vocal_type: e.vocal_type ?? '',
          recommended_dayparts: e.recommended_dayparts ?? [],
        }
      : emptySelectedMeta();
  });
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
    // 앨범 자켓 필수 — 신규는 파일 필수, 재제출은 기존 자켓이 있으면 허용
    if (!coverFile && !(isEditing && editingTrack?.cover_url)) {
      return '앨범 자켓 이미지를 등록해주세요';
    }
    if (!releaseDate) return '발매일을 선택해주세요';
    // 발매일 today + 3 days 검증
    const min = new Date();
    min.setDate(min.getDate() + 3);
    min.setHours(0, 0, 0, 0);
    if (new Date(releaseDate) < min) {
      return '발매일은 오늘 기준 최소 3일 뒤부터 선택할 수 있어요';
    }
    const metaErr = validateSelectedMeta(meta);
    if (metaErr) return metaErr;
    if (!rightsConfirmed) return '권리 확인 체크박스를 동의해주세요';
    return null;
  }

  /** 누락된 필수값을 한 번에 보여주기 위한 목록 (제출 버튼 비활성화 + 안내용). */
  function missingList(): string[] {
    const out: string[] = [];
    if (!isEditing && !audioFile) out.push('음원 파일');
    if (!title.trim()) out.push('곡명');
    if (!albumName.trim()) out.push('앨범명');
    if (!coverFile && !(isEditing && editingTrack?.cover_url)) out.push('앨범 자켓');
    if (!releaseType) out.push('발매 유형');
    if (!releaseDate) out.push('발매일');
    if (meta.genre_tags.length === 0) out.push('장르');
    if (meta.mood_tags.length === 0) out.push('분위기');
    if (meta.business_type_tags.length === 0) out.push('추천 매장');
    if (!meta.vocal_type) out.push('보컬 타입');
    if (meta.recommended_dayparts.length === 0) out.push('추천 시간대');
    if (!rightsConfirmed) out.push('유통 동의/권리 확인');
    return out;
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
        instrumental: meta.vocal_type === 'instrumental',
        rightsConfirmed,
        artist: artistOverride || undefined,
        main_genre: meta.genre_tags[0],
        sub_genre: meta.genre_tags[1] || undefined,
        suitable_store: meta.business_type_tags[0],
        mood: meta.mood_tags[0],
        lyrics: lyrics || undefined,
        audioFile,
        coverFile,
      });
      if (!res.ok) {
        toast.error(res.error ?? '업로드 실패');
        // 결제 제한으로 차단된 경우 결제 페이지로 안내(단순 Toast 로만 끝내지 않음).
        if (res.billing_required) navigate(res.redirect ?? '/subscription');
        return;
      }
      // 표준화 메타데이터(선택형) 저장 — 자동 배치에 사용
      if (res.track_id) {
        try { await setTrackSelectedMetadata(res.track_id, meta); }
        catch (me) { console.warn('[upload] set metadata 실패', me); }
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
      setRightsConfirmed(false);
      setMeta(emptySelectedMeta());
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
      </div>

      {/* 선택형 표준 메타데이터 (장르/무드/매장/보컬/시간대) */}
      <TrackMetaSelectors value={meta} onChange={setMeta} disabled={busy} />

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

      {(() => {
        const miss = missingList();
        if (miss.length === 0) return null;
        return (
          <div className="rounded-xl bg-red-100 p-3 text-[12px] text-red-900 ring-1 ring-red-400/30 dark:bg-red-500/20 dark:text-red-300 dark:ring-red-400/20">
            <p className="font-bold">아래 필수 항목을 입력해야 음원 유통 신청이 가능합니다.</p>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {miss.map((m) => (
                <li key={m} className="rounded-full bg-red-200/70 px-2 py-0.5 text-[11px] font-semibold dark:bg-red-500/20">
                  {m === '앨범 자켓' ? '앨범 자켓 (필수)' : m}
                </li>
              ))}
            </ul>
            {miss.includes('앨범 자켓') && (
              <p className="mt-1.5 font-semibold">앨범 자켓을 등록해야 음원 유통 신청이 가능합니다.</p>
            )}
          </div>
        );
      })()}

      <button
        type="submit"
        disabled={busy || missingList().length > 0}
        className="btn-primary w-full py-2.5 disabled:opacity-50"
      >
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
  qc,
  onChanged,
  onOpenQcDetail,
  onEdit,
}: {
  track: MyArtistTrackRow;
  qc?: MyTrackQcRow | null;
  onChanged: () => void | Promise<void>;
  onEdit?: () => void;
  /** X6.37: QC 뱃지 클릭 시 상세 모달 오픈 */
  onOpenQcDetail?: () => void;
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
          {/* 0083 — 본인 트랙 한정 audio_health 안전 라벨 (원문 오류 X) */}
          {track.audio_health_status && track.audio_health_status !== 'unknown' && (
            <ArtistAudioHealthBadge status={track.audio_health_status} />
          )}
          {/* X6.36 + X6.37 — QC 미니 뱃지 + 클릭 시 상세 모달 */}
          {qc && (
            <TrackQcBadge
              hasReport={qc.has_report}
              qcScore={qc.qc_score}
              clippingCount={qc.clipping_count}
              onClick={onOpenQcDetail}
            />
          )}
        </div>
        {track.release_status === 'review_pending' && (
          <p className="mt-1 text-[11px] text-sky-700 dark:text-sky-300">
            🔍 현재 검수 중이라 수정할 수 없습니다. 결과 안내 후 다시 시도해주세요.
          </p>
        )}
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
            className="rounded-md p-1.5 text-ink-dim hover:bg-red-500/20 hover:text-red-300"
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

/**
 * 0083 — 본인 트랙 한정 audio_health 안전 라벨.
 * 운영 오류 원문은 노출 X. 안전한 안내 문구만.
 */
function ArtistAudioHealthBadge({
  status,
}: {
  status: NonNullable<MyArtistTrackRow['audio_health_status']>;
}) {
  if (status === 'ok') {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/25 px-1.5 py-0.5 text-[10px] font-medium text-emerald-900 ring-1 ring-emerald-500/40 dark:text-emerald-100 dark:ring-emerald-400/40">
        🎵 정상
      </span>
    );
  }
  const map = {
    unreachable: { label: '음원 접근 불가', tone: 'bg-red-500/25 text-red-900 ring-1 ring-red-500/40 dark:text-red-100 dark:ring-red-400/40' },
    wrong_mime:  { label: '음원 형식 확인 필요', tone: 'bg-amber-500/25 text-amber-900 ring-1 ring-amber-500/40 dark:text-amber-100 dark:ring-amber-400/40' },
    empty:       { label: '파일 크기 오류', tone: 'bg-amber-500/25 text-amber-900 ring-1 ring-amber-500/40 dark:text-amber-100 dark:ring-amber-400/40' },
    error:       { label: '검사 실패', tone: 'bg-red-500/25 text-red-900 ring-1 ring-red-500/40 dark:text-red-100 dark:ring-red-400/40' },
  } as const;
  const m = (map as Record<string, { label: string; tone: string }>)[status];
  if (!m) return null;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${m.tone}`}
      title="운영팀에서 자동 검사된 음원 상태입니다"
    >
      ⚠ {m.label}
    </span>
  );
}
