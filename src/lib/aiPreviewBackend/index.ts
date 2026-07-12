// AI-MUSIC-12 — Isolated Preview Backend Provisioning & Vercel Environment Rebinding. Rule-based (NO LLM/ML).
// PURE audit/planning/validation tooling for standing up a SRR-Playlist-only isolated Preview backend and
// rebinding ONLY the Vercel Preview scope. It NEVER creates a Supabase project/branch, mutates a Vercel env var,
// applies a production migration, copies production data, changes the queue/playback, or implements a runtime
// hook. The audit found the org is on `pro` (branches cost-bearing) with no SRR test project → the decision is
// MANUAL_PROVISIONING_REQUIRED and no cost-bearing resource is created this phase.
export * from './types';
export { getAiPreviewBackendConfig, __resetAiPreviewBackendConfig, PRODUCTION_PROJECT_REF, ORG_ID, type AiPreviewBackendConfig } from './config';
export { auditInfrastructure, classifyProject, isProductionRef } from './infrastructure';
export { selectBackendStrategy } from './strategy';
export { validateBackendIsolation, isBackendIsolated } from './isolation';
export { decideSchemaBaseline, type SchemaBaselineInput } from './schemaBaseline';
export { AI_MUSIC_MIGRATION_GRAPH, validateMigrationGraph, type MigrationGraphInput } from './migrationGraph';
export { guardMigrationRunner } from './migrationRunner';
export { planEnvRebinding } from './vercelEnv';
export { verifyConnection } from './connection';
export { checkProductionInvariance } from './productionInvariance';
export { canRebindingTransition, nextRebindingStates } from './rebindingStateMachine';
export { buildRollbackPlan, ROLLBACK_STEPS, type RollbackInput, type RollbackPlan, type RollbackResult } from './rollback';
export { computeProvisioningReadiness } from './readiness';
