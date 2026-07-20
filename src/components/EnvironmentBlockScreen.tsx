/**
 * EnvironmentBlockScreen — AI-ENV-1.
 * Preview/Test 앱이 Production Project Ref 에 연결되거나 환경 설정이 안전하지 않을 때
 * Player/Admin 을 렌더하기 전에 표시한다. Production 데이터에 접근하지 않았음을 안내하며,
 * Full URL / Anon Key / Service Role / Token / 개인정보는 표시하지 않는다.
 */
import { AlertTriangle } from 'lucide-react';
import { maskProjectRef, type EnvironmentValidationResult } from '@/lib/appEnvironment';

const REASON_LABEL: Record<string, string> = {
  production_project_in_preview: 'Preview/Test 환경이 Production 데이터베이스에 연결되어 차단했습니다.',
  expected_ref_mismatch: '기대한 Test 프로젝트와 실제 연결된 프로젝트가 일치하지 않습니다.',
  service_role_exposed: 'Service Role Key 가 클라이언트에 노출되어 차단했습니다.',
  unknown_project_ref: '프로젝트 식별을 확인할 수 없어 안전을 위해 차단했습니다.',
  missing_supabase_url: 'Supabase URL 이 설정되지 않았습니다.',
  missing_anon_key: 'Supabase Anon Key 가 설정되지 않았습니다.',
  environment_mismatch: '환경(App)과 데이터베이스가 일치하지 않습니다.',
};

export default function EnvironmentBlockScreen({ result, onRetry }: { result: EnvironmentValidationResult; onRetry?: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-deep px-6 text-ink">
      <div className="w-full max-w-md rounded-2xl border border-red-500/40 bg-bg p-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/15">
          <AlertTriangle className="h-6 w-6 text-red-400" />
        </div>
        <h1 className="text-lg font-bold text-ink">환경 안전 차단</h1>
        <p className="mt-1 text-sm text-ink-mute">
          안전하지 않은 환경 연결이 감지되어 앱을 차단했습니다. <strong>Production 데이터에는 접근하지 않았습니다.</strong>
        </p>

        <div className="mt-4 space-y-1 rounded-lg bg-bg-deep p-3 text-left text-xs text-ink-mute">
          <div>App Environment: <span className="text-ink">{result.appEnvironment}</span></div>
          <div>Detected Database: <span className="text-ink">{result.databaseEnvironment}</span></div>
          <div>Project Ref: <span className="text-ink">{maskProjectRef(result.projectRef)}</span></div>
          <div>Expected: <span className="text-ink">{maskProjectRef(result.expectedProjectRef)}</span></div>
          <div>Status: <span className="font-semibold text-red-400">{result.status}</span></div>
        </div>

        <ul className="mt-3 list-disc space-y-1 pl-5 text-left text-xs text-ink-mute">
          {result.reasons.map((r) => <li key={r}>{REASON_LABEL[r] ?? r}</li>)}
        </ul>

        <p className="mt-3 text-[11px] text-ink-mute">
          해결: 이 환경의 <code>VITE_SUPABASE_URL</code> · <code>VITE_EXPECTED_SUPABASE_PROJECT_REF</code> · <code>VITE_APP_ENV</code> 를
          격리된 Test/Preview 프로젝트 값으로 설정한 뒤 새 배포를 만들어 주세요.
        </p>

        {onRetry ? (
          <button type="button" onClick={onRetry} className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-black">
            다시 시도
          </button>
        ) : null}
      </div>
    </div>
  );
}
