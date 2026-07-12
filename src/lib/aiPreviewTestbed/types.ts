// AI-MUSIC-11 — Internal Preview Testbed Provisioning & Canary Environment Readiness types. Rule-based (NO
// LLM/ML). This layer is PURE provisioning/validation tooling for building an isolated Preview-only testbed
// (internal test store, candidate playlist, canary DB fixtures, allowlist, rollback target) so a future
// single-store runtime proof COULD run. It NEVER changes production data, applies a production migration,
// creates a real store/account, changes the queue/playback, or runs a canary. The environment audit found the
// app uses ONE production Supabase for both Preview and Production (SHARED_PRODUCTION_DB) with no isolated
// Preview DB — so migration apply and fixture creation are DEFERRED and readiness is capped at PARTIAL/BLOCKED.

// ── Preview environment architecture ──
export type EnvironmentIsolation =
  | 'ISOLATED_PREVIEW_DB' | 'SHARED_PRODUCTION_DB' | 'LOCAL_ONLY' | 'PARTIAL_ISOLATION' | 'UNSAFE' | 'NOT_AVAILABLE';
export interface EnvironmentAuditInput {
  previewProjectRef: string | null;      // the Supabase project ref the Preview build connects to
  productionProjectRef: string;          // the known production project ref
  previewSupabaseUrl: string | null;
  productionSupabaseUrl: string | null;
  supabaseBranchingAvailable: boolean;
  localSupabaseAvailable: boolean;
  previewEnvVarsScopedSeparately: boolean;
  serverSideEnvVerification: boolean;
}
export interface EnvironmentAuditResult {
  isolation: EnvironmentIsolation;
  migrationApplyAllowed: boolean;        // true ONLY for a genuinely isolated preview/local DB
  reasons: string[];
}

// ── Preview database strategy ──
export type DbStrategyOption = 'A_SUPABASE_BRANCH' | 'B_SEPARATE_TEST_PROJECT' | 'C_LOCAL_SUPABASE' | 'D_SHARED_PROD_ROWS';
export type DbStrategyStatus = 'SELECTED' | 'RECOMMENDED' | 'NOT_AVAILABLE' | 'BLOCKED';
export interface DbStrategyResult {
  option: DbStrategyOption | null;
  status: DbStrategyStatus;
  reason: string;
  limitations: string[];
  cost: string;
}

// ── Preview migration plan (validation only; apply NOT RUN this phase) ──
export interface MigrationMeta {
  id: string;                            // e.g. '0464'
  name: string;
  newTables: number;
  newFunctions: number;
  altersExistingTables: boolean;
  dependsOn: string[];                   // prerequisite migration ids
  securityDefiner: boolean;
  usesSuperAdmin: boolean;
  authDependency: boolean;
}
export type MigrationPlanStatus = 'VALID' | 'DEPENDENCY_MISSING' | 'ORDER_INVALID' | 'APPLY_NOT_RUN' | 'BLOCKED';
export interface MigrationPlanResult {
  status: MigrationPlanStatus;
  orderedIds: string[];
  missingDependencies: string[];
  applied: false;                        // never applied this phase
  reasons: string[];
}

// ── Internal test store contract ──
export interface InternalTestStore {
  storeId: string;
  storeName: string;
  environment: string;                 // must be 'preview' — validated, not type-pinned (guards untrusted input)
  testOnly: boolean;
  customerStore: boolean;
  enterpriseStore: boolean;
  franchiseStore: boolean;
  createdBy: string;
  createdAtMs: number;
  expiresAtMs: number;
  cleanupRequired: boolean;
  purpose: string;
  testWindow: string | null;
  allowedDeploymentId: string | null;
}
export type FixtureValidity =
  | 'VALID' | 'MISSING' | 'NOT_PREVIEW' | 'NOT_TEST_ONLY' | 'CUSTOMER_STORE' | 'ENTERPRISE_STORE' | 'FRANCHISE_STORE'
  | 'PRODUCTION_ACCOUNT' | 'NO_EXPIRY' | 'EXPIRED' | 'NO_CLEANUP' | 'REAL_NAME' | 'REAL_EMAIL'
  | 'EMPTY_CANDIDATE' | 'VERSION_MISSING' | 'SNAPSHOT_MISSING' | 'SNAPSHOT_MISMATCH' | 'TOO_FEW_TRACKS'
  | 'NO_ROLLBACK_TARGET' | 'INSUFFICIENT_DATA';
export interface FixtureValidation { validity: FixtureValidity; reasons: string[]; }

// ── Internal test account ──
export interface InternalTestAccount {
  email: string;                         // a test alias, never a real employee/customer email
  role: 'store_player' | 'admin_reviewer';
  purpose: string;
  createdBy: string;
  expiresAtMs: number;
  testOnly: boolean;
  productionAccess: boolean;
}

// ── Playlist fixtures ──
export interface PlaylistFixture {
  playlistId: string;
  version: number;
  trackIds: string[];
  trackCount: number;
  snapshotHash: string | null;
  createdAtMs: number;
  testOnly: boolean;
}
export interface CandidateVersionSnapshot {
  candidatePlaylistId: string;
  candidateVersion: number;
  candidateTrackIds: string[];
  candidateSnapshotHash: string;
  generatedAtMs: number;
  approvedBy: string;
  immutable: boolean;
}
export interface RollbackTarget {
  existingPlaylistId: string;
  existingPlaylistVersion: number;
  existingSnapshotHash: string;
  existingQueueHash: string | null;
  existingResolverSource: string;
  storeId: string;
  capturedAtMs: number;
}

// ── Preview canary allowlist fixture (AI-MUSIC-7 contract) ──
export interface PreviewAllowlistFixture {
  storeId: string;
  environment: 'preview';
  deploymentId: string;
  candidatePlaylistId: string;
  candidateVersion: number;
  candidateSnapshotHash: string;
  maxSessions: number;                   // must be 1 — validated
  maxQueueApplications: number;
  approvedBy: string;
  approvedAtMs: number;
  expiresAtMs: number;
  enabled: boolean;                      // must be false this phase — validated
  reason: string;
}

// ── Deployment binding ──
export type DeploymentBindingStatus = 'BOUND' | 'PARTIAL' | 'NOT_AVAILABLE' | 'UNSAFE';
export interface DeploymentBindingInput {
  currentDeploymentId: string | null;
  allowedDeploymentId: string | null;
  stableAliasAvailable: boolean;
  runtimeDeploymentIdReadable: boolean;
}
export interface DeploymentBindingResult { status: DeploymentBindingStatus; reasons: string[]; }

// ── Test window / operator plan ──
export interface TestWindowPlan {
  testStartMs: number | null;
  testEndMs: number | null;
  operator: string | null;
  reviewer: string | null;
  rollbackOperator: string | null;
  incidentContact: string | null;
  maxDurationMs: number;
  maxSessions: number;
  maxApplications: number;
  stopConditions: string[];
  rollbackConditions: string[];
}
export type TestWindowStatus = 'PLANNED' | 'DRAFT' | 'INCOMPLETE';
export interface TestWindowResult { status: TestWindowStatus; missing: string[]; }

// ── Seeder / cleanup guards ──
export type SeederGuardResult = 'ALLOWED_DRY_RUN' | 'ALLOWED_PREVIEW' | 'REJECTED_PRODUCTION_REF' | 'REJECTED_NO_CONFIRM' | 'REJECTED_NOT_PREVIEW';
export interface SeederGuardInput {
  targetProjectRef: string | null;
  productionProjectRef: string;
  environment: string | null;
  confirmPreview: boolean;
  dryRun: boolean;
}
export interface SeederGuard { result: SeederGuardResult; reasons: string[]; wouldWrite: boolean; }

export type CleanupTag = 'AI_PREVIEW_TESTBED';
export interface CleanupScopeInput {
  targetProjectRef: string | null;
  productionProjectRef: string;
  tag: string;
  dryRun: boolean;
  confirm: boolean;
}
export type CleanupScopeResult = 'DRY_RUN_ONLY' | 'SCOPED_DELETE' | 'REJECTED_PRODUCTION_REF' | 'REJECTED_UNTAGGED' | 'REJECTED_NO_CONFIRM';
export interface CleanupScope { result: CleanupScopeResult; targets: string[]; reasons: string[]; }

// ── Isolation verification ──
export type IsolationStatus = 'ISOLATED' | 'PARTIAL' | 'UNSAFE' | 'NOT_AVAILABLE';
export interface IsolationInput {
  dbProjectRefDiffersFromProd: boolean;
  authSeparate: boolean;
  storageSeparate: boolean;
  storeIdCollisionFree: boolean;
  playlistIdCollisionFree: boolean;
  reachableOnlyFromPreviewDeployment: boolean;
  allowlistSingleStore: boolean;
  sessionCapOne: boolean;
  candidatePinned: boolean;
  expiryPresent: boolean;
  cleanupPossible: boolean;
}
export interface IsolationResult { status: IsolationStatus; blockers: string[]; }

// ── Testbed readiness certification ──
export type TestbedReadinessStatus =
  | 'READY_FOR_SINGLE_STORE_CHANGE_REQUEST' | 'READY_WITH_WARNINGS' | 'PARTIAL' | 'BLOCKED' | 'NOT_AVAILABLE' | 'INSUFFICIENT_DATA';
export interface TestbedReadinessInput {
  previewDbIsolated: boolean;
  migrationApplyAllowed: boolean;
  internalTestStoreCreated: boolean;
  testAccountCreated: boolean;
  existingPlaylistReady: boolean;
  candidatePlaylistReady: boolean;
  versionPinned: boolean;
  snapshotIntegrity: boolean;
  rollbackTargetReady: boolean;
  allowlistReady: boolean;
  deploymentBound: boolean;
  testWindowPlanned: boolean;
  operatorPlanned: boolean;
  cleanupReady: boolean;
  boundaryObservabilityReady: boolean;
  featureFlagsOff: boolean;
  killSwitchOn: boolean;
}
export interface TestbedReadinessResult {
  status: TestbedReadinessStatus;
  satisfied: string[];
  missing: string[];
  blockers: string[];
  nextAction: string[];
  runtimeHookImplemented: false;
}
