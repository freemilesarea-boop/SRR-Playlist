// AI-MUSIC-11 — Internal Preview Testbed Provisioning & Canary Environment Readiness. Rule-based (NO LLM/ML).
// PURE provisioning/validation tooling for building an isolated Preview-only testbed so a future single-store
// runtime proof COULD run. It NEVER changes production data, applies a production migration, creates a real
// store/account, changes the queue/playback, or runs a canary. The environment audit found the app SHARES the
// production Supabase between Preview and Production (no isolated Preview DB) — so migration apply and fixture
// creation are DEFERRED and readiness is capped at PARTIAL/BLOCKED this phase.
export * from './types';
export { getAiPreviewTestbedConfig, __resetAiPreviewTestbedConfig, PRODUCTION_PROJECT_REF, type AiPreviewTestbedConfig } from './config';
export { auditEnvironment, isProductionProjectRef } from './environment';
export { recommendDbStrategy, type DbStrategyInput } from './dbStrategy';
export { AI_MUSIC_MIGRATIONS, validateMigrationPlan, type MigrationPlanInput } from './migrationPlan';
export { computeSnapshotHash, snapshotMatches } from './snapshot';
export {
  validateTestStore, validateTestAccount, validateExistingPlaylist, validateCandidatePlaylist,
  validateCandidateVersionSnapshot, validateRollbackTarget, validateAllowlist,
} from './fixtures';
export { evaluateDeploymentBinding } from './deploymentBinding';
export { validateTestWindow, DEFAULT_STOP_CONDITIONS } from './testWindow';
export { guardSeeder } from './seeder';
export { guardCleanup, CLEANUP_TAG, CLEANUP_TARGETS } from './cleanup';
export { verifyIsolation } from './isolation';
export { computeTestbedReadiness } from './readiness';
