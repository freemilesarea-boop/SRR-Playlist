import { useEffect, useState } from 'react';
import { X, Mail, User as UserIcon, Calendar, Clock, Headphones, Wallet, Handshake } from 'lucide-react';
import { fetchMemberDetail, type MemberDetail as MemberDetailType } from '@/lib/adminApi';
import { toast } from '@/store/toastStore';

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

  useEffect(() => {
    let alive = true;
    setError(null);
    fetchMemberDetail(userId)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
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
              </div>
              {data.user.withdrawn_at && (
                <div className="rounded-xl bg-red-500/10 px-3 py-2 ring-1 ring-red-500/30">
                  <p className="text-xs font-bold text-red-200">
                    탈퇴 회원 · {new Date(data.user.withdrawn_at).toLocaleDateString('ko-KR')}
                  </p>
                  {data.user.withdrawn_reason && (
                    <p className="mt-0.5 text-[11px] text-red-200/80">사유: {data.user.withdrawn_reason}</p>
                  )}
                </div>
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
                  <div className="rounded-xl bg-yellow-500/10 px-3 py-2 ring-1 ring-yellow-500/30">
                    <p className="text-xs font-bold text-yellow-200">
                      구독 취소 예정
                      {grace.current_period_end &&
                        ` · ${new Date(grace.current_period_end).toLocaleDateString('ko-KR')} 종료`}
                    </p>
                  </div>
                );
              })()}
            </section>

            {/* 활동 요약 */}
            <section className="grid grid-cols-2 gap-2">
              <Stat icon={<Headphones size={14} />} label="총 스트리밍" value={data.total_streams.toLocaleString()} />
              <Stat icon={<Clock size={14} />} label="누적 청취" value={fmtTime(data.total_listened_seconds)} />
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
          </div>
        )}
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
