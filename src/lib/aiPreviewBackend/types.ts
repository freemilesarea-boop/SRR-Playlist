// AI-MUSIC-12 — Isolated Preview Backend Provisioning & Vercel Environment Rebinding types. Rule-based (NO
// LLM/ML). PURE audit/planning/validation tooling for standing up a SRR-Playlist-only isolated Preview backend
// and rebinding ONLY the Vercel Preview scope to it. It NEVER creates a Supabase project/branch, mutates any
// Vercel environment variable, applies a production migration, copies production data/auth/storage, changes the
// queue/playback, or implements a runtime hook. The audit found the org is on the `pro` plan (branches are
// cost-bearing) with no SRR-Playlist test project — so the backend decision is MANUAL_PROVISIONING_REQUIRED and
// no cost-bearing resource is created this phase.

// ── Infrastructure audit ──
export type ProjectRelation = 'PRODUCTION' | 'SRR_TEST' | 'UNRELATED' | 'UNKNOWN';
export interface SupabaseProjectInfo {
  ref: string;
  name: string;
  region: string;
  organizationId: string;
}
export interface ProjectClassification { ref: string; name: string; relation: ProjectRelation; reusable: boolean; reason: string; }
export interface InfrastructureAuditInput {
  productionRef: string;
  projects: SupabaseProjectInfo[];
  orgPlan: string;                       // 'free' | 'pro' | 'team' | 'enterprise'
  branchingAvailable: boolean;
  branchCostBearing: boolean;
  projectCreatePermission: boolean;
}
export interface InfrastructureAuditResult {
  productionRef: string;
  classifications: ProjectClassification[];
  srrTestProjectExists: boolean;
  branchingAvailable: boolean;
  branchCostBearing: boolean;
  reasons: string[];
}

// ── Backend strategy ──
export type BackendStrategyOption = 'A_SUPABASE_BRANCH' | 'B_SEPARATE_TEST_PROJECT' | 'C_LOCAL_SUPABASE' | 'D_SHARED_PRODUCTION';
export type BackendStrategyResult =
  | 'EXISTING_PROJECT_SELECTED' | 'BRANCH_CREATED' | 'TEST_PROJECT_CREATED' | 'MANUAL_PROVISIONING_REQUIRED'
  | 'LOCAL_ONLY_SELECTED' | 'BLOCKED' | 'NOT_AVAILABLE';
export interface BackendStrategyInput {
  srrTestProjectExists: boolean;
  branchingAvailable: boolean;
  branchCostBearing: boolean;
  projectCreatePermission: boolean;
  costApproved: boolean;                 // explicit human approval for a cost-bearing resource
  localSupabaseAvailable: boolean;
}
export interface BackendStrategy {
  option: BackendStrategyOption | null;
  result: BackendStrategyResult;
  recommendedName: string | null;
  estimatedCost: string;
  reasons: string[];
  manualSteps: string[];
}

// ── Isolation validator ──
export type BackendIsolationStatus =
  | 'ISOLATED' | 'PARTIAL' | 'SHARED_PROJECT' | 'SHARED_DB' | 'SHARED_AUTH' | 'SHARED_STORAGE'
  | 'PRODUCTION_SCOPE' | 'UNSAFE' | 'INSUFFICIENT_DATA';
export interface BackendIsolationInput {
  productionProjectRef: string;
  previewProjectRef: string | null;
  productionDbHostHash: string | null;
  previewDbHostHash: string | null;
  productionAuthTenantHash: string | null;
  previewAuthTenantHash: string | null;
  productionStorageNamespaceHash: string | null;
  previewStorageNamespaceHash: string | null;
  environmentScope: 'preview' | 'production' | 'development' | 'unknown';
  killSwitch: boolean;
  testbedEnabled: boolean;
}
export interface BackendIsolationResult { status: BackendIsolationStatus; blockers: string[]; }

// ── Schema baseline ──
export type SchemaBaselineStrategy = 'FULL_SCHEMA_EMPTY_DATA' | 'MINIMAL_COMPATIBLE_SCHEMA';
export interface SchemaBaselineResult {
  strategy: SchemaBaselineStrategy;
  usesProductionDump: false;             // NEVER a production dump
  usesMigrationSource: true;             // always from migration source
  reasons: string[];
}

// ── Migration dependency graph ──
export interface MigrationNode {
  id: string;
  name: string;
  requiredPredecessors: string[];        // ids that must precede (base + AI-MUSIC chain)
  createdTables: number;
  createdFunctions: number;
  reversible: boolean;
  risk: 'low' | 'medium' | 'high';
}
export type MigrationGraphStatus = 'VALID' | 'DEPENDENCY_MISSING' | 'ORDER_INVALID' | 'INSUFFICIENT_DATA';
export interface MigrationGraphResult {
  status: MigrationGraphStatus;
  orderedIds: string[];
  missing: string[];
  reasons: string[];
}

// ── Migration runner guard (dry-run) ──
export type MigrationRunnerResult =
  | 'DRY_RUN' | 'VALIDATION_ONLY' | 'ALLOWED_PREVIEW_APPLY' | 'REJECTED_PRODUCTION_REF' | 'REJECTED_SHARED_DB'
  | 'REJECTED_NOT_ISOLATED' | 'REJECTED_NO_CONFIRM';
export interface MigrationRunnerInput {
  targetProjectRef: string | null;
  productionProjectRef: string;
  isolationStatus: BackendIsolationStatus;
  confirmPreview: boolean;
  dryRun: boolean;
}
export interface MigrationRunnerGuard { result: MigrationRunnerResult; wouldApply: boolean; reasons: string[]; }

// ── Vercel environment ──
export type EnvScope = 'development' | 'preview' | 'production';
export interface EnvVarPresence { name: string; scope: EnvScope; present: boolean; projectRefHash: string | null; }
export interface EnvRebindingInput {
  previewProjectRef: string | null;
  productionProjectRef: string;
  previewSupabaseUrlPresent: boolean;
  previewServiceRoleScoped: boolean;
  isolationStatus: BackendIsolationStatus;
}
export type EnvRebindingStatus = 'PLAN_READY' | 'BLOCKED_NOT_ISOLATED' | 'BLOCKED_PRODUCTION_SCOPE' | 'INSUFFICIENT_DATA';
export interface EnvRebindingPlan {
  status: EnvRebindingStatus;
  previewScopeChanges: string[];         // Preview-scope-only variable changes (planned, not executed)
  productionScopeUntouched: true;        // structural guarantee
  redeployRequired: boolean;
  reasons: string[];
}

// ── Connection verification ──
export type ConnectionStatus =
  | 'CONNECTED_ISOLATED' | 'CONNECTED_PARTIAL' | 'MISBOUND' | 'PRODUCTION_BOUND' | 'NOT_DEPLOYED' | 'NOT_AVAILABLE';
export interface ConnectionInput {
  deployed: boolean;
  frontendProjectRef: string | null;
  serverProjectRef: string | null;
  productionProjectRef: string;
  isPreviewEnvironment: boolean;
  requiredBaseTablesPresent: boolean;
  superAdminFnPresent: boolean;
  testbedFlagsOff: boolean;
  killSwitchOn: boolean;
}
export interface ConnectionResult { status: ConnectionStatus; reasons: string[]; }

// ── Production invariance ──
export interface ProductionSnapshot {
  projectRef: string;
  supabaseUrlHash: string;
  anonKeyPresent: boolean;
  serviceRoleKeyPresent: boolean;
  migrationHead: string;
  deploymentSha: string;
}
export type InvarianceStatus = 'INVARIANT' | 'CHANGED' | 'INSUFFICIENT_DATA';
export interface InvarianceResult { status: InvarianceStatus; changed: string[]; }

// ── Rebinding state machine ──
export type RebindingState =
  | 'AUDIT_ONLY' | 'PLAN_READY' | 'PROVISIONING_REQUIRED' | 'BACKEND_CREATED' | 'SCHEMA_PENDING' | 'SCHEMA_READY'
  | 'ENV_PENDING' | 'ENV_BOUND' | 'REDEPLOY_REQUIRED' | 'CONNECTED' | 'VERIFIED' | 'BLOCKED'
  | 'ROLLBACK_REQUIRED' | 'ROLLED_BACK';

// ── Provisioning readiness ──
export type ProvisioningReadinessStatus =
  | 'READY_TO_PROVISION' | 'READY_TO_BIND' | 'READY_TO_APPLY_PREVIEW_SCHEMA' | 'ISOLATED_BACKEND_READY'
  | 'PARTIAL' | 'BLOCKED' | 'MANUAL_ACTION_REQUIRED' | 'NOT_AVAILABLE';
export interface ProvisioningReadinessInput {
  backendTypeSelected: boolean;
  costPlanKnown: boolean;
  backendCreated: boolean;               // an actual isolated backend exists
  dbIsolated: boolean;
  authIsolated: boolean;
  storageIsolated: boolean;
  schemaStrategyReady: boolean;
  migrationGraphValid: boolean;
  migrationRunnerReady: boolean;
  envPlanReady: boolean;
  productionInvariant: boolean;
  connectionVerified: boolean;
  rollbackReady: boolean;
  cleanupReady: boolean;
  securityReady: boolean;
}
export interface ProvisioningReadinessResult {
  status: ProvisioningReadinessStatus;
  satisfied: string[];
  missing: string[];
  manualActions: string[];
  nextPhase: string;
  runtimeHookImplemented: false;
}
