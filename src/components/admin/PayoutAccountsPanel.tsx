/**
 * PayoutAccountsPanel — '정산 계좌' 통합 화면 (ADMIN-MERGE-PAYOUT-1)
 *
 * 원래 '정산 정보 신청'(payout-intake)과 '계좌 확인'(payout-verification)은 별도 탭이었다.
 * 둘은 같은 업무의 앞뒤 단계인데 화면이 갈라져 있어서, 그 사이에 낀 상태 —
 * "계좌는 verified 인데 지급 요건(실명·주민번호·계좌·원천징수 동의) 미완비" — 가
 * 어느 쪽에서도 보이지 않았다. 그 결과 24건이 2026-06 부터 방치됐고, 아티스트 화면에는
 * 초록 '확인 완료' 배지와 '지급 보류' 배너가 동시에 떴다(8/31 #525 · #527).
 *
 * 그래서 한 탭 두 뷰로 합친다:
 *   · 신청 대기  — payout_intake_submissions 승인/반려 (PayoutIntakeAdminPanel)
 *   · 계좌 목록  — artist_payout_accounts 승인/거절 + 상태 필터 (PayoutVerificationList)
 *                  필터에 '정보 미완비' 가 있어 위 사각지대를 한 번에 뽑을 수 있다.
 *   · 변경 신청  — 이미 승인된 계좌가 바뀐 건 (0495). 신규 등록과 위험도가 달라 따로 둔다.
 *
 * 기존 패널을 복제하지 않고 그대로 재사용한다 — 승인/거절/PII reveal 로직 무변경.
 * 구 딥링크 ?tab=payout-verification 는 adminNav.MERGED_TABS 가 이 화면의 'accounts'
 * 뷰로 연결한다(딥링크 보존).
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import { FileText, ShieldAlert, Wallet } from 'lucide-react';
import { adminTypography } from '@/lib/adminTypography';

const PayoutIntakeAdminPanel = lazy(() => import('./PayoutIntakeAdminPanel'));
const PayoutVerificationList = lazy(() => import('./PayoutVerificationList'));
const PayoutAccountChangesList = lazy(() => import('./PayoutAccountChangesList'));

export type PayoutAccountsView = 'intake' | 'accounts' | 'changes';

const VIEWS: Array<{ key: PayoutAccountsView; label: string; hint: string; icon: React.ReactNode }> = [
  { key: 'intake', label: '신청 대기', hint: '회원이 낸 정산 정보 신청 승인·반려', icon: <FileText size={13} /> },
  { key: 'accounts', label: '계좌 목록', hint: '등록된 정산 계좌 승인·거절 · 미완비 확인', icon: <Wallet size={13} /> },
  { key: 'changes', label: '변경 신청', hint: '이미 승인된 계좌의 변경 승인 · 승인 전까지 지급 자동 보류', icon: <ShieldAlert size={13} /> },
];

export default function PayoutAccountsPanel({
  initialView = 'intake',
}: {
  initialView?: PayoutAccountsView;
} = {}) {
  const [view, setView] = useState<PayoutAccountsView>(initialView);

  // 구 딥링크로 다시 들어오면(같은 탭에 머문 채 view 만 바뀌는 경우) 그 뷰로 전환.
  useEffect(() => { setView(initialView); }, [initialView]);

  const active = VIEWS.find((v) => v.key === view) ?? VIEWS[0];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => setView(v.key)}
              aria-pressed={view === v.key}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition ${
                view === v.key
                  ? 'bg-accent text-black'
                  : 'bg-bg-card text-ink-mute hover:bg-bg-hover hover:text-ink'
              }`}
            >
              {v.icon}
              {v.label}
            </button>
          ))}
        </div>
        <p className={adminTypography.hint}>{active.hint}</p>
      </div>

      <Suspense fallback={<div className="h-40 animate-pulse rounded-2xl bg-bg-card" />}>
        {view === 'intake' && <PayoutIntakeAdminPanel />}
        {view === 'accounts' && <PayoutVerificationList initialFilter="all" />}
        {view === 'changes' && <PayoutAccountChangesList />}
      </Suspense>
    </div>
  );
}
