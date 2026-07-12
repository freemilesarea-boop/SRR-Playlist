// AI-MUSIC-12 — Existing infrastructure audit. Classifies every Supabase project by its relation to SRR Playlist
// (never by name alone): the production project, an SRR test project (name starts with `srr-playlist-` AND is not
// production), or an UNRELATED app (never reusable). Records branching availability + cost. Pure & deterministic.

import type { InfrastructureAuditInput, InfrastructureAuditResult, ProjectClassification, ProjectRelation } from './types';

const SRR_TEST_PREFIXES = ['srr-playlist-preview', 'srr-playlist-test', 'srr-playlist-canary'];

export function classifyProject(ref: string, name: string, productionRef: string): ProjectClassification {
  if (ref === productionRef) return { ref, name, relation: 'PRODUCTION', reusable: false, reason: 'Production Project — 재사용 금지' };
  const lower = name.trim().toLowerCase();
  const isSrrTest = SRR_TEST_PREFIXES.some((p) => lower.startsWith(p));
  if (isSrrTest) return { ref, name, relation: 'SRR_TEST', reusable: true, reason: 'SRR Playlist 전용 Test Project — 재사용 가능' };
  // Any other project (e.g. an unrelated app) is NEVER reusable, regardless of name.
  return { ref, name, relation: 'UNRELATED', reusable: false, reason: '관련 없는 Project — 재사용 금지' };
}

export function auditInfrastructure(i: InfrastructureAuditInput): InfrastructureAuditResult {
  const classifications = i.projects.map((p) => classifyProject(p.ref, p.name, i.productionRef));
  const srrTestProjectExists = classifications.some((c) => c.relation === 'SRR_TEST');
  const reasons: string[] = [];
  reasons.push(`Projects: ${classifications.map((c) => `${c.name}=${c.relation}`).join(', ')}`);
  reasons.push(`Org plan: ${i.orgPlan} · branching ${i.branchingAvailable ? '가능' : '불가'}${i.branchCostBearing ? ' (비용 발생)' : ''}`);
  if (!srrTestProjectExists) reasons.push('SRR Playlist 전용 Test Project 없음 — 재사용 불가');
  return { productionRef: i.productionRef, classifications, srrTestProjectExists, branchingAvailable: i.branchingAvailable, branchCostBearing: i.branchCostBearing, reasons };
}

export function isProductionRef(ref: string | null, productionRef: string): ref is string {
  return ref != null && ref.trim() === productionRef.trim();
}

export type { ProjectRelation };
