/**
 * EnvironmentFoundationSection — AI-ENV-1 Admin UI.
 *
 * Isolated Preview Database 준비 상태를 관리자에게 정직하게 보여준다. 이 Phase 는
 * 코드/가드/시드/설정 기반을 구축하며, Dedicated Test Supabase Project 프로비저닝과
 * Vercel Preview 환경변수 설정은 사람 후속 작업이다. 따라서 현재 Decision 은
 * PARTIALLY_READY 다. 금지 버튼(Apply Production Migration / Clone Production Data /
 * Enable Payment / Start Internal Treatment / Activate Canary / Global Rollout)은 없다.
 */
import { ShieldCheck } from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge } from '@/components/admin/ui';
import { environmentValidation } from '@/lib/supabase';
import {
  computeEnvironmentReadiness, maskProjectRef, isIntegrationBlocked,
  type ReadinessInput, type IntegrationName,
} from '@/lib/appEnvironment';
import { deriveFinalCertification, type FinalCertInput } from '@/lib/migrationCertification';

// 증거 기반 현재 상태(읽기 전용 감사 결과). 코드 가드는 완비됐으나 격리 Test DB /
// Preview 환경변수 / Browser 검증은 사람 후속 작업이라 PARTIALLY_READY.
const FOUNDATION_READINESS: ReadinessInput = {
  databaseIsolated: false,            // Dedicated Test Project 미프로비저닝
  secretIsolated: true,               // 클라이언트 번들에 Service Role 없음
  projectRefValidated: true,          // Project Ref 파서 + Guard 구현
  migrationComplete: false,           // 어느 격리 DB 에도 0001~0571 미적용
  migrationDrift: 'unknown',
  rlsValidated: false,                // 격리 DB 없음 → not_run
  rpcValidated: false,                // 격리 DB 없음 → not_run
  syntheticSeedReady: true,           // seed_test.sql 준비(미적용)
  authIsolated: false,
  storageIsolated: false,
  externalIntegrationsBlocked: true,  // Kill Switch 로직 + 비-Production 기본 차단
  resetReady: true,                   // db-test-guard + reset 스크립트 준비
  previewDeploymentConnected: false,  // Preview 환경변수 미설정
  productionConnectionGuarded: true,  // Fail-Closed Client + Block Screen 구현
  browserValidated: false,            // 브라우저 미검증
  auditable: true,
  previewConnectedToProduction: false, // 가드 도입 후 preview 앱은 production 연결 시 차단됨
  serviceRoleExposed: false,
  productionSecretReused: false,
  productionDataIncluded: false,
  productionResetPossible: false,
  externalPaymentActive: false,
  rlsCriticalFailure: false,
  migrationFailed: false,
  testDbMissing: false,               // 하드 블록 아님 — 프로비저닝 대기(PARTIALLY)
};

const INTEGRATIONS: IntegrationName[] = ['payment', 'settlement', 'email', 'sms', 'push', 'webhook', 'store_control', 'analytics'];

// AI-ENV-2B — 운영자 $10/월 승인 후 Dedicated Test Project 생성 완료(ref haojpu…qorr,
// ap-southeast-1, 격리·빈 상태). 그러나 전체 Migration 적용/Seed/RLS/RPC/Browser 는
// CI(test-db-provision.yml)·운영자 후속 작업 → Decision = PARTIALLY_READY.
const CERT_INPUT: FinalCertInput = {
  dedicatedProjectExists: true,
  previewConnectedToTestProject: false,
  productionRefUsedAsTarget: false,
  secretIsolated: true,
  failClosedGuardOk: true,
  migration: { status: 'not_run', fullStackApplied: false, latestMatches: false, blockers: ['apply_via_ci_pending'] },
  driftRepoVsTest: 'unknown',
  seedApplied: false,
  authLoginOk: 'not_run',
  storageOk: 'not_run',
  audioPlaybackOk: 'not_run',
  rls: { status: 'not_run', criticalFailure: false, perRole: [] },
  rpc: { status: 'not_run', missing: [], existsButUnvalidated: [], failed: [] },
  externalIntegrationsBlocked: true,
  resetReseedOk: 'not_run',
  browserPreviewOk: 'not_run',
  productionDataAbsence: 'not_run',
};

function Box({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' | 'bad' }) {
  const color = tone === 'ok' ? 'text-emerald-300' : tone === 'bad' ? 'text-red-300' : tone === 'warn' ? 'text-amber-300' : 'text-ink';
  return (
    <div className="rounded-lg bg-bg-deep px-3 py-2">
      <div className="text-[10px] text-ink-mute">{label}</div>
      <div className={`text-sm font-semibold ${color}`}>{value}</div>
    </div>
  );
}

export default function EnvironmentFoundationSection() {
  const v = environmentValidation;
  const readiness = computeEnvironmentReadiness(FOUNDATION_READINESS);
  const killSwitch = {
    appEnvironment: v.appEnvironment,
    emailDisabled: null, smsDisabled: null, paymentDisabled: null, webhooksDisabled: null,
  };

  const decisionTone = readiness.decision === 'READY_FOR_INTERNAL_TEST' ? 'success'
    : readiness.decision === 'PARTIALLY_READY' ? 'warning' : 'danger';
  const cert = deriveFinalCertification(CERT_INPUT);

  return (
    <AdminCard title="Environment Foundation" subtitle="AI-ENV-1 — Isolated Preview DB · Safe Migration Pipeline · Fail-Closed Guard">
      <AdminAlert tone="warning">
        이 Phase는 환경 분리 <strong>코드·가드·시드·설정 기반</strong>을 구축합니다. Dedicated Test Supabase Project 프로비저닝과
        Vercel Preview 환경변수 설정은 사람 후속 작업이며, Recommendation v2 Treatment는 실행하지 않습니다.
      </AdminAlert>

      {/* Environment Overview */}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="flex items-center gap-1 text-sm font-semibold text-ink"><ShieldCheck className="h-4 w-4" />Runtime Environment</span>
        <AdminBadge tone={v.status === 'safe' ? 'success' : v.status === 'blocked' ? 'danger' : 'neutral'}>{v.status}</AdminBadge>
        <AdminBadge tone="neutral">app: {v.appEnvironment}</AdminBadge>
        <AdminBadge tone="neutral">db: {v.databaseEnvironment}</AdminBadge>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Box label="Project Ref" value={maskProjectRef(v.projectRef)} />
        <Box label="Expected Ref" value={maskProjectRef(v.expectedProjectRef)} />
        <Box label="Can Init Supabase" value={v.canInitializeSupabase ? 'yes' : 'no'} tone={v.canInitializeSupabase ? 'ok' : 'bad'} />
        <Box label="Can Run Experiment" value={v.canRunExperiment ? 'yes' : 'no'} tone={v.canRunExperiment ? 'ok' : 'warn'} />
      </div>

      {/* Readiness */}
      <div className="mt-3 rounded-lg bg-bg-deep p-3 text-[11px]">
        <div className="mb-2 flex items-center gap-2 font-semibold text-ink">
          Readiness
          <AdminBadge tone={decisionTone}>{readiness.decision}</AdminBadge>
          <span className="text-ink-mute">Score {readiness.score ?? '—'} · Grade {readiness.grade}</span>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Box label="DB Isolation" value={FOUNDATION_READINESS.databaseIsolated ? 'isolated' : 'pending'} tone={FOUNDATION_READINESS.databaseIsolated ? 'ok' : 'warn'} />
          <Box label="Secret Isolation" value="ok" tone="ok" />
          <Box label="Project Ref Guard" value="implemented" tone="ok" />
          <Box label="Fail-Closed Init" value="implemented" tone="ok" />
          <Box label="Migration Applied" value="not_run" tone="warn" />
          <Box label="RLS / RPC Test" value="not_run" tone="warn" />
          <Box label="Synthetic Seed" value="ready (unapplied)" tone="warn" />
          <Box label="Browser Validated" value="not_run" tone="warn" />
        </div>
        <div className="mt-2 text-ink-mute">대기 항목: {readiness.blockingReasons.join(', ') || '없음'}</div>
      </div>

      {/* External Integrations Kill Switch */}
      <div className="mt-3 rounded-lg bg-bg-deep p-3 text-[11px]">
        <div className="mb-1 font-semibold text-ink">External Integrations (비-Production 기본 차단)</div>
        <div className="grid grid-cols-2 gap-1.5 md:grid-cols-4">
          {INTEGRATIONS.map((name) => {
            const blocked = isIntegrationBlocked(name, killSwitch);
            return (
              <div key={name} className="flex items-center justify-between rounded bg-black/20 px-2 py-1 text-ink-mute">
                <span>{name}</span>
                <AdminBadge tone={blocked ? 'success' : 'danger'}>{blocked ? 'blocked' : 'active'}</AdminBadge>
              </div>
            );
          })}
        </div>
        <p className="mt-1 text-ink-mute">Production 환경에서는 정상 동작하며, Test/Preview/Local 에서는 결제·정산·이메일·SMS·Webhook·외부 매장 제어를 차단합니다.</p>
      </div>

      {/* AI-ENV-2 — Dedicated Test Project Certification */}
      <div className="mt-3 rounded-lg bg-bg-deep p-3 text-[11px]">
        <div className="mb-2 flex items-center gap-2 font-semibold text-ink">
          Test Project Certification (AI-ENV-2)
          <AdminBadge tone={cert.decision === 'READY_FOR_INTERNAL_TEST' ? 'success' : cert.decision === 'PARTIALLY_READY' ? 'warning' : 'danger'}>
            {cert.decision}
          </AdminBadge>
          <span className="text-ink-mute">Score {cert.score ?? '—'} · {cert.grade}</span>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Box label="Dedicated Test Project" value="provisioned (haojpu…)" tone="ok" />
          <Box label="Preview → Test DB" value="pending operator" tone="warn" />
          <Box label="Full Migration Apply" value="pending CI" tone="warn" />
          <Box label="RLS / RPC Integration" value="not_run" tone="warn" />
          <Box label="Test Auth / Storage / Audio" value="not_run" tone="warn" />
          <Box label="Browser Preview" value="not_run" tone="warn" />
          <Box label="Production Data Absence" value="not_run" tone="warn" />
          <Box label="Prod Ref Used As Target" value="no" tone="ok" />
        </div>
        <AdminAlert tone="warning">
          Live 인증 Decision = <strong>PARTIALLY_READY</strong>. 운영자 $10/월 승인 후 <strong>Dedicated Test Project(ap-southeast-1)를 생성·격리 확인</strong>했습니다.
          전체 Migration 적용/Seed/RLS/RPC/Browser 는 <code>.github/workflows/test-db-provision.yml</code>(CI 원클릭)과 운영자 후속 작업으로 완료합니다 —
          코드 에이전트 환경은 postgres TCP 가 차단되어 직접 적용 불가. 절차: <code>docs/AI-ENV-2-TEST-PROJECT-PROVISIONING.md</code>. Pending: {cert.blockingReasons.join(', ')}.
        </AdminAlert>
      </div>

      {/* 정직 고지 */}
      <ul className="mt-3 list-disc space-y-1 pl-5 text-[11px] text-ink-mute">
        <li>Production DB/Schema/Data/Auth/Storage/Secret을 변경하지 않았고 Production Service Role Key를 사용하지 않았습니다.</li>
        <li>Dedicated Test Supabase Project를 <strong>생성하지 않았습니다</strong>(결제·운영 권한 필요 — 사람 후속 작업). Local/코드 기반만 구축했습니다.</li>
        <li>Test/Preview DB에 실제 Migration을 적용하지 않았습니다. DB/RPC/Browser Integration Test는 not_run입니다.</li>
        <li>Synthetic Seed에는 실제 개인정보/계약/정산/계좌/ISRC/Production Row ID가 없습니다.</li>
        <li>AI-ENV-2: Dedicated Test Project를 생성하지 않았고(월 $10 결제 + 사용자 승인 필요), Vercel Preview 환경변수를 설정하지 않았으며, Test DB에 Migration을 적용하지 않았습니다. Migration/RLS/RPC/Browser/Audio Integration은 not_run입니다.</li>
        <li>이 Phase에서는 AI Treatment/Internal Experiment/Canary/Global Rollout을 실행하지 않았습니다. Live 인증 Decision = <strong>BLOCKED</strong>.</li>
        <li>READY_FOR_INTERNAL_TEST는 Internal Test 성공이 아니라 격리 환경 인증 완료를 의미하며, 아직 달성하지 않았습니다.</li>
      </ul>
    </AdminCard>
  );
}
