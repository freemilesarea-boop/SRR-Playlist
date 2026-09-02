/**
 * AdminMergedPanel — 병합된 탭의 공통 껍데기 (ADMIN-MERGE-SHELL-1)
 *
 * 여러 탭을 한 탭으로 합칠 때 쓰는 뷰 전환 셸. 합쳐진 화면이 전부 같은 방식으로
 * 동작해야 처음 보는 사람도 규칙을 한 번만 익히면 되므로, 셸을 복제하지 않고
 * 이 컴포넌트 하나만 쓴다.
 *
 * 담당하는 것:
 *   · 뷰 전환 칩 + 현재 뷰 한 줄 설명
 *   · 권한 필터링 — 볼 수 없는 뷰는 칩 자체를 렌더하지 않는다(병합이 접근 범위를
 *     넓히면 안 되므로). 권한 밖 뷰로 딥링크가 들어오면 첫 허용 뷰로 떨어뜨린다.
 *   · lazy 패널 로딩 중 스켈레톤
 *
 * 담당하지 않는 것: 각 뷰의 내용. 기존 패널을 그대로 렌더할 뿐 로직을 건드리지 않는다.
 */
import { Suspense, useEffect, useState } from 'react';
import { adminTypography } from '@/lib/adminTypography';

export interface MergedView {
  /** adminNav.MERGED_TABS 의 view 값과 일치해야 한다(구 딥링크 연결). */
  key: string;
  label: string;
  /** 칩 옆에 뜨는 한 줄 설명 — "이 화면이 무엇인지" */
  hint: string;
  icon: React.ReactNode;
  render: () => React.ReactNode;
  /** false 면 이 관리자에게 숨긴다. 미지정이면 노출. */
  allowed?: boolean;
}

export default function AdminMergedPanel({
  views,
  initialView,
}: {
  views: MergedView[];
  /** 구 딥링크가 지정한 초기 뷰. 없거나 권한 밖이면 첫 허용 뷰. */
  initialView?: string;
}) {
  const visible = views.filter((v) => v.allowed !== false);

  // 선택은 '요청'으로만 들고, 실제 뷰는 허용 목록에서 고른다 —
  // 권한 밖 뷰로 들어와도 빈 화면 대신 첫 허용 뷰가 뜬다.
  const [requested, setRequested] = useState<string | undefined>(initialView);
  useEffect(() => { setRequested(initialView); }, [initialView]);

  if (visible.length === 0) return null;
  const active = visible.find((v) => v.key === requested) ?? visible[0];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {visible.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => setRequested(v.key)}
              aria-pressed={active.key === v.key}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition ${
                active.key === v.key
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
        {active.render()}
      </Suspense>
    </div>
  );
}
