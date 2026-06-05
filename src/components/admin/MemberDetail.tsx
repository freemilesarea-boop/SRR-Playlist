import { useEffect, useState } from 'react';
import {
  X, Mail, User as UserIcon, Calendar, Clock, Headphones, Wallet, Handshake,
  Ban, UserX, Eye, KeyRound, ShieldOff, AlertTriangle, LogOut, Ticket,
} from 'lucide-react';
import {
  fetchMemberDetail,
  adminDisableUser,
  adminEnableUser,
  adminWithdrawUser,
  adminRepairWithdrawnUser,
  adminMaskUserPii,
  adminForceSignOutUser,
  adminTriggerPasswordReset,
  adminGrantCurator,
  adminRevokeCurator,
  type MemberDetail as MemberDetailType,
} from '@/lib/adminApi';
import { toast } from '@/store/toastStore';
import { errorMessage } from '@/lib/errorMessage';
import Alert from '@/components/Alert';

type DangerAction = 'disable' | 'enable' | 'withdraw' | 'withdraw_repair' | 'mask_pii' | 'password_reset' | 'force_signout';
interface PendingAction {
  kind: DangerAction;
  label: string;
  description: string;
  irreversible: boolean;
  requiresReason: boolean;
}

const PLAN_LABEL: Record<string, string> = {
  free: '무료',
  personal: '일반',
  individual: '일반', // 0040 표준 plan_type
  business: '사업자',
};

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}시간 ${m % 60}분`;
  return `${m}분`;
}

function fmtDateTime(s: string): string {
  return new Date(s).toLocaleString('ko-KR');
}

export default function MemberDetail({
  userId,
  onClose,
}: {
  userId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<MemberDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [reasonText, setReasonText] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [curatorBusy, setCuratorBusy] = useState(false);

  async function toggleCurator(grant: boolean) {
    setCuratorBusy(true);
    try {
      if (grant) await adminGrantCurator(userId);
      else await adminRevokeCurator(userId);
      toast.success(grant ? '큐레이터 권한을 부여했어요' : '큐레이터 권한을 회수했어요');
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setCuratorBusy(false);
    }
  }

  function reload() {
    setLoading(true);
    fetchMemberDetail(userId)
      .then((d) => setData(d))
      .catch((e) => {
        const msg = errorMessage(e);
        setError(msg);
        toast.error(msg);
      })
      .finally(() => setLoading(false));
  }

  async function execAction() {
    if (!pending) return;
    setActionBusy(true);
    try {
      const reason = reasonText.trim() || undefined;
      let resultMsg = '';
      switch (pending.kind) {
        case 'disable': {
          const r = await adminDisableUser(userId, reason);
          resultMsg = `비활성화 처리됨 (구독 ${r.canceled_subs}건 cancel_scheduled)`;
          // 강제 로그아웃 fire-and-forget
          void adminForceSignOutUser(userId).catch(() => {});
          break;
        }
        case 'enable': {
          await adminEnableUser(userId);
          resultMsg = '비활성화 해제됨';
          break;
        }
        case 'withdraw': {
          const r = await adminWithdrawUser(userId, reason);
          resultMsg = `탈퇴 처리됨 (구독 ${r.canceled_subs}건 cancel_scheduled)`;
          void adminForceSignOutUser(userId).catch(() => {});
          break;
        }
        case 'withdraw_repair': {
          const r = await adminRepairWithdrawnUser(userId, reason);
          resultMsg = `탈퇴 상태 정리됨 (마스킹 ${r.pii_masked ? '실행' : '유지'} · tier ${r.tier_fixed ? '보정' : '유지'} · 구독 ${r.canceled_subs}건 정리)`;
          break;
        }
        case 'mask_pii': {
          const r = await adminMaskUserPii(userId);
          resultMsg = `개인정보 마스킹 완료 → ${r.anon_nickname}`;
          break;
        }
        case 'password_reset': {
          const r = await adminTriggerPasswordReset(userId);
          resultMsg = `재설정 메일 발송됨 (${r.sent_to_hash})`;
          break;
        }
        case 'force_signout': {
          const r = await adminForceSignOutUser(userId);
          resultMsg = r.ok
            ? `강제 로그아웃 완료 (refresh_token ${r.deleted_tokens}개 삭제)`
            : `로그아웃 부분 실패: ${r.error ?? 'unknown'}`;
          break;
        }
      }
      toast.success(resultMsg);
      setPending(null);
      setReasonText('');
      setConfirmText('');
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setActionBusy(false);
    }
  }

  useEffect(() => {
    let alive = true;
    setError(null);
    fetchMemberDetail(userId)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e) => {
        const msg = errorMessage(e);
        if (alive) setError(msg);
        toast.error(msg);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [userId]);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-bg-soft shadow-2xl ring-1 ring-line/15 sm:rounded-3xl animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line/10 bg-bg-soft/95 px-5 py-3 backdrop-blur">
          <h2 className="text-base font-bold">회원 상세</h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-ink/5"
          >
            <X size={16} />
          </button>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-ink-mute">불러오는 중…</div>
        ) : error || !data ? (
          <div className="space-y-3 p-6">
            <p className="text-sm font-bold text-red-300">회원 상세 조회 실패</p>
            <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-bg-soft p-3 text-[11px] text-ink-mute">
              {error ?? '데이터를 받지 못했어요.'}
            </pre>
            <p className="text-xs text-ink-mute">
              0033 (admin_member_detail 시그니처 변경) 마이그레이션이 적용되지 않았을 수 있어요.
            </p>
          </div>
        ) : (
          <div className="space-y-5 p-5">
            {/* 기본 정보 */}
            <section className="space-y-2">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-soft text-lg font-bold text-black">
                  {(data.user.nickname || data.user.email || '?').slice(0, 1).toUpperCase()}
                </div>
                <div>
                  <h3 className="text-lg font-bold">{data.user.nickname || '이름없음'}</h3>
                  <p className="flex items-center gap-1 text-xs text-ink-mute">
                    <Mail size={11} /> {data.user.email}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <KV label="권한" value={data.user.role} />
                <KV label="플랜" value={PLAN_LABEL[data.user.subscription_type] ?? data.user.subscription_type} />
                <KV label="가입일" value={new Date(data.user.created_at).toLocaleDateString('ko-KR')} />
                <KV label="최근방문" value={data.last_seen_at ? new Date(data.last_seen_at).toLocaleDateString('ko-KR') : '—'} />
                <KV label="최근로그인" value={data.user.last_sign_in_at ? fmtDateTime(data.user.last_sign_in_at) : '—'} />
                {data.user.disabled_at && (
                  <KV label="비활성화" value={fmtDateTime(data.user.disabled_at)} />
                )}
                {data.user.pii_masked_at && (
                  <KV label="PII 마스킹" value={fmtDateTime(data.user.pii_masked_at)} />
                )}
              </div>

              {/* X6.10 Phase 2 — 아티스트 플랜 정보 (artist 계정만) */}
              {data.user.account_type === 'artist' && (
                <div className="rounded-xl bg-bg-soft p-3 ring-1 ring-line/10">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-ink-mute">
                    아티스트 플랜
                  </p>
                  <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <KV label="plan_type" value={
                      data.user.plan_type === 'student_artist' ? '수강생 PRO'
                      : data.user.plan_type === 'general_artist' ? '일반'
                      : data.user.plan_type === 'legacy_student' ? 'legacy_student'
                      : data.user.plan_type === 'admin' ? 'admin'
                      : 'legacy (NULL)'
                    } />
                    <KV label="월 한도"
                        value={`${data.user.plan_monthly_quota ?? 50}곡`} />
                    <KV label="이번 달 사용"
                        value={`${data.user.plan_used_this_month ?? 0}곡`} />
                    <KV label="잔여"
                        value={`${Math.max(0, (data.user.plan_monthly_quota ?? 50) - (data.user.plan_used_this_month ?? 0))}곡`} />
                  </div>
                </div>
              )}
              {data.user.withdrawn_at && (
                <Alert tone="error" title={`탈퇴 처리됨 · ${fmtDateTime(data.user.withdrawn_at)}`}>
                  <div className="space-y-0.5 text-[12px] leading-relaxed">
                    <p>사유: {data.user.withdrawn_reason ?? '미기재'}</p>
                    <p>
                      개인정보 마스킹:{' '}
                      {data.user.pii_masked_at
                        ? `완료 (${fmtDateTime(data.user.pii_masked_at)})`
                        : '미완료 ⚠'}
                    </p>
                    <p>
                      요금제: {data.user.membership_tier ?? 'free'}
                      {data.user.membership_tier && data.user.membership_tier !== 'free'
                        ? ' ⚠ (free 아님)'
                        : ''}
                    </p>
                    <p>접근: 로그인·서비스 이용 차단됨</p>
                    {(!data.user.pii_masked_at ||
                      (data.user.membership_tier && data.user.membership_tier !== 'free')) && (
                      <p className="font-semibold text-amber-200">
                        일부 상태가 누락됐어요. 아래 Danger Zone 의 “탈퇴 상태 정리 / 마스킹 재실행”으로
                        보정하세요. (정산/계약/결제·음원 이력은 보존됩니다)
                      </p>
                    )}
                  </div>
                </Alert>
              )}
              {data.user.disabled_at && (
                <Alert tone="warning" title={`비활성화됨 · ${fmtDateTime(data.user.disabled_at)}`}>
                  {data.user.disabled_reason ?? '관리자가 일시 비활성화한 계정입니다.'}
                </Alert>
              )}
              {data.user.pii_masked_at && (
                <Alert tone="info">
                  <strong>PII 마스킹 완료</strong> · {fmtDateTime(data.user.pii_masked_at)}
                </Alert>
              )}
              {(() => {
                const grace = (data as unknown as {
                  subscriptions?: Array<{ status: string; current_period_end: string | null }>;
                }).subscriptions?.find(
                  (s) =>
                    s.status === 'cancel_scheduled' &&
                    (!s.current_period_end || new Date(s.current_period_end) > new Date()),
                );
                if (!grace) return null;
                return (
                  <Alert tone="warning">
                    <strong>구독 취소 예정</strong>
                    {grace.current_period_end &&
                      ` · ${new Date(grace.current_period_end).toLocaleDateString('ko-KR')} 종료`}
                  </Alert>
                );
              })()}
            </section>

            {/* 활동 요약 */}
            <section className="grid grid-cols-2 gap-2">
              <Stat icon={<Headphones size={14} />} label="총 스트리밍" value={data.total_streams.toLocaleString()} />
              <Stat icon={<Clock size={14} />} label="누적 청취" value={fmtTime(data.total_listened_seconds)} />
            </section>

            {/* 큐레이터 권한 — 일반 액션 (Danger Zone 과 분리) */}
            <section className="flex items-center justify-between gap-3 rounded-xl bg-bg-card px-3 py-2.5 ring-1 ring-line/10">
              <div>
                <p className="text-sm font-semibold">큐레이터 권한</p>
                <p className="text-xs text-ink-mute">
                  {data.user.is_curator
                    ? '플레이리스트를 직접 제작·출시할 수 있어요.'
                    : '부여 시 스튜디오에서 플레이리스트를 만들 수 있어요.'}
                </p>
              </div>
              {data.user.is_curator ? (
                <button
                  type="button"
                  onClick={() => void toggleCurator(false)}
                  disabled={curatorBusy}
                  className="btn-ghost shrink-0 text-xs disabled:opacity-50"
                >
                  권한 회수
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void toggleCurator(true)}
                  disabled={curatorBusy}
                  className="btn-primary shrink-0 text-xs disabled:opacity-50"
                >
                  큐레이터 지정
                </button>
              )}
            </section>

            {/* 영업인 (있을 때만 노출) */}
            {data.sales_agent && (
              <section>
                <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-ink-mute">
                  <Handshake size={14} /> 연결된 영업인
                </h4>
                <div className="rounded-xl bg-bg-card px-3 py-2.5 ring-1 ring-line/10">
                  <div className="flex items-baseline gap-2">
                    <p className="text-sm font-semibold">{data.sales_agent.name}</p>
                    <code className="rounded bg-bg-soft px-1.5 py-0.5 font-mono text-[11px]">
                      {data.sales_agent.code}
                    </code>
                    {!data.sales_agent.is_active && (
                      <span className="rounded-full bg-ink/10 px-1.5 py-0.5 text-[10px] text-ink-dim">
                        비활성
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-ink-mute">
                    수수료율 {data.sales_agent.commission_rate}%
                  </p>
                </div>
              </section>
            )}

            {data.promotions && data.promotions.length > 0 && (
              <section>
                <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-ink-mute">
                  <Ticket size={14} /> 프로모션 적용 ({data.promotions.length})
                </h4>
                <div className="space-y-1.5">
                  {data.promotions.map((p, i) => (
                    <div key={i} className="rounded-xl bg-accent/5 px-3 py-2.5 ring-1 ring-accent/20">
                      <div className="flex items-baseline gap-2">
                        <code className="rounded bg-bg-soft px-1.5 py-0.5 font-mono text-[11px] font-bold">
                          {p.code}
                        </code>
                        {p.name && <span className="text-xs text-ink-mute">{p.name}</span>}
                      </div>
                      <p className="mt-1 text-xs text-ink-mute">
                        {p.original_amount != null && (
                          <span className="line-through">₩{p.original_amount.toLocaleString()}</span>
                        )}
                        {p.discount_amount != null && (
                          <span className="ml-1 text-accent">
                            -{p.discount_type === 'percent' ? `${p.discount_amount}%` : `₩${p.discount_amount.toLocaleString()}`}
                          </span>
                        )}
                        {p.final_amount != null && (
                          <span className="ml-1 font-semibold text-ink">→ ₩{p.final_amount.toLocaleString()}</span>
                        )}
                      </p>
                      <p className="mt-0.5 text-[10px] text-ink-dim">{fmtDateTime(p.redeemed_at)}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* 최근 재생 */}
            <ListSection icon={<Headphones size={14} />} title={`최근 재생 (${data.recent_plays.length})`}>
              {data.recent_plays.length === 0 ? (
                <Empty>아직 재생 기록이 없어요</Empty>
              ) : (
                data.recent_plays.map((r, i) => (
                  <Row key={i}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{r.track_title}</p>
                      <p className="truncate text-xs text-ink-mute">{r.playlist_title}</p>
                    </div>
                    <span className="shrink-0 text-xs text-ink-dim">
                      {fmtDateTime(r.created_at)}
                    </span>
                  </Row>
                ))
              )}
            </ListSection>

            {/* 최근 방문 */}
            <ListSection icon={<UserIcon size={14} />} title={`최근 방문 (${data.recent_visits.length})`}>
              {data.recent_visits.length === 0 ? (
                <Empty>방문 기록이 없어요</Empty>
              ) : (
                data.recent_visits.map((v, i) => (
                  <Row key={i}>
                    <code className="truncate font-mono text-xs">{v.path}</code>
                    <span className="text-xs text-ink-dim">{fmtDateTime(v.created_at)}</span>
                  </Row>
                ))
              )}
            </ListSection>

            {/* 결제 */}
            <ListSection icon={<Wallet size={14} />} title={`결제/매출 (${data.revenue.length})`}>
              {data.revenue.length === 0 ? (
                <Empty>결제 기록이 없어요</Empty>
              ) : (
                data.revenue.map((r, i) => (
                  <Row key={i}>
                    <div>
                      <p className="text-sm font-semibold">₩{r.amount.toLocaleString()}</p>
                      <p className="text-xs text-ink-mute">
                        {PLAN_LABEL[r.subscription_type] ?? r.subscription_type} · {r.status}
                      </p>
                      {r.sales_agent_code && (
                        <p className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-ink-dim">
                          <Handshake size={10} /> 영업인{' '}
                          <code className="font-mono">{r.sales_agent_code}</code>
                        </p>
                      )}
                    </div>
                    <span className="text-xs text-ink-dim">
                      {new Date(r.paid_at).toLocaleDateString('ko-KR')}
                    </span>
                  </Row>
                ))
              )}
            </ListSection>

            {/* 구독 신청 */}
            <ListSection icon={<Calendar size={14} />} title={`구독 신청 (${data.subscription_requests.length})`}>
              {data.subscription_requests.length === 0 ? (
                <Empty>신청 내역이 없어요</Empty>
              ) : (
                data.subscription_requests.map((s, i) => (
                  <Row key={i}>
                    <div>
                      <p className="text-sm">{PLAN_LABEL[s.requested_plan] ?? s.requested_plan}</p>
                      <p className="text-xs text-ink-mute">{s.status}</p>
                    </div>
                    <span className="text-xs text-ink-dim">
                      {new Date(s.created_at).toLocaleDateString('ko-KR')}
                    </span>
                  </Row>
                ))
              )}
            </ListSection>

            {/* 위험 작업 — 0095 */}
            <section className="rounded-2xl border border-red-500/30 bg-red-500/5 p-4">
              <h4 className="mb-3 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-red-300">
                <AlertTriangle size={14} /> 위험 작업 (Danger Zone)
              </h4>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <DangerButton
                  icon={<KeyRound size={14} />}
                  label="비밀번호 재설정 메일 발송"
                  description="사용자에게 재설정 magic link 메일이 발송됩니다."
                  onClick={() =>
                    setPending({
                      kind: 'password_reset',
                      label: '비밀번호 재설정 메일 발송',
                      description: '사용자에게 magic link 가 담긴 메일이 발송돼요. 비밀번호 원문은 어디에도 노출되지 않아요.',
                      irreversible: false,
                      requiresReason: false,
                    })
                  }
                />
                <DangerButton
                  icon={<LogOut size={14} />}
                  label="강제 로그아웃 (모든 세션)"
                  description="해당 사용자의 모든 기기/탭 세션을 즉시 종료합니다."
                  onClick={() =>
                    setPending({
                      kind: 'force_signout',
                      label: '강제 로그아웃',
                      description: '사용자의 모든 refresh token 을 삭제해요. 즉시 모든 기기에서 로그아웃됩니다.',
                      irreversible: false,
                      requiresReason: false,
                    })
                  }
                />
                {data.user.disabled_at ? (
                  <DangerButton
                    icon={<ShieldOff size={14} />}
                    label="비활성화 해제"
                    description="계정 접근 권한을 복원합니다."
                    tone="ok"
                    onClick={() =>
                      setPending({
                        kind: 'enable',
                        label: '비활성화 해제',
                        description: '이 계정이 다시 로그인 및 서비스 이용할 수 있어요.',
                        irreversible: false,
                        requiresReason: false,
                      })
                    }
                  />
                ) : (
                  <DangerButton
                    icon={<Ban size={14} />}
                    label="비활성화"
                    description="계정 접근을 차단하고 활성 구독을 cancel_scheduled 처리합니다."
                    onClick={() =>
                      setPending({
                        kind: 'disable',
                        label: '비활성화 처리',
                        description: '계정 접근을 즉시 차단하고, 활성 구독은 cancel_scheduled 로 전환돼요. 강제 로그아웃도 함께 실행됩니다. 비활성화 해제로 복원 가능해요.',
                        irreversible: false,
                        requiresReason: true,
                      })
                    }
                  />
                )}
                <DangerButton
                  icon={<UserX size={14} />}
                  label="탈퇴 처리 (운영자 대행)"
                  description="활성 구독 자동 cancel + tier free. 개인정보는 마스킹되고 정산/계약/결제·음원 이력과 식별자는 보존됩니다."
                  disabled={!!data.user.withdrawn_at || data.user.role === 'admin'}
                  disabledReason={
                    data.user.role === 'admin'
                      ? '관리자 계정은 탈퇴 처리할 수 없습니다'
                      : data.user.withdrawn_at
                        ? '이미 탈퇴 처리된 회원입니다'
                        : undefined
                  }
                  onClick={() =>
                    setPending({
                      kind: 'withdraw',
                      label: '탈퇴 처리 (운영자 대행)',
                      description: '활성 구독을 cancel_scheduled 로 전환하고 계정 접근을 즉시 차단해요. 개인정보(이름·연락처·주소 등)는 마스킹되며, 결제/계약/정산/음원 이력과 식별자(이메일·아티스트명·사업자번호)는 보존됩니다. 강제 로그아웃도 함께 실행됩니다.',
                      irreversible: true,
                      requiresReason: true,
                    })
                  }
                />
                {data.user.withdrawn_at &&
                  (!data.user.pii_masked_at ||
                    (data.user.membership_tier && data.user.membership_tier !== 'free')) && (
                    <DangerButton
                      icon={<UserX size={14} />}
                      label="탈퇴 상태 정리 / 마스킹 재실행"
                      description="이미 탈퇴된 회원의 누락된 개인정보 마스킹·요금제·구독취소를 보정합니다. 이력은 보존됩니다."
                      onClick={() =>
                        setPending({
                          kind: 'withdraw_repair',
                          label: '탈퇴 상태 정리 / 마스킹 재실행',
                          description:
                            '이미 탈퇴 처리된 회원의 누락 항목(개인정보 마스킹, 요금제 free, 활성 구독 cancel_scheduled)을 보정해요. 재탈퇴가 아니며, 결제/계약/정산/음원 이력과 식별자는 보존됩니다.',
                          irreversible: true,
                          requiresReason: true,
                        })
                      }
                    />
                  )}
                <DangerButton
                  icon={<Eye size={14} />}
                  label="개인정보 마스킹"
                  description="이름/연락처/주소 등 PII 를 NULL 화. 정산용 식별자는 보존."
                  disabled={!!data.user.pii_masked_at}
                  onClick={() =>
                    setPending({
                      kind: 'mask_pii',
                      label: '개인정보 마스킹',
                      description: 'users / artist_profiles / business_profiles 의 PII (full_name, phone, address, birth_date, CI/DI 등) 를 NULL 처리해요. nickname 은 "탈퇴회원_xxxxxxxx" 로 익명화돼요. 정산용 artist_name, auth.users.email 은 보존됩니다. 되돌릴 수 없어요.',
                      irreversible: true,
                      requiresReason: false,
                    })
                  }
                />
              </div>
              <p className="mt-3 text-[10px] leading-relaxed text-ink-dim">
                * 모든 위험 작업은 admin_operation_logs 에 영구 기록됩니다.<br />
                * 본인 계정 / 마지막 관리자 계정은 자동으로 보호돼요.<br />
                * hard delete (계정 완전 삭제) 는 정산/계약/결제 이력 무결성을 위해 UI 에서 노출하지 않습니다.
              </p>
            </section>
          </div>
        )}
      </div>

      {/* 위험 작업 2단계 confirm modal */}
      {pending && (
        <DangerConfirmModal
          pending={pending}
          busy={actionBusy}
          reasonText={reasonText}
          confirmText={confirmText}
          onChangeReason={setReasonText}
          onChangeConfirm={setConfirmText}
          onCancel={() => {
            if (actionBusy) return;
            setPending(null);
            setReasonText('');
            setConfirmText('');
          }}
          onConfirm={() => void execAction()}
        />
      )}
    </div>
  );
}

function DangerButton({
  icon,
  label,
  description,
  onClick,
  disabled,
  disabledReason,
  tone = 'danger',
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
  disabledReason?: string;
  tone?: 'danger' | 'ok';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled && disabledReason ? disabledReason : undefined}
      className={`group flex flex-col items-start gap-1 rounded-xl bg-bg-card p-3 text-left ring-1 transition disabled:opacity-40 disabled:pointer-events-none ${
        tone === 'ok'
          ? 'ring-green-500/30 hover:bg-green-500/10 hover:ring-green-500/50'
          : 'ring-red-500/30 hover:bg-red-500/10 hover:ring-red-500/50'
      }`}
    >
      <span
        className={`flex items-center gap-1.5 text-xs font-bold ${
          tone === 'ok' ? 'text-green-300' : 'text-red-200'
        }`}
      >
        {icon} {label}
      </span>
      <span className="text-[11px] leading-relaxed text-ink-mute">{description}</span>
      {disabled && disabledReason && (
        <span className="mt-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-300">
          {disabledReason}
        </span>
      )}
    </button>
  );
}

function DangerConfirmModal({
  pending,
  busy,
  reasonText,
  confirmText,
  onChangeReason,
  onChangeConfirm,
  onCancel,
  onConfirm,
}: {
  pending: PendingAction;
  busy: boolean;
  reasonText: string;
  confirmText: string;
  onChangeReason: (v: string) => void;
  onChangeConfirm: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const reasonOk = !pending.requiresReason || reasonText.trim().length >= 2;
  const confirmOk = confirmText.trim() === '확인';
  const canSubmit = reasonOk && confirmOk && !busy;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md space-y-4 rounded-2xl bg-bg-soft p-5 ring-1 ring-line/15"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-300">
            <AlertTriangle size={18} />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-bold">{pending.label}</h3>
            <p className="mt-1 text-xs leading-relaxed text-ink-mute">{pending.description}</p>
            {pending.irreversible && (
              <p className="mt-2 text-[11px] font-bold text-red-300">⚠ 이 작업은 되돌릴 수 없어요.</p>
            )}
          </div>
        </div>

        {pending.requiresReason && (
          <div className="space-y-1">
            <label className="text-[11px] font-bold uppercase tracking-wider text-ink-mute">
              사유 (2자 이상)
            </label>
            <input
              type="text"
              value={reasonText}
              onChange={(e) => onChangeReason(e.target.value)}
              placeholder="예: 약관 위반 / 본인 요청 / 어뷰징"
              disabled={busy}
              className="input text-sm"
            />
          </div>
        )}

        <div className="space-y-1">
          <label className="text-[11px] font-bold uppercase tracking-wider text-ink-mute">
            진행하려면 <code className="font-mono">확인</code> 을 입력하세요
          </label>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => onChangeConfirm(e.target.value)}
            placeholder="확인"
            disabled={busy}
            className="input text-sm"
          />
        </div>

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="btn-ghost flex-1 py-2.5 text-sm"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canSubmit}
            className="flex-1 rounded-full bg-red-500/90 px-4 py-2.5 text-sm font-bold text-white ring-1 ring-white/15 transition hover:bg-red-500 disabled:opacity-40 disabled:pointer-events-none"
          >
            {busy ? '처리 중…' : '실행'}
          </button>
        </div>
      </div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-bg-card px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-ink-dim">{label}</p>
      <p className="mt-0.5 text-sm font-semibold">{value}</p>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl bg-bg-card px-3 py-2.5">
      <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-ink-dim">
        {icon} {label}
      </p>
      <p className="mt-1 text-base font-extrabold">{value}</p>
    </div>
  );
}

function ListSection({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-ink-mute">
        {icon} {title}
      </h4>
      <div className="overflow-hidden rounded-xl bg-bg-card ring-1 ring-line/10">{children}</div>
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line/10 px-3 py-2 text-sm first:border-t-0">
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-4 text-center text-xs text-ink-dim">{children}</p>;
}
