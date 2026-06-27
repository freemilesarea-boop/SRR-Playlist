/**
 * EnterpriseHqProfileCard — Phase 1-7
 *
 * ProfilePage 에서 HQ 사용자 (enterprise_accounts.auth_user_id 매칭) 에게 노출.
 * - 본사 요약 (브랜드명 + 브랜드 코드)
 * - 사업자 정보 등록 상태 (미등록 시 CTA)
 * - "내 엔터프라이즈" 대시보드 진입 버튼 (/enterprise/me)
 *
 * 본 카드는 정보 + 진입점 역할.
 * 풀 dashboard / 사업자 정보 편집은 /enterprise/me 페이지에서 진행.
 */
import { Building2, ArrowRight, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { EnterpriseHqRole } from '@/lib/api/enterpriseHqApi';

interface Props {
  role: Extract<EnterpriseHqRole, { is_hq: true }>;
}

export default function EnterpriseHqProfileCard({ role }: Props) {
  return (
    <section className="rounded-2xl bg-gradient-to-br from-accent/10 to-accent-soft/5 p-4 ring-1 ring-accent/20">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
          <Building2 size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold tracking-tight">엔터프라이즈 본사 담당자</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-mute">
            <span className="font-semibold text-ink">{role.enterprise_name}</span>
            {role.brand_code && (
              <span className="ml-1 font-mono text-[11px] text-ink-dim">· {role.brand_code}</span>
            )}
          </p>
          <p className="mt-0.5 text-[11px] text-ink-dim">
            상태: <StatusInline status={role.status} />
          </p>
        </div>
      </div>
      <Link
        to="/enterprise/me"
        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-accent py-2.5 text-sm font-bold text-bg shadow-sm hover:opacity-90"
      >
        내 엔터프라이즈 대시보드
        <ArrowRight size={14} />
      </Link>
      <p className="mt-2 text-[10px] text-ink-dim text-center">
        본사 사업자 정보 · 연결 매장 · 초대코드 관리는 대시보드에서 확인할 수 있어요.
      </p>
    </section>
  );
}

function StatusInline({ status }: { status: 'active' | 'invited' | 'suspended' | 'inactive' }) {
  if (status === 'active') {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-300">
        <CheckCircle2 size={10} /> 활성
      </span>
    );
  }
  if (status === 'invited') {
    return (
      <span className="inline-flex items-center gap-1 text-sky-300">
        <CheckCircle2 size={10} /> 초대 대기
      </span>
    );
  }
  if (status === 'suspended') {
    return (
      <span className="inline-flex items-center gap-1 text-amber-300">
        <AlertTriangle size={10} /> 정지
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-ink-mute">
      <AlertTriangle size={10} /> 비활성
    </span>
  );
}
