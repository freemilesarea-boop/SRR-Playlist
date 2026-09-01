/**
 * AdminWorkQueueBar — ADMIN-HOME-WORKQUEUE-1
 *
 * 관리자 홈 최상단 "처리 대기" 줄.
 *
 * 기존 홈은 방문자·스트리밍·매출 차트 + 정적 바로가기 6개뿐이라, "오늘 뭘 처리해야
 * 하는가" 를 알려면 탭을 하나씩 열어봐야 했다. 이 컴포넌트는 대기 건수를 홈에서
 * 바로 보여주고 클릭 시 해당 탭으로 보낸다(바로가기의 상위 호환이라 그것을 대체).
 *
 * 원칙:
 *   · 숫자는 0489 admin_work_queue_counts() 한 번 호출 — 탭별 개별 조회 없음.
 *   · 조회 실패 시 줄 전체를 감춘다. 0 으로 위장하지 않는다(가짜 수치 금지).
 *   · 카드 순서는 고정 — 대기 건수에 따라 자리가 바뀌면 스캔이 어려워진다.
 *     대신 0 건은 톤을 죽여 시선에서 빠지게 한다.
 */
import { useCallback, useEffect, useState } from 'react';
import { Mic2, UserCheck, Wallet, Banknote, MessageSquare, Store, RefreshCw } from 'lucide-react';
import { adminTones } from '@/lib/adminTones';
import { adminTypography } from '@/lib/adminTypography';
import { WORK_QUEUE_TABS } from '@/lib/adminNav';
import {
  fetchAdminWorkQueueCounts,
  type AdminWorkQueueCounts,
} from '@/lib/adminWorkQueueApi';

type Tone = 'danger' | 'warning' | 'neutral';

interface QueueItem {
  key: string;
  label: string;
  /** 이동할 admin 탭 key */
  tab: string;
  icon: React.ReactNode;
  count: number;
  /** 숫자 아래 한 줄 — 내역 분해나 강조 사유 */
  detail?: string;
  tone: Tone;
}

const NUM = (n: number) => n.toLocaleString('ko-KR');

/** 대기 0 건이면 neutral 로 눌러 시선에서 빼고, 긴급 사유가 있으면 danger. */
function toneFor(count: number, urgent = false): Tone {
  if (count === 0) return 'neutral';
  return urgent ? 'danger' : 'warning';
}

function buildItems(c: AdminWorkQueueCounts): QueueItem[] {
  const payoutTotal = c.payout_intake + c.payout_verify + c.payout_incomplete;
  const storeTotal = c.store_offline + c.store_error;
  const settlementTotal = c.settlement_pending + c.settlement_held;

  const items: QueueItem[] = [
    {
      key: 'track-review',
      label: '음원 검수',
      tab: WORK_QUEUE_TABS.trackReview,
      icon: <Mic2 size={14} />,
      count: c.track_review,
      tone: toneFor(c.track_review),
    },
    {
      key: 'artists',
      label: '아티스트 승인',
      tab: WORK_QUEUE_TABS.artistApproval,
      icon: <UserCheck size={14} />,
      count: c.artist_approval,
      tone: toneFor(c.artist_approval),
    },
    {
      key: 'payout',
      label: '정산 계좌',
      tab: WORK_QUEUE_TABS.payout,
      icon: <Wallet size={14} />,
      count: payoutTotal,
      // 미완비는 '계좌는 확인됐지만 지급이 안 나가는' 상태라 별도로 짚어준다.
      detail: payoutTotal > 0
        ? `신청 ${NUM(c.payout_intake)} · 확인 ${NUM(c.payout_verify)} · 미완비 ${NUM(c.payout_incomplete)}`
        : undefined,
      tone: toneFor(payoutTotal, c.payout_incomplete > 0),
    },
    {
      key: 'inquiries',
      label: '문의',
      tab: WORK_QUEUE_TABS.inquiries,
      icon: <MessageSquare size={14} />,
      count: c.inquiry_open,
      detail: c.inquiry_urgent > 0 ? `긴급 ${NUM(c.inquiry_urgent)}건` : undefined,
      tone: toneFor(c.inquiry_open, c.inquiry_urgent > 0),
    },
    {
      key: 'stores',
      label: '매장 이상',
      tab: WORK_QUEUE_TABS.stores,
      icon: <Store size={14} />,
      count: storeTotal,
      detail: storeTotal > 0
        ? `오프라인 ${NUM(c.store_offline)} · 재생오류 ${NUM(c.store_error)}`
        : undefined,
      tone: toneFor(storeTotal, c.store_error > 0),
    },
  ];

  // 정산 지급 금액/건수는 super admin 전용(0476 admin_pending_settlement_alert 와 동일 범위).
  if (c.is_super_admin) {
    items.splice(3, 0, {
      key: 'settlements',
      label: '정산 지급',
      tab: WORK_QUEUE_TABS.settlements,
      icon: <Banknote size={14} />,
      count: settlementTotal,
      detail: settlementTotal > 0
        ? `${c.settlement_month ? `${Number(c.settlement_month.slice(5, 7))}월 · ` : ''}` +
          `${NUM(c.settlement_amount)}원` +
          (c.settlement_held > 0 ? ` · 보류 ${NUM(c.settlement_held)}` : '')
        : undefined,
      tone: toneFor(settlementTotal, c.settlement_held > 0),
    });
  }

  return items;
}

export default function AdminWorkQueueBar({
  onNavigate,
  isTabVisible,
}: {
  onNavigate: (tab: string) => void;
  /** 권한상 이 관리자에게 보이는 탭인지. 안 보이는 탭 카드는 렌더하지 않는다
   *  (클릭해도 아무 일 없는 카드를 남기지 않기 위함 — 기존 바로가기와 같은 규칙). */
  isTabVisible: (tab: string) => boolean;
}) {
  const [counts, setCounts] = useState<AdminWorkQueueCounts | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setCounts(await fetchAdminWorkQueueCounts());
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" aria-busy="true">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-[74px] animate-pulse rounded-xl bg-bg-card" />
        ))}
      </div>
    );
  }

  // 조회 실패 — 홈을 깨뜨리지 않고 줄만 생략한다.
  if (!counts) return null;

  const items = buildItems(counts).filter((it) => isTabVisible(it.tab));
  if (items.length === 0) return null;
  const totalPending = items.reduce((s, it) => s + it.count, 0);

  return (
    <section aria-label="처리 대기" className="space-y-2">
      <div className="flex items-center gap-2">
        <h2 className={adminTypography.heading.h3}>처리 대기</h2>
        <span className={adminTypography.hint}>
          {totalPending === 0 ? '대기 중인 업무가 없습니다' : `총 ${NUM(totalPending)}건`}
        </span>
        <button
          type="button"
          onClick={() => void load()}
          className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] text-ink-dim ring-1 ring-line/15 transition hover:text-ink hover:ring-line/25"
        >
          <RefreshCw size={11} />
          새로고침
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {items.map((it) => {
          const tone = adminTones[it.tone];
          const idle = it.count === 0;
          return (
            <button
              key={it.key}
              type="button"
              onClick={() => onNavigate(it.tab)}
              className={`rounded-xl border bg-bg-card p-3 text-left transition hover:bg-bg-hover ${
                idle ? 'border-line/10 hover:border-line/25' : 'border-line/25 hover:border-line/40'
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className={`${adminTypography.caption} truncate`}>{it.label}</span>
                <span className={idle ? 'text-ink-dim' : tone.textMute}>{it.icon}</span>
              </div>
              <p className={`mt-1 ${adminTypography.number.medium} ${idle ? 'text-ink-dim' : ''}`}>
                {NUM(it.count)}
              </p>
              <p className={`mt-0.5 truncate ${adminTypography.hint}`} title={it.detail}>
                {it.detail ?? (idle ? '없음' : ' ')}
              </p>
            </button>
          );
        })}
      </div>
    </section>
  );
}
