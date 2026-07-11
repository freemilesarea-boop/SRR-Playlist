// WEB-OBS-2 — Observability pure-logic barrel.
// Aggregation/scoring/detection helpers only. No browser APIs, no network, no side effects — all
// unit-tested. The admin API wrapper (src/lib/api/observabilityApi.ts) composes these over the
// server RPCs; the dashboard consumes the composed shapes.

export * from './math';
export * from './thresholds';
export * from './health';
export * from './release';
export * from './fingerprint';
export * from './spike';
export * from './risk';
export * from './incident';
export * from './releaseQuality';
export * from './rootCause';
export * from './config';
