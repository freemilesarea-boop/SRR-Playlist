// Phase AI-MUSIC-10 — Long-Term Memory & Pattern Intelligence 순수 로직 단위 테스트.
// Quality(재정규화/insufficient) · Freshness(Seasonal 회복) · Contradiction · clamp/NaN ·
// Context Similarity · Retrieval(결정적 정렬/Tie Break) · Pattern Status(validated 차단) ·
// Experience Replay · Temporal Evolution · Evidence Package · Idempotent Hash.
import { describe, it, expect } from 'vitest';
import {
  isFiniteNumber, clampScore, normalizeAvailableComponents,
  calculateMemoryQuality, calculateMemoryFreshness, calculateSeasonalRelevance, calculateTemporalRelevance,
  seasonForMonth, parseContextKey, calculateContextSimilarity,
  calculateRetrievalScore, rankMemories, retrievalSafety,
  classifyPatternStatus, detectMemoryContradiction, evaluateExperienceReplay, classifyTemporalEvolution,
  buildMemoryEvidencePackage, memoryInputHash, MEMORY_SUPPORT,
  type MemoryRecordLike,
} from './aiMemory';

const NOW = new Date('2026-07-13T12:00:00Z');

describe('기본 방어', () => {
  it('isFiniteNumber — NaN/Infinity 차단', () => {
    expect(isFiniteNumber(NaN)).toBe(false); expect(isFiniteNumber(Infinity)).toBe(false);
    expect(isFiniteNumber(-Infinity)).toBe(false); expect(isFiniteNumber(50)).toBe(true); expect(isFiniteNumber(null)).toBe(false);
  });
  it('clampScore — 0~100', () => { expect(clampScore(150)).toBe(100); expect(clampScore(-5)).toBe(0); expect(clampScore(72.6)).toBe(73); });
});

describe('성분 재정규화(null→0 금지)', () => {
  it('일부 성분 누락 시 존재 성분만 재정규화', () => {
    const r = normalizeAvailableComponents([
      { key: 'a', value: 80, weight: 0.5 }, { key: 'b', value: null, weight: 0.3 }, { key: 'c', value: 60, weight: 0.2 },
    ]);
    expect(r.score).toBe(Math.round((80 * 0.5 + 60 * 0.2) / 0.7));
    expect(r.missing).toEqual(['b']);
  });
  it('모든 성분 누락 → null(insufficient)', () => {
    expect(normalizeAvailableComponents([{ key: 'a', value: null, weight: 1 }]).score).toBeNull();
  });
});

describe('Memory Quality', () => {
  it('정상 계산 · Outcome 있음 → high 가능', () => {
    const q = calculateMemoryQuality({ evidenceCount: 5, hasSource: true, hasVersion: true, hasInputHash: true, outcomeStatus: 'improved', sampleSize: 100, contextDepth: 3 });
    expect(q.score).not.toBeNull(); expect(q.score!).toBeGreaterThanOrEqual(70); expect(q.grade).toBe('high');
  });
  it('Outcome 대기 → provisional(성공으로 승격 금지)', () => {
    const q = calculateMemoryQuality({ evidenceCount: 5, hasSource: true, outcomeStatus: 'pending_outcome', sampleSize: 100 });
    expect(q.grade).toBe('provisional');
  });
  it('전 성분 누락 → insufficient_data', () => {
    expect(calculateMemoryQuality({}).grade).toBe('insufficient_data');
    expect(calculateMemoryQuality({}).score).toBeNull();
  });
  it('Contradiction Penalty 반영', () => {
    const base = calculateMemoryQuality({ evidenceCount: 5, hasSource: true, hasVersion: true, hasInputHash: true, outcomeStatus: 'degraded', sampleSize: 100, contextDepth: 4 });
    const pen = calculateMemoryQuality({ evidenceCount: 5, hasSource: true, hasVersion: true, hasInputHash: true, outcomeStatus: 'degraded', sampleSize: 100, contextDepth: 4, contradictionCount: 2 });
    expect(pen.score!).toBeLessThan(base.score!);
  });
  it('실패(degraded) Memory 도 Evidence/Sample 충분하면 high Quality 가능', () => {
    const q = calculateMemoryQuality({ evidenceCount: 6, hasSource: true, hasVersion: true, hasInputHash: true, outcomeStatus: 'degraded', sampleSize: 200, contextDepth: 4 });
    expect(q.grade).toBe('high');
  });
});

describe('Freshness / Aging(삭제 아님)', () => {
  it('최근 Memory 는 높은 Freshness', () => {
    const f = calculateMemoryFreshness({ occurredAt: '2026-07-10T00:00:00Z', now: NOW });
    expect(f!).toBeGreaterThan(90);
  });
  it('오래된 Memory 는 감쇠(0 은 아님)', () => {
    const f = calculateMemoryFreshness({ occurredAt: '2025-07-13T00:00:00Z', now: NOW });
    expect(f!).toBeLessThan(20); expect(f!).toBeGreaterThanOrEqual(0);
  });
  it('Seasonal 재진입 시 회복(여름 Memory + 현재 7월)', () => {
    const f = calculateMemoryFreshness({ occurredAt: '2025-07-13T00:00:00Z', now: NOW, seasonalTag: '여름' });
    expect(f!).toBeGreaterThanOrEqual(60);
  });
  it('다른 계절 태그는 회복 없음', () => {
    const f = calculateMemoryFreshness({ occurredAt: '2025-07-13T00:00:00Z', now: NOW, seasonalTag: '겨울' });
    expect(f!).toBeLessThan(60);
  });
  it('Reinforcement 로 감쇠 완화', () => {
    const a = calculateMemoryFreshness({ occurredAt: '2026-01-01T00:00:00Z', now: NOW });
    const b = calculateMemoryFreshness({ occurredAt: '2026-01-01T00:00:00Z', now: NOW, lastReinforcedAt: '2026-07-01T00:00:00Z', recurrenceCount: 3 });
    expect(b!).toBeGreaterThan(a!);
  });
  it('잘못된 날짜 → null', () => { expect(calculateMemoryFreshness({ occurredAt: 'bad-date', now: NOW })).toBeNull(); });
  it('seasonForMonth / seasonalRelevance', () => {
    expect(seasonForMonth(7)).toBe('여름'); expect(seasonForMonth(12)).toBe('겨울');
    expect(calculateSeasonalRelevance('여름', '여름')).toBe(100); expect(calculateSeasonalRelevance(null, '여름')).toBeNull();
  });
  it('temporalRelevance — 음수/누락 null', () => {
    expect(calculateTemporalRelevance(-1)).toBeNull(); expect(calculateTemporalRelevance(null)).toBeNull();
    expect(calculateTemporalRelevance(0)).toBe(100);
  });
});

describe('Context Similarity', () => {
  it('parseContextKey', () => {
    const m = parseContextKey('store_type=cafe|daypart=아침');
    expect(m.get('store_type')).toBe('cafe'); expect(m.get('daypart')).toBe('아침');
  });
  it('동일 context → 100 · 부분 일치 → 비례 · 빈 값 → null', () => {
    expect(calculateContextSimilarity('store_type=cafe|daypart=아침', 'store_type=cafe|daypart=아침')).toBe(100);
    expect(calculateContextSimilarity('store_type=cafe|daypart=아침', 'store_type=cafe|daypart=저녁')).toBe(50);
    expect(calculateContextSimilarity('', 'store_type=cafe')).toBeNull();
  });
});

describe('Retrieval Scoring / 정렬 / Safety', () => {
  it('성분 기반 점수 · 없는 성분 재정규화', () => {
    const r = calculateRetrievalScore({ contextSimilarity: 80, qualityScore: 70 });
    expect(r.score).not.toBeNull(); expect(r.score!).toBeGreaterThan(0); expect(r.score!).toBeLessThanOrEqual(100);
  });
  it('전 성분 누락 → null(하드코딩 점수 금지)', () => {
    expect(calculateRetrievalScore({}).score).toBeNull();
  });
  it('version 비호환 → 0', () => { expect(calculateRetrievalScore({ contextSimilarity: 90, versionCompatible: false }).score).toBe(0); });
  it('Contradiction Penalty', () => {
    const a = calculateRetrievalScore({ contextSimilarity: 80, qualityScore: 70 });
    const b = calculateRetrievalScore({ contextSimilarity: 80, qualityScore: 70, contradictionCount: 2 });
    expect(b.score!).toBeLessThan(a.score!);
  });
  it('결정적 정렬 + Tie Break(id asc)', () => {
    const items = [
      { id: 'b', retrievalScore: 80, qualityScore: 70, occurredAt: '2026-07-01T00:00:00Z' },
      { id: 'a', retrievalScore: 80, qualityScore: 70, occurredAt: '2026-07-01T00:00:00Z' },
      { id: 'c', retrievalScore: 90, qualityScore: 10, occurredAt: '2026-06-01T00:00:00Z' },
    ];
    const ranked = rankMemories(items);
    expect(ranked.map((r) => r.id)).toEqual(['c', 'a', 'b']);
    expect(rankMemories(items).map((r) => r.id)).toEqual(['c', 'a', 'b']); // 동일 입력 → 동일 결과
  });
  it('retrievalSafety — blocked/contradicted 제외 · stale/provisional 경고', () => {
    expect(retrievalSafety('blocked', 0)).toBe('exclude');
    expect(retrievalSafety('contradicted', 0)).toBe('exclude');
    expect(retrievalSafety('active', 3)).toBe('exclude');
    expect(retrievalSafety('stale', 0)).toBe('warn');
    expect(retrievalSafety('provisional', 0)).toBe('warn');
    expect(retrievalSafety('active', 0)).toBe('ok');
  });
});

describe('Pattern Status(통계 정직성)', () => {
  it('sample 0 → insufficient_data', () => { expect(classifyPatternStatus({ sampleSize: 0, supportCount: 0, contradictionCount: 0, hasOutcome: false })).toBe('insufficient_data'); });
  it('소규모 → hypothesis', () => { expect(classifyPatternStatus({ sampleSize: 5, supportCount: 1, contradictionCount: 0, hasOutcome: false })).toBe('hypothesis'); });
  it('중간 규모 → emerging', () => { expect(classifyPatternStatus({ sampleSize: 15, supportCount: 2, contradictionCount: 0, hasOutcome: false })).toBe('emerging'); });
  it('기준 충족 + 반례 있음 → provisional(validated 금지)', () => {
    expect(classifyPatternStatus({ sampleSize: 50, supportCount: 4, contradictionCount: 1, hasOutcome: true })).toBe('provisional');
  });
  it('Outcome 없으면 validated 금지', () => {
    expect(classifyPatternStatus({ sampleSize: 100, supportCount: 5, contradictionCount: 0, hasOutcome: false })).not.toBe('validated');
  });
  it('sample≥30 + support≥3 + Outcome + 무반례 → validated', () => {
    expect(classifyPatternStatus({ sampleSize: 40, supportCount: 3, contradictionCount: 0, hasOutcome: true })).toBe('validated');
  });
  it('반례 > 지지 → contradicted', () => {
    expect(classifyPatternStatus({ sampleSize: 40, supportCount: 1, contradictionCount: 3, hasOutcome: true })).toBe('contradicted');
  });
});

describe('Memory Contradiction', () => {
  it('방향 일치 → null', () => { expect(detectMemoryContradiction({ expectedDirection: 'positive', observedDirection: 'positive', magnitude: 30, sample: 50 })).toBeNull(); });
  it('소규모 반대 → weak', () => { expect(detectMemoryContradiction({ expectedDirection: 'positive', observedDirection: 'negative', magnitude: 30, sample: 5 })).toBe('weak_contradiction'); });
  it('대규모 강한 반대 → strong', () => { expect(detectMemoryContradiction({ expectedDirection: 'positive', observedDirection: 'negative', magnitude: 25, sample: 60 })).toBe('strong_contradiction'); });
  it('중간 반대 → meaningful', () => { expect(detectMemoryContradiction({ expectedDirection: 'positive', observedDirection: 'neutral', magnitude: 15, sample: 40 })).toBe('meaningful_contradiction'); });
});

describe('Experience Replay(Evidence-only)', () => {
  it('유사 Context + 높은 Quality → highly_relevant', () => {
    expect(evaluateExperienceReplay({ contextSimilarity: 85, versionCompatible: true, hasOutcome: true, contradictionCount: 0, qualityScore: 75 }).assessment).toBe('highly_relevant');
  });
  it('version 비호환 → incompatible', () => {
    expect(evaluateExperienceReplay({ contextSimilarity: 90, versionCompatible: false, hasOutcome: true, contradictionCount: 0, qualityScore: 90 }).assessment).toBe('incompatible');
  });
  it('반례 다수 → contradicted', () => {
    expect(evaluateExperienceReplay({ contextSimilarity: 90, versionCompatible: true, hasOutcome: true, contradictionCount: 2, qualityScore: 90 }).assessment).toBe('contradicted');
  });
  it('Outcome 없음 → insufficient_data(성공 추론 금지)', () => {
    expect(evaluateExperienceReplay({ contextSimilarity: 90, versionCompatible: true, hasOutcome: false, contradictionCount: 0, qualityScore: 90 }).assessment).toBe('insufficient_data');
  });
  it('낮은 유사도 → weakly_relevant', () => {
    expect(evaluateExperienceReplay({ contextSimilarity: 20, versionCompatible: true, hasOutcome: true, contradictionCount: 0, qualityScore: 60 }).assessment).toBe('weakly_relevant');
  });
});

describe('Temporal Evolution', () => {
  it('이전값 없음 → insufficient_data(0 비교 금지)', () => {
    expect(classifyTemporalEvolution({ prev: null, curr: 70 }).result).toBe('insufficient_data');
  });
  it('improving / weakening / stable / reversing / drifting', () => {
    expect(classifyTemporalEvolution({ prev: 50, curr: 65 }).result).toBe('improving');
    expect(classifyTemporalEvolution({ prev: 65, curr: 50 }).result).toBe('weakening');
    expect(classifyTemporalEvolution({ prev: 60, curr: 62 }).result).toBe('stable');
    expect(classifyTemporalEvolution({ prev: 30, curr: 70 }).result).toBe('reversing');
    expect(classifyTemporalEvolution({ prev: 60, curr: 62, driftScore: 40 }).result).toBe('drifting');
  });
});

describe('Evidence Package / Hash / Support', () => {
  const rec: MemoryRecordLike = {
    id: 'm1', memory_type: 'episodic', memory_scope: 'store', scope_id: 's1', context_key: 'store_type=cafe',
    source_type: 'strategy_snapshot', source_id: 'x', source_version: 'v1', outcome_status: 'improved',
    quality_score: 80, confidence: 70, freshness_score: 90, sample_size: 120, contradiction_count: 0,
    lifecycle_status: 'active', occurred_at: '2026-07-01T00:00:00Z',
  };
  it('Evidence Package — 필수 항목 포함(요약 문장만 금지)', () => {
    const pkg = buildMemoryEvidencePackage(rec, { score: 85, reasons: ['context_similarity'] });
    const labels = pkg.map((p) => p.label);
    for (const l of ['Memory ID', 'Scope', 'Source', 'Outcome', 'Quality', 'Confidence', 'Freshness', 'Sample', 'Contradictions', 'Retrieval Score', 'Limitations']) expect(labels).toContain(l);
  });
  it('memoryInputHash — 결정적', () => {
    const a = memoryInputHash({ sourceType: 's', sourceId: '1', contextKey: 'c', occurredAt: 't' });
    expect(a).toBe(memoryInputHash({ sourceType: 's', sourceId: '1', contextKey: 'c', occurredAt: 't' }));
    expect(a).not.toBe(memoryInputHash({ sourceType: 's', sourceId: '2', contextKey: 'c', occurredAt: 't' }));
  });
  it('Support Matrix — Production Apply unsupported · Brand insufficient_data', () => {
    expect(MEMORY_SUPPORT.find((s) => s.key === 'production_apply')!.status).toBe('unsupported');
    expect(MEMORY_SUPPORT.find((s) => s.key === 'brand')!.status).toBe('insufficient_data');
    expect(MEMORY_SUPPORT.find((s) => s.key === 'replay')!.status).toBe('evidence_only');
    expect(MEMORY_SUPPORT.find((s) => s.key === 'agent')!.status).toBe('read_only');
  });
});
