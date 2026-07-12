/**
 * MemberStatsSection — 관리자 대시보드 최상단 회원 통계.
 *
 * ① 회원 요약 KPI (총/일반/사업자/아티스트)
 * ② 결제 현황 KPI (유료/무료/미결제)
 * ③ 플랜별 가입자 도넛 (무료/일반/사업자 — 미결제 제외)
 * ④ 회원 상태 KPI (활성/이메일미인증/정지/탈퇴; 없는 상태 자동 제외)
 * ⑤ 데이터 검증 — 세 파티션 합계가 총 회원과 일치하는지 재검증, 불일치 시 경고.
 *
 * 자체적으로 fetchMemberStats() 를 호출하고 오류를 격리한다 → RPC 미적용 등으로
 * 실패해도 기존 대시보드는 깨지지 않는다.
 */
import { useEffect, useState } from 'react';
import {
  Users, UserRound, Building2, Mic2, CreditCard, Gift, CircleDashed,
  CheckCircle2, MailWarning, Ban, UserMinus, RefreshCw,
} from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { AdminStatCard, AdminAlert, AdminCard } from '@/components/admin/ui';
import { fetchMemberStats, type MemberStats } from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';

const NUM = (n: number) => n.toLocaleString('ko-KR');

const PLAN_COLORS = { free: '#737373', individual: '#a78bfa', business: '#10b981' } as const;

export default function MemberStatsSection() {
  const [stats, setStats] = useState<MemberStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AdminError | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setStats(await fetchMemberStats());
    } catch (e) {
      setError(classifyAdminError(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  if (loading) {
    return <div className="h-28 animate-pulse rounded-2xl bg-bg-card" aria-busy="true" />;
  }

  // 오류(예: RPC 미적용)여도 나머지 대시보드는 정상 동작하도록 경고만 노출.
  if (error || !stats) {
    return (
      <AdminAlert
        tone="warning"
        title="회원 통계를 불러오지 못했어요"
        description={error?.message ?? '집계 데이터를 확인할 수 없습니다.'}
        action={
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-1 rounded-full bg-bg-card px-3 py-1.5 text-xs hover:bg-bg-hover"
          >
            <RefreshCw size={12} /> 다시 시도
          </button>
        }
      />
    );
  }

  const total = stats.total_members;

  // ③ 플랜 도넛 (미결제 제외)
  const planData = [
    { key: 'free', name: '무료', value: stats.plan_free, color: PLAN_COLORS.free },
    { key: 'individual', name: '일반', value: stats.plan_individual, color: PLAN_COLORS.individual },
    { key: 'business', name: '사업자', value: stats.plan_business, color: PLAN_COLORS.business },
  ];
  const planTotal = planData.reduce((s, p) => s + p.value, 0);

  // ④ 회원 상태 — 없는 상태(휴면 등 모델 부재)는 자동 제외.
  const statusData = [
    { key: 'active', label: '활성 회원', value: stats.status_active, icon: <CheckCircle2 size={16} />, tone: 'success' as const, show: true },
    { key: 'email', label: '이메일 미인증', value: stats.status_email_unverified, icon: <MailWarning size={16} />, tone: 'warning' as const, show: true },
    { key: 'disabled', label: '정지 회원', value: stats.status_disabled, icon: <Ban size={16} />, tone: 'danger' as const, show: true },
    { key: 'withdrawn', label: '탈퇴 회원', value: stats.status_withdrawn, icon: <UserMinus size={16} />, tone: 'neutral' as const, show: true },
    { key: 'dormant', label: '휴면 회원', value: 0, icon: <CircleDashed size={16} />, tone: 'neutral' as const, show: stats.has_dormant_model },
  ].filter((s) => s.show);

  // ⑤ 데이터 검증 — 설계상 항상 성립. 불일치는 데이터/로직 드리프트 경고.
  const segSum = stats.member_general + stats.member_business + stats.member_artist;
  const paySum = stats.paid_users + stats.free_users + stats.unpaid_users;
  const statusSum = stats.status_active + stats.status_email_unverified + stats.status_disabled + stats.status_withdrawn;
  const mismatches: string[] = [];
  if (segSum !== total) mismatches.push(`구분 합계 ${NUM(segSum)} ≠ 총 회원 ${NUM(total)}`);
  if (paySum !== total) mismatches.push(`결제 합계 ${NUM(paySum)} ≠ 총 회원 ${NUM(total)}`);
  if (statusSum !== total) mismatches.push(`상태 합계 ${NUM(statusSum)} ≠ 총 회원 ${NUM(total)}`);

  return (
    <div className="space-y-4">
      {mismatches.length > 0 && (
        <AdminAlert
          tone="warning"
          title="회원 통계 정합성 경고"
          description={`합계가 총 회원수와 일치하지 않습니다 — ${mismatches.join(' · ')}. 회원 데이터 또는 집계 기준을 확인하세요.`}
        />
      )}

      {/* ① 회원 요약 */}
      <div>
        <h3 className="mb-2 text-sm font-bold tracking-tight">회원 요약</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <AdminStatCard label="총 회원수" value={NUM(total)} icon={<Users size={16} />} tone="primary" hint="운영자 계정 제외" />
          <AdminStatCard label="일반 회원" value={NUM(stats.member_general)} icon={<UserRound size={16} />} tone="info" />
          <AdminStatCard label="사업자 회원" value={NUM(stats.member_business)} icon={<Building2 size={16} />} tone="success" />
          <AdminStatCard label="아티스트 회원" value={NUM(stats.member_artist)} icon={<Mic2 size={16} />} tone="primary" />
        </div>
      </div>

      {/* ② 결제 현황 */}
      <div>
        <h3 className="mb-2 text-sm font-bold tracking-tight">결제 현황</h3>
        <div className="grid grid-cols-3 gap-2">
          <AdminStatCard label="유료 회원" value={NUM(stats.paid_users)} icon={<CreditCard size={16} />} tone="success" hint="유료 플랜 활성" />
          <AdminStatCard label="무료 회원" value={NUM(stats.free_users)} icon={<Gift size={16} />} tone="neutral" hint="무료 플랜" />
          <AdminStatCard label="미결제 회원" value={NUM(stats.unpaid_users)} icon={<CircleDashed size={16} />} tone="warning" hint="플랜 없음·결제 미완료" />
        </div>
      </div>

      {/* ③ 플랜별 가입자 (미결제 제외) */}
      <AdminCard title="플랜별 가입자" subtitle="미결제 회원 제외">
        <div className="flex items-center gap-4">
          <ResponsiveContainer width="55%" height={180}>
            <PieChart>
              <Pie data={planData} innerRadius={42} outerRadius={70} paddingAngle={3} dataKey="value">
                {planData.map((entry) => (
                  <Cell key={entry.key} fill={entry.color} stroke="none" />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: '#181818', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }}
              />
            </PieChart>
          </ResponsiveContainer>
          <ul className="space-y-1.5 text-xs">
            {planData.map((p) => (
              <li key={p.key} className="flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />
                <span className="text-ink-mute">{p.name}</span>
                <span className="font-bold tabular-nums">{NUM(p.value)}</span>
                <span className="text-ink-mute tabular-nums">
                  {planTotal > 0 ? `(${Math.round((p.value / planTotal) * 100)}%)` : ''}
                </span>
              </li>
            ))}
            <li className="flex items-center gap-2 border-t border-line/10 pt-1.5 text-ink-mute">
              <CircleDashed size={12} />
              <span>미결제</span>
              <span className="font-bold tabular-nums">{NUM(stats.unpaid_users)}</span>
              <span>(차트 제외)</span>
            </li>
          </ul>
        </div>
      </AdminCard>

      {/* ④ 회원 상태 */}
      <div>
        <h3 className="mb-2 text-sm font-bold tracking-tight">회원 상태</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {statusData.map((s) => (
            <AdminStatCard key={s.key} label={s.label} value={NUM(s.value)} icon={s.icon} tone={s.tone} />
          ))}
        </div>
      </div>
    </div>
  );
}
