/**
 * enterpriseKnowledgeHub — Enterprise E-5 (Enterprise Knowledge Hub).
 *
 * Decision/Governance/Audit/Incident/Review/Policy/Executive Insight 를 조직의
 * 지식 자산으로 연결하는 Knowledge Layer. 신규 Knowledge Engine/Search Engine/
 * AI 모델 없음 — 입력은 전부 기존 adminApi wrapper 반환값(0479 Action Center ·
 * 0512 Policy Registry · 0510 Access Review · 0502 Incident/Recovery ·
 * 0503 Executive Recommendation)이며, 이 모듈은 결정적(pure)으로
 * 정규화/부분 문자열 검색/집계만 수행한다.
 *
 * 원칙:
 *  - AI 는 새로운 지식을 생성하지 않는다 — 기존 기록을 검색·연결·요약한다.
 *  - 검색은 이미 조회된 기존 데이터에 대한 대소문자 무시 부분 문자열 매칭이다
 *    (신규 검색 엔진/인덱스/임베딩 없음).
 *  - 없는 데이터는 추론하지 않는다 — insufficient_data 로 표시한다.
 */
import { clampScore } from './aiMemory';

// ── 상수 (스펙 1:1) ─────────────────────────────────────────────────────

export const KNOWLEDGE_SOURCES = ['decision', 'policy', 'incident', 'review', 'audit', 'executive'] as const;
export type KnowledgeSource = (typeof KNOWLEDGE_SOURCES)[number];

export const KNOWLEDGE_QUALITY_LEVELS = ['available', 'partial', 'archived', 'insufficient_data'] as const;
export type KnowledgeQuality = (typeof KNOWLEDGE_QUALITY_LEVELS)[number];

export const KNOWLEDGE_RELATIONSHIP_FLOW = ['incident', 'review', 'decision', 'policy', 'audit', 'knowledge'] as const;
export type KnowledgeStage = (typeof KNOWLEDGE_RELATIONSHIP_FLOW)[number];

export const KNOWLEDGE_RELATIONSHIP_EDGES: Array<{ from: KnowledgeStage; to: KnowledgeStage; via: string }> = [
  { from: 'incident', to: 'review', via: '장애 경험이 검토 요청의 입력이 된다' },
  { from: 'review', to: 'decision', via: '검토 결과가 사람의 결정 근거가 된다' },
  { from: 'decision', to: 'policy', via: '반복되는 결정이 Policy 로 정리된다(사람이 수행)' },
  { from: 'policy', to: 'audit', via: 'Policy 준수 여부가 감사 기록으로 남는다' },
  { from: 'audit', to: 'knowledge', via: '감사 기록이 조직 지식으로 축적된다' },
];

export const KNOWLEDGE_POLICY_DOMAINS = ['enterprise', 'financial', 'music', 'security', 'governance'] as const;

/** 금지 목록 — 스펙 금지 사항 1:1. */
export const KNOWLEDGE_BLOCKED_ACTIONS = [
  'automatic_knowledge_generation', 'automatic_policy_creation', 'automatic_approval',
  'automatic_contract_approval', 'automatic_payment', 'automatic_merge',
  'automatic_deploy', 'automatic_production_apply',
] as const;

export function isBlockedKnowledgeAction(action: string): boolean {
  return (KNOWLEDGE_BLOCKED_ACTIONS as readonly string[]).includes(action) || action.startsWith('automatic_');
}

// ── 입력 피드 (기존 wrapper 반환값의 최소 필드) ─────────────────────────

export interface KHActionRow {
  id: string; command_type: string; status: string; reason?: string | null;
  requested_at?: string | null; requested_by_name?: string | null;
}
export interface KHPolicyRow { id: string; policy_code: string; domain: string; title: string; status: string; created_at: string }
export interface KHIncidentRow {
  id: string; incident_code: string; incident_type: string; severity: string; status: string;
  detected_at: string; resolved_at: string | null; evidence: unknown[];
}
export interface KHRecoveryRow { id: string; recovery_code: string; strategy_type: string; status: string; description: string | null; created_at: string }
export interface KHAccessReviewRow { id: string; review_code: string; review_scope: string; review_status: string; created_at: string }
export interface KHExecRecoRow { id: string; rec_code: string; category: string; title: string; status: string; created_at: string; evidence: unknown[] }

export interface KnowledgeFeeds {
  actionHistory: KHActionRow[] | null;      // fetchActionHistory (0479)
  policies: KHPolicyRow[] | null;           // fetchPolicyInventory (0512)
  incidents: KHIncidentRow[] | null;        // fetchIncidents (0502)
  recoveries: KHRecoveryRow[] | null;       // fetchRecoveryCandidates (0502)
  accessReviews: KHAccessReviewRow[] | null; // fetchAccessReviews (0510)
  execRecommendations: KHExecRecoRow[] | null; // fetchExecRecommendations (0503)
}

export function emptyKnowledgeFeeds(): KnowledgeFeeds {
  return { actionHistory: null, policies: null, incidents: null, recoveries: null, accessReviews: null, execRecommendations: null };
}

// ── Knowledge Item 정규화 (변환만 — 지식 생성/재작성 없음) ───────────────

export interface KnowledgeItem {
  id: string;
  source: KnowledgeSource;
  title: string;
  detail: string;
  status: string;
  createdAt: string | null;
  evidenceCount: number | null; // 원본에 evidence 배열이 없으면 null (조작 금지)
}

export function normalizeKnowledgeItems(feeds: KnowledgeFeeds): {
  items: KnowledgeItem[];
  unobservedSources: KnowledgeSource[];
} {
  const items: KnowledgeItem[] = [];
  const observed = new Set<KnowledgeSource>();

  if (feeds.actionHistory != null) {
    observed.add('audit');
    for (const r of feeds.actionHistory) {
      items.push({
        id: `audit-${r.id}`, source: 'audit', title: r.command_type,
        detail: r.reason ?? '', status: r.status, createdAt: r.requested_at ?? null, evidenceCount: null,
      });
      if (r.command_type.startsWith('decision_')) {
        observed.add('decision');
        items.push({
          id: `decision-${r.id}`, source: 'decision', title: r.command_type.replace('decision_', 'decision: '),
          detail: r.reason ?? '', status: r.status, createdAt: r.requested_at ?? null, evidenceCount: null,
        });
      }
      if (r.command_type.startsWith('executive_')) {
        observed.add('executive');
        items.push({
          id: `executive-${r.id}`, source: 'executive', title: r.command_type.replace('executive_', 'executive: '),
          detail: r.reason ?? '', status: r.status, createdAt: r.requested_at ?? null, evidenceCount: null,
        });
      }
    }
  }
  if (feeds.policies != null) {
    observed.add('policy');
    for (const p of feeds.policies) {
      items.push({ id: `policy-${p.id}`, source: 'policy', title: `${p.policy_code} · ${p.title}`, detail: p.domain, status: p.status, createdAt: p.created_at, evidenceCount: null });
    }
  }
  if (feeds.incidents != null) {
    observed.add('incident');
    for (const i of feeds.incidents) {
      items.push({
        id: `incident-${i.id}`, source: 'incident', title: `${i.incident_code} · ${i.incident_type}`,
        detail: `severity=${i.severity}${i.resolved_at != null ? ' · resolved' : ''}`, status: i.status,
        createdAt: i.detected_at, evidenceCount: Array.isArray(i.evidence) ? i.evidence.length : null,
      });
    }
  }
  if (feeds.recoveries != null) {
    observed.add('incident');
    for (const r of feeds.recoveries) {
      items.push({ id: `recovery-${r.id}`, source: 'incident', title: `${r.recovery_code} · ${r.strategy_type}`, detail: r.description ?? '', status: r.status, createdAt: r.created_at, evidenceCount: null });
    }
  }
  if (feeds.accessReviews != null) {
    observed.add('review');
    for (const r of feeds.accessReviews) {
      items.push({ id: `review-${r.id}`, source: 'review', title: `${r.review_code} · ${r.review_scope}`, detail: 'access review', status: r.review_status, createdAt: r.created_at, evidenceCount: null });
    }
  }
  if (feeds.execRecommendations != null) {
    observed.add('executive');
    for (const r of feeds.execRecommendations) {
      items.push({
        id: `execreco-${r.id}`, source: 'executive', title: `${r.rec_code} · ${r.title}`, detail: r.category,
        status: r.status, createdAt: r.created_at, evidenceCount: Array.isArray(r.evidence) ? r.evidence.length : null,
      });
    }
  }

  items.sort((a, b) => {
    const ta = a.createdAt == null ? 0 : Date.parse(a.createdAt);
    const tb = b.createdAt == null ? 0 : Date.parse(b.createdAt);
    return tb - ta || a.id.localeCompare(b.id);
  });
  return { items, unobservedSources: KNOWLEDGE_SOURCES.filter((s) => !observed.has(s)) };
}

// ── Knowledge Overview (최상단 카드 8필드) ──────────────────────────────

export interface KnowledgeOverviewCard {
  totalKnowledge: number | null;
  decisionsIndexed: number | null;
  reviewsIndexed: number | null;
  incidentsIndexed: number | null;
  policiesIndexed: number | null;
  auditRecords: number | null;
  executiveNotes: number | null;
  knowledgeCoveragePct: number; // 관측 소스 / 6 — 커버리지이며 지식 완전성 아님
}

export function buildKnowledgeOverview(feeds: KnowledgeFeeds): KnowledgeOverviewCard {
  const { items, unobservedSources } = normalizeKnowledgeItems(feeds);
  const bySource = (s: KnowledgeSource): number | null =>
    unobservedSources.includes(s) ? null : items.filter((i) => i.source === s).length;
  const anyObserved = unobservedSources.length < KNOWLEDGE_SOURCES.length;
  return {
    totalKnowledge: anyObserved ? items.length : null,
    decisionsIndexed: bySource('decision'),
    reviewsIndexed: bySource('review'),
    incidentsIndexed: bySource('incident'),
    policiesIndexed: bySource('policy'),
    auditRecords: bySource('audit'),
    executiveNotes: bySource('executive'),
    knowledgeCoveragePct: clampScore(((KNOWLEDGE_SOURCES.length - unobservedSources.length) / KNOWLEDGE_SOURCES.length) * 100),
  };
}

// ── Knowledge Search (기존 데이터 부분 문자열 매칭 — 엔진 아님) ──────────

export interface KnowledgeSearchResult {
  matches: KnowledgeItem[];
  countsBySource: Array<{ source: KnowledgeSource; count: number }>;
  totalMatches: number;
  query: string;
  note: string;
}

export function searchKnowledge(
  items: KnowledgeItem[],
  query: string,
  source: KnowledgeSource | null = null,
  limit = 50,
): KnowledgeSearchResult {
  const q = query.trim().toLowerCase();
  if (q === '') {
    return { matches: [], countsBySource: [], totalMatches: 0, query: '', note: '검색어 없음 — 결과를 생성하지 않습니다' };
  }
  const matches = items.filter((i) =>
    (source == null || i.source === source)
    && (`${i.title} ${i.detail} ${i.status}`.toLowerCase().includes(q)));
  const countsBySource = KNOWLEDGE_SOURCES
    .map((s) => ({ source: s, count: matches.filter((m) => m.source === s).length }))
    .filter((c) => c.count > 0);
  return {
    matches: matches.slice(0, Math.max(1, limit)),
    countsBySource,
    totalMatches: matches.length,
    query: q,
    note: '이미 조회된 기존 기록에 대한 부분 문자열 매칭 — 신규 검색 엔진/인덱스 없음',
  };
}

// ── AI Knowledge Summary (검색 결과 5줄 이내 결정적 요약) ───────────────

export function buildKnowledgeSummaryLines(result: KnowledgeSearchResult): string[] {
  if (result.query === '') return ['검색어가 없어 요약을 생성하지 않습니다.'];
  if (result.totalMatches === 0) return [`'${result.query}' 와 일치하는 기존 기록이 없습니다 — 지식을 지어내지 않습니다.`];
  const lines: string[] = [];
  const count = (s: KnowledgeSource) => result.countsBySource.find((c) => c.source === s)?.count ?? 0;
  if (count('incident') > 0) lines.push(`유사 Incident 기록이 ${count('incident')}건 존재합니다.`);
  if (count('policy') > 0) lines.push(`관련 Policy ${count('policy')}건이 등록되어 있습니다.`);
  if (count('review') > 0) lines.push(`기존 Review 결과 ${count('review')}건을 참고할 수 있습니다.`);
  if (count('decision') > 0) lines.push(`과거 결정 기록 ${count('decision')}건이 있습니다.`);
  if (count('audit') > 0) lines.push(`관련 Audit 기록 ${count('audit')}건이 존재합니다.`);
  if (count('executive') > 0) lines.push(`Executive 기록 ${count('executive')}건이 있습니다.`);
  if (lines.length === 0) lines.push(`일치 ${result.totalMatches}건 — 소스 분류 없음.`);
  return lines.slice(0, 5);
}

// ── Knowledge Relationships ─────────────────────────────────────────────

export function buildKnowledgeRelationships(feeds: KnowledgeFeeds): Array<{
  stage: KnowledgeStage;
  observed: boolean;
  note: string;
}> {
  const decisions = feeds.actionHistory?.filter((r) => r.command_type.startsWith('decision_')) ?? null;
  return KNOWLEDGE_RELATIONSHIP_FLOW.map((stage) => {
    switch (stage) {
      case 'incident': return { stage, observed: feeds.incidents != null || feeds.recoveries != null, note: 'Incident/Recovery 원장(0502)' };
      case 'review': return { stage, observed: feeds.accessReviews != null, note: 'Access Review(0510)' };
      case 'decision': return { stage, observed: decisions != null && decisions.length > 0, note: 'decision_* 감사 기록(0479)' };
      case 'policy': return { stage, observed: feeds.policies != null, note: 'Policy Registry(0512)' };
      case 'audit': return { stage, observed: feeds.actionHistory != null, note: 'Action Center 감사 원장(0479)' };
      case 'knowledge': return { stage, observed: false, note: '통합 지식 계층(이 화면) — 별도 저장소 없음(신규 생성 금지)' };
      default: return { stage, observed: false, note: '' };
    }
  });
}

// ── Knowledge Quality (Available/Partial/Archived/Insufficient Data) ────

export interface KnowledgeQualityEntry {
  source: string;
  level: KnowledgeQuality;
  itemCount: number | null;
  archivedCount: number | null;
  note: string;
}

const ARCHIVED_STATUSES = new Set(['archived', 'retired', 'expired']);

export function assessKnowledgeQuality(feeds: KnowledgeFeeds): KnowledgeQualityEntry[] {
  const entry = (source: string, rows: Array<{ status: string }> | null): KnowledgeQualityEntry => {
    if (rows == null) return { source, level: 'insufficient_data', itemCount: null, archivedCount: null, note: '피드 미관측 — 추론하지 않음' };
    const archived = rows.filter((r) => ARCHIVED_STATUSES.has(r.status)).length;
    if (rows.length === 0) return { source, level: 'partial', itemCount: 0, archivedCount: 0, note: '피드 관측됨 — 관측 창 내 기록 0건' };
    if (archived === rows.length) return { source, level: 'archived', itemCount: rows.length, archivedCount: archived, note: '전 건 보관 상태' };
    return { source, level: 'available', itemCount: rows.length, archivedCount: archived, note: archived > 0 ? `보관 ${archived}건 포함` : '관측됨' };
  };
  return [
    entry('actionHistory_0479', feeds.actionHistory),
    entry('policies_0512', feeds.policies),
    entry('incidents_0502', feeds.incidents),
    entry('recoveries_0502', feeds.recoveries),
    entry('accessReviews_0510', (feeds.accessReviews ?? null)?.map((r) => ({ status: r.review_status })) ?? null),
    entry('execRecommendations_0503', feeds.execRecommendations),
  ];
}
