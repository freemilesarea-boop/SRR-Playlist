import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Circle, ChevronRight } from 'lucide-react';
import { canAccess, type OperatorAccessContext, type OperatorRole } from '@/lib/operatorNavigation';

/**
 * OperatorOnboardingChecklist — Phase ADMIN-UX-IMPLEMENT-1
 *
 * 신규 운영자가 처음 무엇을 해야 하는지 안내하는 단순 온보딩 체크리스트.
 *   • 새 DB/RPC 없음 — 완료 상태는 localStorage 에만 저장한다.
 *   • 각 단계는 기존 화면으로 향하는 딥링크. 역할에 맞는 단계만 노출한다.
 */
const STORAGE_KEY = 'ops.onboarding.v1';

interface OnboardingStep {
  id: string;
  label: string;
  description: string;
  href: string;
  allowedRoles: OperatorRole[];
  superOnly?: boolean;
}

const STEPS: OnboardingStep[] = [
  { id: 'explore-home', label: '운영 홈 둘러보기', description: '핵심 지표와 빠른 작업 위치 익히기', href: '/ops', allowedRoles: ['super_admin', 'admin', 'hq'] },
  { id: 'create-invite', label: '초대코드 발급', description: '본사·매장 가입 초대코드 만들기', href: '/admin?tab=enterprise-accounts', allowedRoles: ['super_admin', 'admin'] },
  { id: 'link-store', label: '매장 만들기·연결', description: '프랜차이즈 매장 등록·정책 연결', href: '/admin?tab=franchise', allowedRoles: ['super_admin', 'admin'] },
  { id: 'check-store', label: '매장 상태 확인', description: '매장 온/오프라인 모니터링 보기', href: '/admin?tab=store-monitoring', allowedRoles: ['super_admin', 'admin'] },
  { id: 'deploy-music', label: '음악 배포 확인', description: '매장 음악 정책 배포 현황 보기', href: '/admin?tab=policy-deployment', allowedRoles: ['super_admin', 'admin'] },
  { id: 'hq-home', label: '본사 대시보드 확인', description: '본사 관점 종합 현황 보기', href: '/enterprise/me', allowedRoles: ['hq', 'super_admin', 'admin'] },
];

function loadDone(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

export interface OperatorOnboardingChecklistProps {
  ctx: OperatorAccessContext;
}

export default function OperatorOnboardingChecklist({ ctx }: OperatorOnboardingChecklistProps) {
  const steps = useMemo(() => STEPS.filter((s) => canAccess(s, ctx)), [ctx]);
  const [done, setDone] = useState<Record<string, boolean>>({});

  useEffect(() => { setDone(loadDone()); }, []);

  const toggle = useCallback((id: string) => {
    setDone((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const completed = steps.filter((s) => done[s.id]).length;
  const total = steps.length;
  const allDone = total > 0 && completed === total;

  if (total === 0) return null;

  return (
    <section className="rounded-2xl border border-line/10 bg-bg-card p-5" aria-label="운영자 온보딩">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold text-ink">시작하기 체크리스트</h2>
        <span className="font-mono text-xs text-ink-dim">{completed}/{total}</span>
      </div>
      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-bg-hover">
        <div
          className="h-full rounded-full bg-accent transition-all"
          style={{ width: `${total === 0 ? 0 : (completed / total) * 100}%` }}
        />
      </div>
      {allDone && (
        <p className="mb-3 text-xs font-medium text-accent">모든 단계를 완료했습니다. 좋아요!</p>
      )}
      <ul className="space-y-1.5">
        {steps.map((step) => {
          const checked = !!done[step.id];
          return (
            <li key={step.id} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => toggle(step.id)}
                aria-pressed={checked}
                aria-label={`${step.label} ${checked ? '완료 취소' : '완료 표시'}`}
                className="flex h-6 w-6 flex-none items-center justify-center text-ink-mute hover:text-accent"
              >
                {checked ? <CheckCircle2 size={18} className="text-accent" /> : <Circle size={18} />}
              </button>
              <Link
                to={step.href}
                className="group flex flex-1 items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-bg-hover"
              >
                <span className="flex-1">
                  <span className={`block text-sm font-medium ${checked ? 'text-ink-dim line-through' : 'text-ink'}`}>
                    {step.label}
                  </span>
                  <span className="block text-xs text-ink-dim">{step.description}</span>
                </span>
                <ChevronRight size={16} className="flex-none text-ink-dim group-hover:text-ink-mute" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
