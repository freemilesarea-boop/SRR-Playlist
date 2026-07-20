/**
 * EnvironmentBanner — AI-ENV-1.
 * 격리된 Test/Preview/Local 환경에서 상단에 명확한 배너를 표시해, Test 화면이
 * Production 으로 오인되지 않게 한다. Production 환경에서는 렌더하지 않는다.
 */
import { environmentValidation } from '@/lib/supabase';
import { maskProjectRef } from '@/lib/appEnvironment';

export default function EnvironmentBanner() {
  const v = environmentValidation;
  // Production/legacy(unknown, 기존 운영)에서는 배너를 표시하지 않는다.
  if (v.appEnvironment === 'production' || v.appEnvironment === 'unknown') return null;
  const isSafe = v.status === 'safe';
  return (
    <div
      className={`w-full px-3 py-1 text-center text-[11px] font-semibold ${isSafe ? 'bg-amber-500 text-black' : 'bg-red-600 text-white'}`}
      role="status"
    >
      TEST ENVIRONMENT · {v.appEnvironment.toUpperCase()} · {maskProjectRef(v.projectRef)} · Synthetic data only —
      결제/정산/이메일/SMS/외부 매장 제어 없음
    </div>
  );
}
