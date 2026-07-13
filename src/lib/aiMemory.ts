/**
 * aiMemory — Long-Term Memory, Knowledge Graph & Pattern Intelligence 순수 로직 (Phase AI-MUSIC-10).
 *
 * 과거 운영 경험을 구조화된 Memory 로 보존 → Quality/Freshness 평가 → Contextual Retrieval →
 * Pattern Discovery → Experience Replay → Multi-Agent Evidence 로 제공하는 계산 계층.
 *
 * 원칙:
 *  - deterministic · pure function · Date 주입(now 파라미터) · 랜덤/외부 API 없음.
 *  - 없는 성분은 null 유지 + 존재 성분만 재정규화(null→0 변환 금지) · NaN/Infinity 방어.
 *  - Outcome 없는 성공 Memory 없음 · Sample 부족 시 validated 금지 · 상관≠인과.
 *  - Memory/Pattern 은 Evidence 계층 — Production Entity 변경 없음.
 */
export const isFiniteNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
export const clampScore = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

/* ── 타입 ───────────────────────────────────────────────────────────────── */
export type MemoryType = 'episodic' | 'semantic' | 'procedural' | 'negative' | 'observation';
export type MemoryScope = 'global' | 'industry' | 'brand' | 'store' | 'playlist' | 'track' | 'artist' | 'context' | 'strategy' | 'agent';
export type LifecycleStatus = 'candidate' | 'active' | 'provisional' | 'stale' | 'contradicted' | 'superseded' | 'archived' | 'blocked';
export type OutcomeStatus = 'improved' | 'neutral' | 'degraded' | 'pending_outcome' | 'observation_only';
export type QualityGrade = 'high' | 'medium' | 'low' | 'provisional' | 'insufficient_data';
export type PatternStatus = 'hypothesis' | 'emerging' | 'provisional' | 'validated' | 'contradicted' | 'deprecated' | 'insufficient_data';
export type ContradictionLevel = 'weak_contradiction' | 'meaningful_contradiction' | 'strong_contradiction' | 'unresolved_conflict';
export type ReplayAssessment = 'highly_relevant' | 'relevant' | 'weakly_relevant' | 'contradicted' | 'incompatible' | 'insufficient_data';
export type EvolutionResult = 'improving' | 'stable' | 'weakening' | 'reversing' | 'drifting' | 'insufficient_data';

/* ── 성분 재정규화(없는 성분 null 유지 — null→0 금지) ───────────────────── */
export interface Component { key: string; value: number | null; weight: number }
export function normalizeAvailableComponents(components: Component[]): { score: number | null; used: string[]; missing: string[] } {
  const used = components.filter((c) => isFiniteNumber(c.value) && c.weight > 0);
  const missing = components.filter((c) => !isFiniteNumber(c.value)).map((c) => c.key);
  if (!used.length) return { score: null, used: [], missing };
  const wsum = used.reduce((a, c) => a + c.weight, 0);
  const score = used.reduce((a, c) => a + (c.value as number) * c.weight, 0) / wsum;
  return { score: clampScore(score), used: used.map((c) => c.key), missing };
}

/* ── Memory Quality(0~100 · 직접 입력 금지 — 실측 성분으로만) ───────────── */
export interface MemoryQualityInput {
  evidenceCount?: number | null; hasSource?: boolean; hasVersion?: boolean; hasInputHash?: boolean;
  outcomeStatus?: OutcomeStatus | null; sampleSize?: number | null; contextDepth?: number | null;
  ageDays?: number | null; recurrenceCount?: number | null; contradictionCount?: number | null;
}
export interface MemoryQualityResult { score: number | null; grade: QualityGrade; components: Component[]; missing: string[] }
export function calculateMemoryQuality(inp: MemoryQualityInput): MemoryQualityResult {
  const hasOutcome = inp.outcomeStatus === 'improved' || inp.outcomeStatus === 'neutral' || inp.outcomeStatus === 'degraded';
  const components: Component[] = [
    { key: 'evidence_completeness', value: isFiniteNumber(inp.evidenceCount) ? clampScore((inp.evidenceCount / 5) * 100) : null, weight: 0.2 },
    { key: 'source_reliability', value: inp.hasSource == null ? null : (inp.hasSource && inp.hasVersion && inp.hasInputHash ? 100 : inp.hasSource ? 60 : 0), weight: 0.2 },
    { key: 'outcome_availability', value: inp.outcomeStatus == null ? null : (hasOutcome ? 100 : 30), weight: 0.25 },
    { key: 'sample_sufficiency', value: isFiniteNumber(inp.sampleSize) ? clampScore((inp.sampleSize / 100) * 100) : null, weight: 0.2 },
    { key: 'context_specificity', value: isFiniteNumber(inp.contextDepth) ? clampScore((inp.contextDepth / 4) * 100) : null, weight: 0.15 },
  ];
  const base = normalizeAvailableComponents(components);
  if (base.score == null) return { score: null, grade: 'insufficient_data', components, missing: base.missing };
  // Contradiction Penalty(실패 Memory 도 Evidence 충분하면 높은 Quality 가능 — Outcome 성공 여부와 무관).
  const penalty = isFiniteNumber(inp.contradictionCount) ? Math.min(30, inp.contradictionCount * 10) : 0;
  const score = clampScore(base.score - penalty);
  const grade: QualityGrade = !hasOutcome && inp.outcomeStatus != null ? 'provisional' : score >= 70 ? 'high' : score >= 45 ? 'medium' : 'low';
  return { score, grade, components, missing: base.missing };
}

/* ── Freshness / Aging(삭제 아님 — 계절 재진입 시 회복 가능) ────────────── */
export type Season = '봄' | '여름' | '가을' | '겨울';
export function seasonForMonth(month: number): Season {
  return month >= 3 && month <= 5 ? '봄' : month >= 6 && month <= 8 ? '여름' : month >= 9 && month <= 11 ? '가을' : '겨울';
}
export interface FreshnessInput {
  occurredAt: string | Date; now: Date; lastReinforcedAt?: string | Date | null;
  seasonalTag?: string | null; recurrenceCount?: number | null;
}
export function calculateMemoryFreshness(inp: FreshnessInput): number | null {
  const occurred = new Date(inp.occurredAt).getTime();
  const nowMs = inp.now.getTime();
  if (!Number.isFinite(occurred) || !Number.isFinite(nowMs)) return null;
  const anchor = inp.lastReinforcedAt ? Math.max(occurred, new Date(inp.lastReinforcedAt).getTime()) : occurred;
  const ageDays = Math.max(0, (nowMs - anchor) / 86_400_000);
  // 반감기 90일 지수 감쇠(오래됐다고 즉시 0 아님).
  let score = 100 * Math.pow(0.5, ageDays / 90);
  // Seasonal 회복: 같은 계절 재진입 시 최소 60 보장(크리스마스/장마 등 반복 Memory).
  if (inp.seasonalTag && inp.seasonalTag === seasonForMonth(inp.now.getMonth() + 1)) score = Math.max(score, 60);
  // 재발(Reinforcement) 횟수 보정 — 반복 확인된 Memory 는 천천히 늙는다.
  if (isFiniteNumber(inp.recurrenceCount) && inp.recurrenceCount > 0) score = Math.min(100, score + Math.min(15, inp.recurrenceCount * 3));
  return clampScore(score);
}
export function calculateSeasonalRelevance(memorySeason: string | null | undefined, currentSeason: string): number | null {
  if (!memorySeason) return null;
  return memorySeason === currentSeason ? 100 : 25;
}
export function calculateTemporalRelevance(ageDays: number | null | undefined): number | null {
  if (!isFiniteNumber(ageDays) || ageDays < 0) return null;
  return clampScore(100 * Math.pow(0.5, ageDays / 120));
}

/* ── Context Similarity(context_key: "k=v|k=v" 결정적 비교) ─────────────── */
export function parseContextKey(key: string | null | undefined): Map<string, string> {
  const m = new Map<string, string>();
  if (!key) return m;
  for (const part of key.split('|')) {
    const i = part.indexOf('=');
    if (i > 0) m.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  return m;
}
export function calculateContextSimilarity(a: string | null | undefined, b: string | null | undefined): number | null {
  const ma = parseContextKey(a); const mb = parseContextKey(b);
  if (!ma.size || !mb.size) return null;
  const keys = new Set([...ma.keys(), ...mb.keys()]);
  let match = 0;
  for (const k of keys) { if (ma.get(k) != null && ma.get(k) === mb.get(k)) match += 1; }
  return clampScore((match / keys.size) * 100);
}

/* ── Retrieval Scoring(없는 성분 재정규화 · 결정적 Tie Break) ───────────── */
export interface RetrievalInput {
  contextSimilarity?: number | null; scopeMatch?: boolean | null; temporalRelevance?: number | null;
  seasonalMatch?: number | null; qualityScore?: number | null; confidence?: number | null;
  sampleSize?: number | null; agentDomainMatch?: boolean | null; outcomeAvailable?: boolean | null;
  contradictionCount?: number | null; versionCompatible?: boolean | null;
}
export function calculateRetrievalScore(inp: RetrievalInput): { score: number | null; reasons: string[] } {
  if (inp.versionCompatible === false) return { score: 0, reasons: ['version incompatible'] };
  const components: Component[] = [
    { key: 'context_similarity', value: inp.contextSimilarity ?? null, weight: 0.3 },
    { key: 'scope_match', value: inp.scopeMatch == null ? null : (inp.scopeMatch ? 100 : 30), weight: 0.15 },
    { key: 'temporal_relevance', value: inp.temporalRelevance ?? null, weight: 0.15 },
    { key: 'seasonal_match', value: inp.seasonalMatch ?? null, weight: 0.1 },
    { key: 'quality', value: inp.qualityScore ?? null, weight: 0.15 },
    { key: 'confidence', value: inp.confidence ?? null, weight: 0.1 },
    { key: 'sample', value: isFiniteNumber(inp.sampleSize) ? clampScore((inp.sampleSize / 100) * 100) : null, weight: 0.05 },
    { key: 'agent_domain', value: inp.agentDomainMatch == null ? null : (inp.agentDomainMatch ? 100 : 40), weight: 0.05 },
    { key: 'outcome', value: inp.outcomeAvailable == null ? null : (inp.outcomeAvailable ? 100 : 40), weight: 0.05 },
  ];
  const base = normalizeAvailableComponents(components);
  if (base.score == null) return { score: null, reasons: ['insufficient_data'] };
  const penalty = isFiniteNumber(inp.contradictionCount) ? Math.min(40, inp.contradictionCount * 12) : 0;
  const reasons = base.used.map((k) => k);
  if (penalty > 0) reasons.push(`contradiction_penalty(-${penalty})`);
  return { score: clampScore(base.score - penalty), reasons };
}
export interface RankableMemory { id: string; retrievalScore: number | null; qualityScore: number | null; occurredAt: string }
/** 결정적 정렬: retrieval desc → quality desc → occurred_at desc → id asc. */
export function rankMemories<T extends RankableMemory>(items: T[]): T[] {
  return [...items].sort((a, b) =>
    (b.retrievalScore ?? -1) - (a.retrievalScore ?? -1)
    || (b.qualityScore ?? -1) - (a.qualityScore ?? -1)
    || new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
    || a.id.localeCompare(b.id));
}

/* ── Retrieval Safety(기본 제외/경고 노출) ──────────────────────────────── */
export function retrievalSafety(status: LifecycleStatus, contradictionCount: number): 'ok' | 'warn' | 'exclude' {
  if (status === 'blocked' || status === 'archived' || status === 'superseded') return 'exclude';
  if (status === 'contradicted' || contradictionCount >= 3) return 'exclude';
  if (status === 'stale' || status === 'provisional' || status === 'candidate' || contradictionCount > 0) return 'warn';
  return 'ok';
}

/* ── Pattern Status(통계 정직성 — Sample 부족 시 validated 금지) ────────── */
export interface PatternStatusInput { sampleSize: number | null; supportCount: number; contradictionCount: number; hasOutcome: boolean }
export function classifyPatternStatus(inp: PatternStatusInput): PatternStatus {
  const sample = inp.sampleSize ?? 0;
  if (sample <= 0) return 'insufficient_data';
  if (inp.contradictionCount > inp.supportCount) return 'contradicted';
  if (sample >= 30 && inp.supportCount >= 3 && inp.hasOutcome && inp.contradictionCount === 0) return 'validated';
  if (sample >= 30 && inp.supportCount >= 3 && inp.hasOutcome) return 'provisional';
  if (sample >= 10 && inp.supportCount >= 2) return 'emerging';
  return 'hypothesis';
}

/* ── Memory Contradiction 판정 ──────────────────────────────────────────── */
export interface ContradictionInput { expectedDirection: 'positive' | 'negative' | 'neutral'; observedDirection: 'positive' | 'negative' | 'neutral'; magnitude: number | null; sample: number | null }
export function detectMemoryContradiction(inp: ContradictionInput): ContradictionLevel | null {
  if (inp.expectedDirection === inp.observedDirection) return null;
  const sample = inp.sample ?? 0;
  if (sample < 10) return 'weak_contradiction';
  const mag = isFiniteNumber(inp.magnitude) ? Math.abs(inp.magnitude) : 0;
  if (inp.expectedDirection !== 'neutral' && inp.observedDirection !== 'neutral' && mag >= 20 && sample >= 30) return 'strong_contradiction';
  if (mag >= 10) return 'meaningful_contradiction';
  return 'weak_contradiction';
}

/* ── Experience Replay(Evidence-only — 실행 없음) ───────────────────────── */
export interface ReplayInput {
  contextSimilarity: number | null; versionCompatible: boolean; hasOutcome: boolean;
  contradictionCount: number; qualityScore: number | null;
}
export function evaluateExperienceReplay(inp: ReplayInput): { assessment: ReplayAssessment; note: string } {
  if (!inp.versionCompatible) return { assessment: 'incompatible', note: 'Source Version 비호환 — 과거 계산 정의가 현재와 다릅니다.' };
  if (!inp.hasOutcome) return { assessment: 'insufficient_data', note: '실제 Outcome 없는 Memory — Replay 근거로 사용 불가.' };
  if (inp.contradictionCount >= 2) return { assessment: 'contradicted', note: '반대 Outcome 다수 — 이 경험은 현재 Context 에 반증됨.' };
  if (inp.contextSimilarity == null) return { assessment: 'insufficient_data', note: 'Context 비교 불가.' };
  const q = inp.qualityScore ?? 50;
  if (inp.contextSimilarity >= 70 && q >= 60) return { assessment: 'highly_relevant', note: 'Context 유사 + 높은 Quality — 강한 참고 근거.' };
  if (inp.contextSimilarity >= 50) return { assessment: 'relevant', note: 'Context 유사 — 참고 가능.' };
  return { assessment: 'weakly_relevant', note: 'Context 차이 큼 — 약한 참고만.' };
}

/* ── Temporal Evolution ─────────────────────────────────────────────────── */
export interface EvolutionInput { prev: number | null; curr: number | null; prevSample?: number | null; currSample?: number | null; driftScore?: number | null }
export function classifyTemporalEvolution(inp: EvolutionInput): { result: EvolutionResult; delta: number | null } {
  if (!isFiniteNumber(inp.prev) || !isFiniteNumber(inp.curr)) return { result: 'insufficient_data', delta: null };
  const delta = Math.round(inp.curr - inp.prev);
  if (isFiniteNumber(inp.driftScore) && inp.driftScore >= 35) return { result: 'drifting', delta };
  if (delta >= 25 && inp.prev < 50 && inp.curr >= 50) return { result: 'reversing', delta };
  if (delta <= -25 && inp.prev >= 50 && inp.curr < 50) return { result: 'reversing', delta };
  if (delta >= 8) return { result: 'improving', delta };
  if (delta <= -8) return { result: 'weakening', delta };
  return { result: 'stable', delta };
}

/* ── Evidence Package(요약 문장만 반환 금지 — 전체 근거 포함) ───────────── */
export interface MemoryRecordLike {
  id: string; memory_type: string; memory_scope: string; scope_id: string | null; context_key: string | null;
  source_type: string; source_id: string; source_version: string; outcome_status: string;
  quality_score: number | null; confidence: number | null; freshness_score: number | null;
  sample_size: number | null; contradiction_count: number; lifecycle_status: string; occurred_at: string;
}
export function buildMemoryEvidencePackage(m: MemoryRecordLike, retrieval: { score: number | null; reasons: string[] }): Array<{ label: string; value: string | number | null }> {
  return [
    { label: 'Memory ID', value: m.id }, { label: 'Type', value: m.memory_type }, { label: 'Scope', value: `${m.memory_scope}${m.scope_id ? `:${m.scope_id}` : ''}` },
    { label: 'Context', value: m.context_key }, { label: 'Source', value: `${m.source_type}:${m.source_id}@${m.source_version}` },
    { label: 'Outcome', value: m.outcome_status }, { label: 'Quality', value: m.quality_score }, { label: 'Confidence', value: m.confidence },
    { label: 'Freshness', value: m.freshness_score }, { label: 'Sample', value: m.sample_size }, { label: 'Contradictions', value: m.contradiction_count },
    { label: 'Status', value: m.lifecycle_status }, { label: 'Occurred', value: m.occurred_at },
    { label: 'Retrieval Score', value: retrieval.score }, { label: 'Retrieval Reason', value: retrieval.reasons.join(', ') || null },
    { label: 'Limitations', value: m.outcome_status === 'pending_outcome' ? 'Outcome 미확정' : m.contradiction_count > 0 ? '반례 존재' : null },
  ];
}

/* ── Memory Idempotency(결정적 input hash) ──────────────────────────────── */
export function memoryInputHash(parts: { sourceType: string; sourceId: string; contextKey: string | null; occurredAt: string }): string {
  const s = `${parts.sourceType}|${parts.sourceId}|${parts.contextKey ?? ''}|${parts.occurredAt}`;
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `mem_${(h >>> 0).toString(16)}`;
}

/* ── Support Matrix(실제 DB 기준 정직 표기) ─────────────────────────────── */
export type MemorySupportStatus = 'fully_supported' | 'partially_supported' | 'read_only' | 'evidence_only' | 'provisional' | 'unsupported' | 'insufficient_data';
export interface MemorySupport { key: string; label: string; status: MemorySupportStatus; note: string }
export const MEMORY_SUPPORT: MemorySupport[] = [
  { key: 'episodic', label: 'Episodic Memory', status: 'fully_supported', note: 'Source/Version/Hash/Outcome 필수 저장' },
  { key: 'semantic', label: 'Semantic Memory', status: 'partially_supported', note: '최소 Sample 10 강제 · 초기 Episode 수 제한' },
  { key: 'procedural', label: 'Procedural Memory', status: 'read_only', note: 'Sandbox/Promotion/Governance Audit 조회로 제공(자동 실행 없음)' },
  { key: 'negative', label: 'Negative Memory', status: 'fully_supported', note: '실패/기각/위반 경험 저장(성공 편향 금지)' },
  { key: 'store', label: 'Store Memory', status: 'partially_supported', note: 'store scope 지원 · store_type 집계 기반' },
  { key: 'brand', label: 'Brand Memory', status: 'insufficient_data', note: 'business_id 미연결(브랜드 데이터 없음)' },
  { key: 'industry', label: 'Industry Memory', status: 'partially_supported', note: 'store_type 을 Industry proxy 로 사용' },
  { key: 'global', label: 'Global Memory', status: 'partially_supported', note: '전체 집계 기반 · Store 1곳 일반화 금지' },
  { key: 'agent', label: 'Agent Memory', status: 'read_only', note: '0497 admin_ai_agent_memory 재사용(읽기 전용)' },
  { key: 'seasonal', label: 'Seasonal Memory', status: 'partially_supported', note: '월 기반 4계절만 · 장마/이벤트/휴일 데이터 없음' },
  { key: 'quality', label: 'Memory Quality', status: 'fully_supported', note: '실측 성분 재정규화(직접 입력 금지)' },
  { key: 'aging', label: 'Memory Aging', status: 'fully_supported', note: '상태 기반(삭제 없음) · Seasonal 회복' },
  { key: 'reinforcement', label: 'Memory Reinforcement', status: 'fully_supported', note: 'Source+Evidence 필수 · Audit 재현 가능' },
  { key: 'contradiction', label: 'Memory Contradiction', status: 'fully_supported', note: '4단계 Level · 삭제 아닌 상태 전이' },
  { key: 'retrieval', label: 'Memory Retrieval', status: 'fully_supported', note: '결정적 Scoring/정렬 · Safety 필터' },
  { key: 'nodes', label: 'Knowledge Nodes', status: 'partially_supported', note: 'Entity 참조만(복제 없음) · weather/holiday/bpm/vocal node 미지원' },
  { key: 'edges', label: 'Knowledge Edges', status: 'partially_supported', note: 'Evidence 필수 · associated_with≠인과' },
  { key: 'traversal', label: 'Graph Traversal', status: 'partially_supported', note: '1-Hop Neighbor 만(재귀 없음)' },
  { key: 'pattern_discovery', label: 'Pattern Discovery', status: 'partially_supported', note: '관찰 상관관계만 · 통계적 인과 검정 미지원' },
  { key: 'pattern_validation', label: 'Pattern Validation', status: 'partially_supported', note: 'validated = sample≥30+support≥3+Outcome' },
  { key: 'replay', label: 'Experience Replay', status: 'evidence_only', note: 'Evidence Package 만 반환(실행/Publish 없음)' },
  { key: 'temporal', label: 'Temporal Evolution', status: 'partially_supported', note: '이전/현재 기간 비교(0 비교 금지)' },
  { key: 'multi_agent', label: 'Multi-Agent Integration', status: 'read_only', note: 'Agent 는 Memory 조회만 · 없으면 abstain 유지' },
  { key: 'governance', label: 'Governance Integration', status: 'partially_supported', note: '기존 Constitution Rule 로 검증 · 신규 Rule 자동 생성 없음' },
  { key: 'production_apply', label: 'Production Apply', status: 'unsupported', note: '금지 — Memory 는 Evidence 계층' },
];

/* ── 라벨/톤 ────────────────────────────────────────────────────────────── */
export const MEMORY_TYPE_LABEL: Record<MemoryType, string> = { episodic: 'Episodic', semantic: 'Semantic', procedural: 'Procedural', negative: 'Negative', observation: 'Observation' };
export const LIFECYCLE_LABEL: Record<LifecycleStatus, string> = { candidate: '후보', active: '활성', provisional: '잠정', stale: 'Stale', contradicted: '반증됨', superseded: '대체됨', archived: '보관', blocked: '차단' };
export const LIFECYCLE_TONE: Record<LifecycleStatus, 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = { candidate: 'info', active: 'success', provisional: 'warning', stale: 'warning', contradicted: 'danger', superseded: 'neutral', archived: 'neutral', blocked: 'danger' };
export const OUTCOME_LABEL: Record<OutcomeStatus, string> = { improved: '개선', neutral: '중립', degraded: '악화', pending_outcome: 'Outcome 대기', observation_only: '관찰만' };
export const OUTCOME_TONE: Record<OutcomeStatus, 'success' | 'neutral' | 'danger' | 'warning' | 'info'> = { improved: 'success', neutral: 'neutral', degraded: 'danger', pending_outcome: 'warning', observation_only: 'info' };
export const PATTERN_STATUS_LABEL: Record<PatternStatus, string> = { hypothesis: '가설', emerging: 'Emerging', provisional: '잠정', validated: '검증됨', contradicted: '반증됨', deprecated: '폐기', insufficient_data: '데이터 부족' };
export const PATTERN_STATUS_TONE: Record<PatternStatus, 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = { hypothesis: 'neutral', emerging: 'info', provisional: 'warning', validated: 'success', contradicted: 'danger', deprecated: 'neutral', insufficient_data: 'neutral' };
export const REPLAY_LABEL: Record<ReplayAssessment, string> = { highly_relevant: '매우 관련', relevant: '관련', weakly_relevant: '약한 관련', contradicted: '반증됨', incompatible: '비호환', insufficient_data: '데이터 부족' };
export const REPLAY_TONE: Record<ReplayAssessment, 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = { highly_relevant: 'success', relevant: 'info', weakly_relevant: 'warning', contradicted: 'danger', incompatible: 'danger', insufficient_data: 'neutral' };
export const EVOLUTION_LABEL: Record<EvolutionResult, string> = { improving: '개선 중', stable: '안정', weakening: '약화', reversing: '반전', drifting: 'Drift', insufficient_data: '데이터 부족' };
export function qualityTone(grade: QualityGrade): 'success' | 'warning' | 'danger' | 'neutral' | 'info' {
  return grade === 'high' ? 'success' : grade === 'medium' ? 'info' : grade === 'low' ? 'danger' : grade === 'provisional' ? 'warning' : 'neutral';
}
