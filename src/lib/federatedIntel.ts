/**
 * federatedIntel — Federated Learning & Privacy-Preserving Intelligence 순수 로직 (Phase AI-MUSIC-14).
 *
 * Store 는 Raw Data 를 보내지 않는다 — Pattern/Statistics/Confidence/Sample/Evidence 만 추출하고
 * Privacy Validation(최소 표본·익명성 임계·PII/식별자/민감 데이터 차단)을 통과한
 * 익명 Knowledge 만 Federation 한다. 결과는 Evidence Only — 자동 실행/Production 변경 없음.
 *
 * 원칙: deterministic · 식별자 필드 자체를 만들지 않음(whitelist 추출) ·
 *       없는 성분 null 유지 · 상관≠인과 · 승격 게이트는 코드 상수(AI 수정 불가).
 */
import { isFiniteNumber, clampScore, normalizeAvailableComponents } from './aiMemory';

export { isFiniteNumber, clampScore };

export const FEDERATED_SOURCE_VERSION = 'federated_v1(0501)';

/* ── 계층 ───────────────────────────────────────────────────────────────── */
export type FederatedLayer = 'store' | 'brand' | 'enterprise' | 'region' | 'global';
export const FEDERATED_LAYERS: Array<{ layer: FederatedLayer; label: string; support: 'supported' | 'partially_supported' | 'insufficient_data'; note: string }> = [
  { layer: 'store', label: 'Store Learning', support: 'supported', note: '자기 데이터만 학습(외부 Store 접근 없음)' },
  { layer: 'brand', label: 'Brand Learning', support: 'insufficient_data', note: '별도 Brand 계층 데이터 없음' },
  { layer: 'enterprise', label: 'Enterprise Learning', support: 'partially_supported', note: '익명 franchise 집계(2+ Store)' },
  { layer: 'region', label: 'Regional Learning', support: 'partially_supported', note: 'franchise_regions 라벨 집계' },
  { layer: 'global', label: 'Global Learning', support: 'supported', note: '전체 익명 집계' },
];

export type PromotionStatus = 'local_only' | 'candidate' | 'regional' | 'enterprise' | 'global_candidate' | 'global_validated' | 'deprecated' | 'archived';

/* ── Knowledge Extraction(whitelist 필드만 — 식별자 미포함) ─────────────── */
export interface LocalKpiInput { industry: string; contextKey?: string | null; metricCode: string; value: number | null; baseline: number | null; sampleCount: number; sampleStores: number }
export interface AnonymousKnowledge {
  patternKey: string; layer: FederatedLayer; industry: string; contextKey: string | null; metricCode: string;
  direction: 'positive' | 'negative' | 'neutral'; effectValue: number; baselineValue: number;
  confidence: number | null; sampleCount: number; sampleStores: number;
  evidence: Array<{ label: string; value: string | number }>; limitations: string[];
}
/** Raw Data 대신 통계만 추출. 식별자 필드는 생성 자체를 하지 않는다(whitelist 방식). */
export function extractKnowledge(inp: LocalKpiInput, layer: FederatedLayer): AnonymousKnowledge | null {
  if (!isFiniteNumber(inp.value) || !isFiniteNumber(inp.baseline)) return null;   // 데이터 없는 KPI 추출 금지
  const delta = inp.value - inp.baseline;
  const confidence = inp.sampleCount >= 300 ? 70 : inp.sampleCount >= 100 ? 55 : inp.sampleCount >= 30 ? 40 : null;
  return {
    patternKey: `${layer}:${inp.industry}:${inp.metricCode}`, layer, industry: inp.industry,
    contextKey: inp.contextKey ?? null, metricCode: inp.metricCode,
    direction: delta > 0.5 ? 'positive' : delta < -0.5 ? 'negative' : 'neutral',
    effectValue: Math.round(inp.value * 100) / 100, baselineValue: Math.round(inp.baseline * 100) / 100,
    confidence, sampleCount: inp.sampleCount, sampleStores: inp.sampleStores,
    evidence: [
      { label: 'metric', value: inp.metricCode }, { label: 'effect', value: inp.value },
      { label: 'baseline', value: inp.baseline }, { label: 'sample', value: inp.sampleCount }, { label: 'stores', value: inp.sampleStores },
    ],
    limitations: ['익명 통계만 공유(Raw Data 없음)', '관찰 상관 — 인과 아님'],
  };
}

/* ── Privacy Validation(공유 전 게이트) ─────────────────────────────────── */
export const FORBIDDEN_KEYS = ['store_id', 'store_name', 'user_id', 'business_id', 'business_name', 'email', 'phone', 'audio_url', 'file_url', 'contract', 'settlement', 'account', 'iban', 'payout'];
export interface PrivacyCheckInput { sampleCount: number; sampleStores: number; layer: FederatedLayer; payloadKeys: string[]; payloadText: string }
export interface PrivacyCheckResult { passed: boolean; violations: string[]; checks: Record<string, boolean> }
export function validatePrivacy(inp: PrivacyCheckInput): PrivacyCheckResult {
  const violations: string[] = [];
  if (inp.sampleCount < 30) violations.push('min_sample: sample_count < 30');
  if (inp.layer !== 'store' && inp.sampleStores < 3) violations.push('anonymity: sample_stores < 3 (재식별 위험)');
  for (const k of inp.payloadKeys) if (FORBIDDEN_KEYS.includes(k.toLowerCase())) violations.push(`forbidden_field: ${k}`);
  const txt = inp.payloadText.toLowerCase();
  for (const k of FORBIDDEN_KEYS) if (txt.includes(`"${k}"`)) violations.push(`forbidden_field: ${k}`);
  if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/.test(txt)) violations.push('pii: email pattern');
  if (/https?:\/\//.test(txt)) violations.push('pii: url pattern (Audio URL 등 원본 링크 금지)');
  const dedup = [...new Set(violations)];
  return {
    passed: dedup.length === 0, violations: dedup,
    checks: { min_sample: inp.sampleCount >= 30, anonymity: inp.layer === 'store' || inp.sampleStores >= 3, forbidden_fields: !dedup.some((v) => v.startsWith('forbidden')), pii_scan: !dedup.some((v) => v.startsWith('pii')) },
  };
}

/* ── Federated Aggregation(표본 가중 결정적 병합) ───────────────────────── */
export interface AggregateInput { effectValue: number | null; confidence: number | null; sampleCount: number; sampleStores: number }
export function aggregateKnowledge(rows: AggregateInput[]): { effect: number | null; confidence: number | null; sampleCount: number; sampleStores: number } | null {
  const valid = rows.filter((r) => isFiniteNumber(r.effectValue) && r.sampleCount > 0);
  if (valid.length < 2) return null;   // 단일 Source 를 상위 계층으로 일반화하지 않음
  const totalSample = valid.reduce((a, r) => a + r.sampleCount, 0);
  const effect = valid.reduce((a, r) => a + (r.effectValue as number) * r.sampleCount, 0) / totalSample;
  const confs = valid.map((r) => r.confidence).filter(isFiniteNumber);
  return {
    effect: Math.round(effect * 100) / 100,
    confidence: confs.length ? clampScore(confs.reduce((a, b) => a + b, 0) / confs.length) : null,
    sampleCount: totalSample,
    sampleStores: valid.reduce((a, r) => a + r.sampleStores, 0),
  };
}

/* ── Local Override(Global 보다 Local Evidence 우선 조건) ───────────────── */
export interface OverrideInput {
  globalDirection: 'positive' | 'negative' | 'neutral'; globalConfidence: number | null; globalSample: number;
  localDirection: 'positive' | 'negative' | 'neutral'; localConfidence: number | null; localSample: number;
}
export type OverrideDecision = 'local_preferred' | 'global_preferred' | 'governance_review' | 'insufficient_data';
export function resolveLocalOverride(inp: OverrideInput): { decision: OverrideDecision; note: string } {
  if (inp.localSample < 30 && inp.globalSample < 30) return { decision: 'insufficient_data', note: '양쪽 표본 부족' };
  if (inp.localSample < 30) return { decision: 'global_preferred', note: 'Local Evidence 부족 → Global 참고' };
  if (inp.localDirection === inp.globalDirection) return { decision: 'global_preferred', note: '방향 일치 — Global Knowledge 로 보강' };
  const localStrong = (inp.localConfidence ?? 0) >= 55 && inp.localSample >= 100;
  const globalStrong = (inp.globalConfidence ?? 0) >= 55 && inp.globalSample >= 300;
  if (localStrong && globalStrong) return { decision: 'governance_review', note: '강한 상반 Evidence — Governance Review 필요' };
  if (localStrong) return { decision: 'local_preferred', note: 'Local Evidence 강함 → Local 우선(예: 병원은 Classical 우선)' };
  return { decision: 'global_preferred', note: 'Local Evidence 약함 → Global 참고' };
}

/* ── Conflict Detection ─────────────────────────────────────────────────── */
export interface FederatedPatternLike { id: string; layer: FederatedLayer; industry: string | null; metricCode: string; direction: string | null; confidence: number | null; sampleCount: number }
export interface DetectedConflict { conflictKey: string; type: 'local_vs_global'; localId: string; globalId: string; summary: string }
export function detectFederatedConflicts(locals: FederatedPatternLike[], globals: FederatedPatternLike[]): DetectedConflict[] {
  const out: DetectedConflict[] = [];
  for (const l of [...locals].sort((a, b) => a.id.localeCompare(b.id))) {
    const g = globals.find((x) => x.industry === l.industry && x.metricCode === l.metricCode);
    if (!g || !l.direction || !g.direction) continue;
    const opposed = (l.direction === 'positive' && g.direction === 'negative') || (l.direction === 'negative' && g.direction === 'positive');
    if (opposed) out.push({
      conflictKey: `cfl:${l.industry}:${l.metricCode}`, type: 'local_vs_global', localId: l.id, globalId: g.id,
      summary: `${l.industry ?? '?'} ${l.metricCode}: Local ${l.direction} vs Global ${g.direction}`,
    });
  }
  return out;
}

/* ── Knowledge Promotion 게이트(코드 상수 — AI 수정 불가) ───────────────── */
export const PROMOTION_GATES: Record<string, { stores: number; sample: number; confidence?: number }> = {
  regional: { stores: 3, sample: 30 },
  enterprise: { stores: 5, sample: 30 },
  global_candidate: { stores: 10, sample: 300 },
  global_validated: { stores: 20, sample: 1000, confidence: 60 },
};
export function classifyPromotion(inp: { current: PromotionStatus; target: PromotionStatus; sampleStores: number; sampleCount: number; confidence: number | null; privacyPassed: boolean }): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!inp.privacyPassed) reasons.push('privacy gate 미통과');
  const gate = PROMOTION_GATES[inp.target];
  if (gate) {
    if (inp.sampleStores < gate.stores) reasons.push(`stores>=${gate.stores} 필요(현재 ${inp.sampleStores})`);
    if (inp.sampleCount < gate.sample) reasons.push(`sample>=${gate.sample} 필요(현재 ${inp.sampleCount})`);
    if (gate.confidence != null && (inp.confidence ?? 0) < gate.confidence) reasons.push(`confidence>=${gate.confidence} 필요`);
  }
  return { eligible: reasons.length === 0, reasons };
}

/* ── Knowledge Decay(삭제 아님 — deprecated/archive 권고) ───────────────── */
export function calculateKnowledgeDecay(inp: { lastValidatedAt: string | Date | null; now: Date; confidence: number | null }): { decayedConfidence: number | null; recommendation: 'keep' | 'revalidate' | 'deprecate' | 'archive' | 'insufficient_data' } {
  if (!isFiniteNumber(inp.confidence)) return { decayedConfidence: null, recommendation: 'insufficient_data' };
  if (!inp.lastValidatedAt) return { decayedConfidence: inp.confidence, recommendation: 'revalidate' };
  const age = (inp.now.getTime() - new Date(inp.lastValidatedAt).getTime()) / 86_400_000;
  if (!Number.isFinite(age) || age < 0) return { decayedConfidence: null, recommendation: 'insufficient_data' };
  const decayed = clampScore(inp.confidence * Math.pow(0.5, age / 180));   // 반감기 180일
  const recommendation = decayed >= 50 ? 'keep' : decayed >= 30 ? 'revalidate' : decayed >= 15 ? 'deprecate' : 'archive';
  return { decayedConfidence: decayed, recommendation };
}

/* ── Federated Trust(표시 전용 — 직접 수정 없음) ────────────────────────── */
export function computeFederatedTrust(inp: { localTrust?: number | null; enterpriseTrust?: number | null; globalTrust?: number | null; privacyPassRate?: number | null }): { score: number | null; components: Array<{ key: string; value: number | null }> } {
  const r = normalizeAvailableComponents([
    { key: 'local_trust', value: inp.localTrust ?? null, weight: 0.3 },
    { key: 'enterprise_trust', value: inp.enterpriseTrust ?? null, weight: 0.2 },
    { key: 'global_trust', value: inp.globalTrust ?? null, weight: 0.2 },
    { key: 'privacy_pass_rate', value: inp.privacyPassRate ?? null, weight: 0.3 },
  ]);
  return { score: r.score, components: [
    { key: 'local_trust', value: inp.localTrust ?? null }, { key: 'enterprise_trust', value: inp.enterpriseTrust ?? null },
    { key: 'global_trust', value: inp.globalTrust ?? null }, { key: 'privacy_pass_rate', value: inp.privacyPassRate ?? null },
  ] };
}

export function federatedInputHash(parts: Array<string | number | null | undefined>): string {
  const s = parts.map((p) => (p == null ? '' : String(p))).join('|');
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `fed_${(h >>> 0).toString(16)}`;
}

/* ── Support Matrix ─────────────────────────────────────────────────────── */
export type FederatedSupportStatus = 'fully_supported' | 'partially_supported' | 'read_only' | 'evidence_only' | 'unsupported' | 'insufficient_data';
export interface FederatedSupport { key: string; label: string; status: FederatedSupportStatus; note: string }
export const FEDERATED_SUPPORT: FederatedSupport[] = [
  { key: 'local_learning', label: 'Store Local Learning', status: 'fully_supported', note: '자기 데이터만(외부 Store 접근 없음)' },
  { key: 'brand_learning', label: 'Brand Learning', status: 'insufficient_data', note: 'Brand 계층 데이터 없음' },
  { key: 'enterprise_learning', label: 'Enterprise Learning', status: 'partially_supported', note: '익명 franchise 집계(0500 재사용)' },
  { key: 'regional_learning', label: 'Regional Learning', status: 'partially_supported', note: 'franchise_regions 집계' },
  { key: 'global_learning', label: 'Global Learning', status: 'fully_supported', note: '전체 익명 집계' },
  { key: 'knowledge_extraction', label: 'Knowledge Extraction', status: 'fully_supported', note: 'whitelist 통계만(Raw Data 없음)' },
  { key: 'privacy_validation', label: 'Privacy Validation', status: 'fully_supported', note: '표본/익명성/금지필드/PII 4중 게이트 + Audit' },
  { key: 'anonymous_knowledge', label: 'Anonymous Knowledge', status: 'fully_supported', note: 'Store 식별자 필드 자체 없음' },
  { key: 'aggregation', label: 'Federated Aggregation', status: 'fully_supported', note: '표본 가중 결정적 병합(2+ Source)' },
  { key: 'federated_graph', label: 'Global Knowledge Graph', status: 'partially_supported', note: '기존 Graph(0498) 무변경 — patterns 테이블 별도(테이블형 표현)' },
  { key: 'local_override', label: 'Local Override', status: 'fully_supported', note: 'Local Evidence 강하면 Local 우선' },
  { key: 'conflict_resolution', label: 'Conflict Resolution', status: 'partially_supported', note: 'Governance Review(사람) — 자동 해소 없음' },
  { key: 'federated_trust', label: 'Federated Trust', status: 'read_only', note: '표시 전용 재정규화(직접 수정 없음)' },
  { key: 'promotion', label: 'Knowledge Promotion', status: 'fully_supported', note: '표본 게이트(코드 상수, AI 수정 불가) + 사람 승인' },
  { key: 'decay', label: 'Knowledge Decay', status: 'fully_supported', note: '반감기 180일 권고(삭제 없음 — deprecated/archive 상태)' },
  { key: 'differential_privacy', label: 'Differential Privacy(수학적)', status: 'unsupported', note: 'noise 주입 미지원 — 표본/익명성 임계 방식만' },
  { key: 'model_weight_sharing', label: 'Model Weight Sharing', status: 'unsupported', note: 'ML 모델 가중치 교환 없음(통계 Knowledge 만)' },
  { key: 'production_apply', label: 'Production Apply', status: 'unsupported', note: '금지 — Evidence Only' },
];

/* ── 라벨/톤 ────────────────────────────────────────────────────────────── */
export const STATUS_LABEL: Record<PromotionStatus, string> = { local_only: 'Local Only', candidate: '후보', regional: 'Regional', enterprise: 'Enterprise', global_candidate: 'Global 후보', global_validated: 'Global 검증됨', deprecated: 'Deprecated', archived: '보관' };
export const STATUS_TONE: Record<PromotionStatus, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = { local_only: 'neutral', candidate: 'info', regional: 'info', enterprise: 'info', global_candidate: 'warning', global_validated: 'success', deprecated: 'danger', archived: 'neutral' };
export const OVERRIDE_LABEL: Record<OverrideDecision, string> = { local_preferred: 'Local 우선', global_preferred: 'Global 참고', governance_review: 'Governance Review', insufficient_data: '데이터 부족' };
export const OVERRIDE_TONE: Record<OverrideDecision, 'success' | 'info' | 'warning' | 'neutral'> = { local_preferred: 'success', global_preferred: 'info', governance_review: 'warning', insufficient_data: 'neutral' };
