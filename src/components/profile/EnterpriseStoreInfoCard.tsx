/**
 * EnterpriseStoreInfoCard — Phase 1-7
 *
 * ProfilePage 에서 엔터프라이즈 매장 사용자에게 노출 (정보 표시만).
 * - 매장명 / 본사 / 브랜드 / 지역 / 상태
 * - 편집 불가 (admin 또는 본사 담당자가 관리)
 */
import { Store, Building2, MapPin } from 'lucide-react';
import type { EnterpriseStoreInfo } from '@/lib/api/enterpriseHqApi';

interface Props {
  info: Extract<EnterpriseStoreInfo, { is_store: true }>;
}

export default function EnterpriseStoreInfoCard({ info }: Props) {
  return (
    <section className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
          <Store size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold tracking-tight">엔터프라이즈 매장</h2>
          <p className="mt-1 text-sm font-semibold text-ink">{info.store_name ?? '(매장명 미설정)'}</p>
          <ul className="mt-2 space-y-1 text-[11px] text-ink-mute">
            {info.enterprise_name && (
              <li className="flex items-center gap-1.5">
                <Building2 size={11} /> 본사: <b className="text-ink">{info.enterprise_name}</b>
                {info.brand_code && (
                  <span className="font-mono text-[10px] text-ink-dim">· {info.brand_code}</span>
                )}
              </li>
            )}
            <li className="flex items-center gap-1.5">
              <Store size={11} /> 프랜차이즈: <span>{info.franchise_name}</span>
            </li>
            {info.region_name && (
              <li className="flex items-center gap-1.5">
                <MapPin size={11} /> 지역: <span>{info.region_name}</span>
                {info.region_code && <span className="font-mono text-[10px] text-ink-dim">({info.region_code})</span>}
              </li>
            )}
            <li className="text-[10px] text-ink-dim mt-1">
              매장명/지역 변경은 본사 담당자 또는 관리자에게 요청해주세요.
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}
