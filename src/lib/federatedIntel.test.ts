// Phase AI-MUSIC-14 — Federated Learning & Privacy-Preserving Intelligence 순수 로직 단위 테스트.
// Knowledge Extraction(식별자 없음) · Privacy Validation(표본/익명성/금지필드/PII) ·
// Aggregation(가중/단일 Source 금지) · Local Override · Conflict · Promotion 게이트 ·
// Decay(삭제 없음) · Federated Trust(표시 전용) · Support Matrix.
import { describe, it, expect } from 'vitest';
import {
  extractKnowledge, validatePrivacy, aggregateKnowledge, resolveLocalOverride,
  detectFederatedConflicts, classifyPromotion, calculateKnowledgeDecay, computeFederatedTrust,
  federatedInputHash, FORBIDDEN_KEYS, PROMOTION_GATES, FEDERATED_LAYERS, FEDERATED_SUPPORT,
} from './federatedIntel';

const NOW = new Date('2026-07-14T00:00:00Z');

describe('Knowledge Extraction', () => {
  it('통계만 추출 · Store 식별자 필드 없음', () => {
    const k = extractKnowledge({ industry: 'cafe', metricCode: 'completion_rate', value: 82, baseline: 75, sampleCount: 500, sampleStores: 12 }, 'global');
    expect(k).not.toBeNull();
    expect(k!.direction).toBe('positive'); expect(k!.effectValue).toBe(82);
    const keys = Object.keys(k!);
    for (const f of FORBIDDEN_KEYS) expect(keys).not.toContain(f);
    expect(JSON.stringify(k)).not.toMatch(/store_id|user_id|email/);
  });
  it('데이터 없는 KPI 추출 금지(null)', () => {
    expect(extractKnowledge({ industry: 'cafe', metricCode: 'roi', value: null, baseline: 70, sampleCount: 500, sampleStores: 12 }, 'global')).toBeNull();
  });
  it('sample 부족 → confidence null(임의 confidence 생성 없음)', () => {
    expect(extractKnowledge({ industry: 'cafe', metricCode: 'skip', value: 8, baseline: 8.2, sampleCount: 10, sampleStores: 1 }, 'store')!.confidence).toBeNull();
  });
});

describe('Privacy Validation', () => {
  const ok = { sampleCount: 300, sampleStores: 10, layer: 'global' as const, payloadKeys: ['pattern_key', 'metric_code'], payloadText: '{"pattern_key":"x","effect":82}' };
  it('정상 → passed', () => { expect(validatePrivacy(ok).passed).toBe(true); });
  it('최소 표본 미달 차단', () => {
    const r = validatePrivacy({ ...ok, sampleCount: 10 });
    expect(r.passed).toBe(false); expect(r.violations.some((v) => v.startsWith('min_sample'))).toBe(true);
  });
  it('익명성 임계(store 외 계층 stores<3) 차단 · store 계층은 면제', () => {
    expect(validatePrivacy({ ...ok, sampleStores: 1 }).passed).toBe(false);
    expect(validatePrivacy({ ...ok, sampleStores: 1, layer: 'store' }).passed).toBe(true);
  });
  it('금지 필드(store_id/contract/settlement/audio_url) 차단', () => {
    expect(validatePrivacy({ ...ok, payloadKeys: ['store_id'] }).passed).toBe(false);
    expect(validatePrivacy({ ...ok, payloadText: '{"contract":"..."}' }).passed).toBe(false);
    expect(validatePrivacy({ ...ok, payloadText: '{"audio_url":"x"}' }).passed).toBe(false);
  });
  it('PII 패턴(이메일/URL) 차단', () => {
    expect(validatePrivacy({ ...ok, payloadText: 'contact a@b.com' }).passed).toBe(false);
    expect(validatePrivacy({ ...ok, payloadText: 'https://cdn.example/audio.mp3' }).passed).toBe(false);
  });
});

describe('Federated Aggregation', () => {
  it('표본 가중 병합(결정적)', () => {
    const r = aggregateKnowledge([
      { effectValue: 80, confidence: 60, sampleCount: 100, sampleStores: 3 },
      { effectValue: 70, confidence: 40, sampleCount: 300, sampleStores: 7 },
    ])!;
    expect(r.effect).toBe(72.5); expect(r.confidence).toBe(50); expect(r.sampleCount).toBe(400); expect(r.sampleStores).toBe(10);
  });
  it('단일 Source → null(상위 계층 일반화 금지)', () => {
    expect(aggregateKnowledge([{ effectValue: 80, confidence: 60, sampleCount: 100, sampleStores: 3 }])).toBeNull();
  });
  it('effect null Source 제외', () => {
    expect(aggregateKnowledge([{ effectValue: null, confidence: 60, sampleCount: 100, sampleStores: 3 }, { effectValue: 70, confidence: 40, sampleCount: 300, sampleStores: 7 }])).toBeNull();
  });
});

describe('Local Override / Conflict', () => {
  it('Local Evidence 강하고 방향 상반 → local_preferred', () => {
    expect(resolveLocalOverride({ globalDirection: 'positive', globalConfidence: 40, globalSample: 100, localDirection: 'negative', localConfidence: 60, localSample: 150 }).decision).toBe('local_preferred');
  });
  it('Local Evidence 부족 → global_preferred', () => {
    expect(resolveLocalOverride({ globalDirection: 'positive', globalConfidence: 70, globalSample: 500, localDirection: 'negative', localConfidence: 30, localSample: 10 }).decision).toBe('global_preferred');
  });
  it('양쪽 강한 상반 → governance_review', () => {
    expect(resolveLocalOverride({ globalDirection: 'positive', globalConfidence: 70, globalSample: 500, localDirection: 'negative', localConfidence: 70, localSample: 200 }).decision).toBe('governance_review');
  });
  it('양쪽 표본 부족 → insufficient_data · 방향 일치 → global_preferred', () => {
    expect(resolveLocalOverride({ globalDirection: 'positive', globalConfidence: null, globalSample: 5, localDirection: 'positive', localConfidence: null, localSample: 5 }).decision).toBe('insufficient_data');
    expect(resolveLocalOverride({ globalDirection: 'positive', globalConfidence: 70, globalSample: 500, localDirection: 'positive', localConfidence: 70, localSample: 200 }).decision).toBe('global_preferred');
  });
  it('detectFederatedConflicts — 방향 상반만 감지', () => {
    const c = detectFederatedConflicts(
      [{ id: 'l1', layer: 'store', industry: 'hospital', metricCode: 'completion', direction: 'negative', confidence: 60, sampleCount: 100 }],
      [{ id: 'g1', layer: 'global', industry: 'hospital', metricCode: 'completion', direction: 'positive', confidence: 70, sampleCount: 500 }],
    );
    expect(c.length).toBe(1); expect(c[0].type).toBe('local_vs_global');
    expect(detectFederatedConflicts(
      [{ id: 'l1', layer: 'store', industry: 'cafe', metricCode: 'skip', direction: 'positive', confidence: 60, sampleCount: 100 }],
      [{ id: 'g1', layer: 'global', industry: 'cafe', metricCode: 'skip', direction: 'positive', confidence: 70, sampleCount: 500 }],
    ).length).toBe(0);
  });
});

describe('Knowledge Promotion 게이트', () => {
  const base = { current: 'candidate' as const, sampleStores: 25, sampleCount: 2000, confidence: 70, privacyPassed: true };
  it('게이트 충족 → eligible', () => {
    expect(classifyPromotion({ ...base, target: 'global_validated' }).eligible).toBe(true);
    expect(classifyPromotion({ ...base, target: 'regional' }).eligible).toBe(true);
  });
  it('표본 미달 차단(global_validated: stores>=20, sample>=1000, conf>=60)', () => {
    expect(classifyPromotion({ ...base, target: 'global_validated', sampleStores: 5 }).eligible).toBe(false);
    expect(classifyPromotion({ ...base, target: 'global_validated', sampleCount: 100 }).eligible).toBe(false);
    expect(classifyPromotion({ ...base, target: 'global_validated', confidence: 30 }).eligible).toBe(false);
  });
  it('privacy 미통과 차단 · 게이트 상수 존재', () => {
    expect(classifyPromotion({ ...base, target: 'regional', privacyPassed: false }).eligible).toBe(false);
    expect(PROMOTION_GATES.global_validated.stores).toBe(20);
  });
});

describe('Knowledge Decay / Trust / Hash', () => {
  it('최근 검증 → keep · 오래됨 → deprecate/archive 권고(삭제 아님)', () => {
    expect(calculateKnowledgeDecay({ lastValidatedAt: '2026-07-01', now: NOW, confidence: 70 }).recommendation).toBe('keep');
    expect(calculateKnowledgeDecay({ lastValidatedAt: '2025-10-01', now: NOW, confidence: 70 }).recommendation).toBe('deprecate');
    expect(calculateKnowledgeDecay({ lastValidatedAt: '2023-01-01', now: NOW, confidence: 70 }).recommendation).toBe('archive');
  });
  it('confidence 없음 → insufficient · 검증 이력 없음 → revalidate', () => {
    expect(calculateKnowledgeDecay({ lastValidatedAt: '2026-07-01', now: NOW, confidence: null }).recommendation).toBe('insufficient_data');
    expect(calculateKnowledgeDecay({ lastValidatedAt: null, now: NOW, confidence: 70 }).recommendation).toBe('revalidate');
  });
  it('Federated Trust — 재정규화 표시 전용 · 전 성분 누락 null', () => {
    expect(computeFederatedTrust({ localTrust: 70, privacyPassRate: 100 }).score).not.toBeNull();
    expect(computeFederatedTrust({}).score).toBeNull();
  });
  it('hash 결정적', () => { expect(federatedInputHash(['a', 1])).toBe(federatedInputHash(['a', 1])); });
});

describe('계층 / Support Matrix', () => {
  it('Brand = insufficient_data · Global = supported', () => {
    expect(FEDERATED_LAYERS.find((l) => l.layer === 'brand')!.support).toBe('insufficient_data');
    expect(FEDERATED_LAYERS.find((l) => l.layer === 'global')!.support).toBe('supported');
  });
  it('Differential Privacy/Model Weight Sharing/Production Apply = unsupported (정직 표기)', () => {
    expect(FEDERATED_SUPPORT.find((s) => s.key === 'differential_privacy')!.status).toBe('unsupported');
    expect(FEDERATED_SUPPORT.find((s) => s.key === 'model_weight_sharing')!.status).toBe('unsupported');
    expect(FEDERATED_SUPPORT.find((s) => s.key === 'production_apply')!.status).toBe('unsupported');
    expect(FEDERATED_SUPPORT.find((s) => s.key === 'federated_trust')!.status).toBe('read_only');
  });
});
