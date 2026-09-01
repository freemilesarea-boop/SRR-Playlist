/**
 * EnterpriseControlCenterPanel — '통합 관제' (ADMIN-MERGE-CONTROL-1)
 *
 * 관제 성격의 화면이 1차 메뉴에 넷이나, 그것도 두 그룹에 흩어져 있었다:
 *   본사·브랜드 > 전체 현황  — 엔터프라이즈 현황 / 엔터프라이즈 Command Center
 *   매장 > 관제              — 운영센터(NOC) / 운영 관제
 * 이름만 봐서는 어디로 가야 할지 알 수 없고, KPI 가 서로 겹쳐서 열어봐도 구분이 안 됐다.
 * (Operations 는 nocApi 를 그대로 쓰고, Command Center 에도 NOC 카드 6장이 있다.)
 *
 * 다만 넷은 실제로 축이 다르다 — 겹치는 건 KPI 일부뿐이라 지우면 기능이 없어진다.
 * 그래서 한 탭 네 뷰로 묶고, 뷰 이름을 "무엇을 보는 화면인지"로 붙인다:
 *
 *   프랜차이즈  — 본사별 매장·정책·추정 매출 (EnterpriseOverviewPanel)
 *   매장 관제    — 실시간 매장 상태·장애·알림   (EnterpriseNocPanel)
 *   시스템 운영  — cron·자동화·알림 발송·드리프트 (EnterpriseOperationsPanel)
 *   사업 현황    — 계약·청구·정산·매출·브랜드    (EnterpriseCommandCenterPanel)
 *
 * 기존 패널은 복제하지 않고 그대로 재사용한다 — 데이터/동작 무변경.
 * 구 딥링크(?tab=enterprise-noc 등)는 adminNav.MERGED_TABS 가 해당 뷰로 연결한다.
 *
 * 권한: 시스템 운영 / 사업 현황은 예전에도 super admin 전용 탭이었다. 병합이 접근 범위를
 * 넓히면 안 되므로 AdminPage 가 같은 규칙으로 계산한 allowedViews 만 렌더한다.
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import { Building2, Activity, Settings, Compass } from 'lucide-react';
import { adminTypography } from '@/lib/adminTypography';

const EnterpriseOverviewPanel = lazy(() => import('./EnterpriseOverviewPanel'));
const EnterpriseNocPanel = lazy(() => import('./EnterpriseNocPanel'));
const EnterpriseOperationsPanel = lazy(() => import('./EnterpriseOperationsPanel'));
const EnterpriseCommandCenterPanel = lazy(() => import('./EnterpriseCommandCenterPanel'));

export type ControlCenterView = 'franchises' | 'stores' | 'system' | 'business';

interface ViewDef {
  key: ControlCenterView;
  label: string;
  hint: string;
  icon: React.ReactNode;
}

/** 순서 = 화면 전환 순서. 넓은 것(프랜차이즈)에서 좁은 것(사업 지표)으로. */
const CONTROL_CENTER_VIEWS: ViewDef[] = [
  { key: 'franchises', label: '프랜차이즈', hint: '본사별 매장·정책·추정 매출', icon: <Building2 size={13} /> },
  { key: 'stores', label: '매장 관제', hint: '실시간 매장 상태·장애·알림', icon: <Activity size={13} /> },
  { key: 'system', label: '시스템 운영', hint: '자동 실행·알림 발송·동기화 점검', icon: <Settings size={13} /> },
  { key: 'business', label: '사업 현황', hint: '계약·청구·정산·매출·브랜드', icon: <Compass size={13} /> },
];

export default function EnterpriseControlCenterPanel({
  initialView = 'franchises',
  allowedViews,
}: {
  initialView?: ControlCenterView;
  /** 권한상 이 관리자가 볼 수 있는 뷰. 미지정이면 전부(테스트/스토리 용). */
  allowedViews?: readonly ControlCenterView[];
}) {
  const views = allowedViews
    ? CONTROL_CENTER_VIEWS.filter((v) => allowedViews.includes(v.key))
    : CONTROL_CENTER_VIEWS;

  // 선택된 뷰는 '요청' 으로만 들고, 실제로 보여줄 뷰는 허용 목록에서 고른다.
  // 이렇게 두면 권한 밖 뷰로 딥링크가 들어와도 빈 화면 대신 첫 허용 뷰가 뜬다.
  const [requested, setRequested] = useState<ControlCenterView>(initialView);
  useEffect(() => { setRequested(initialView); }, [initialView]);

  if (views.length === 0) return null;
  const active = views.find((v) => v.key === requested) ?? views[0];
  const view = active.key;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {views.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => setRequested(v.key)}
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
        {view === 'franchises' && <EnterpriseOverviewPanel />}
        {view === 'stores' && <EnterpriseNocPanel />}
        {view === 'system' && <EnterpriseOperationsPanel />}
        {view === 'business' && <EnterpriseCommandCenterPanel />}
      </Suspense>
    </div>
  );
}
