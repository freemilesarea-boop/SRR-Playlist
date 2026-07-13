/**
 * multiAgent — Multi-Agent Collaboration Engine 순수 로직 (Phase AI-MUSIC-9).
 *
 * 여러 전문 Agent(Context/Prediction/Playlist/Ranking/Rotation/Quality/Revenue/Governance)가
 * 독립 의견을 생성 → Discussion → Consensus → Conflict 해결 → Governance 제출한다.
 * Agent 는 Production Entity/Trust/Constitution/서로의 Memory 를 수정하지 않는다(기록·분석만).
 *
 * 원칙:
 *  - Agent 는 실제 신호(Context/Prediction/Strategy 집계)로만 의견 생성 · 미지원은 abstain.
 *  - Consensus/Conflict 재현 가능(결정적) · Reputation 은 실제 Outcome 으로만 갱신.
 *  - 점수 0~100 clamp · NaN 금지 · Critical Conflict → governance_required.
 *  - Production Apply 없음(의견/합의/충돌 기록까지만).
 */
const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const clamp100 = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/* ── Agent 카탈로그 ─────────────────────────────────────────────────────── */
export type AgentCode = 'context' | 'prediction' | 'playlist' | 'ranking' | 'rotation' | 'quality' | 'revenue' | 'governance';
export interface AgentDef { code: AgentCode; name: string; domain: string; responsibilities: string[] }
export const AGENTS: AgentDef[] = [
  { code: 'context', name: 'Context Agent', domain: 'context', responsibilities: ['시간', '요일', '계절', '업종', 'Store Context'] },
  { code: 'prediction', name: 'Prediction Agent', domain: 'prediction', responsibilities: ['Skip 예측', 'Like 예측', 'Completion 예측', 'Revenue 영향', 'Risk 예측'] },
  { code: 'playlist', name: 'Playlist Agent', domain: 'playlist', responsibilities: ['Playlist 생성', '개선', '다양성', '신선도'] },
  { code: 'ranking', name: 'Ranking Agent', domain: 'ranking', responsibilities: ['Track 우선순위', 'Artist Exposure', 'Discovery'] },
  { code: 'rotation', name: 'Rotation Agent', domain: 'rotation', responsibilities: ['반복 제거', 'Fatigue 방지', 'Rotation 균형'] },
  { code: 'quality', name: 'Quality Agent', domain: 'quality', responsibilities: ['Playback Quality', 'Buffer', 'Decoder Error', 'Streaming Quality'] },
  { code: 'revenue', name: 'Revenue Agent', domain: 'revenue', responsibilities: ['정산 영향', '계약 영향', 'ROI', 'Store Satisfaction'] },
  { code: 'governance', name: 'Governance Agent', domain: 'governance', responsibilities: ['Constitution', 'Trust', 'Audit', 'Candidate 검증'] },
];
export function agentDef(code: AgentCode): AgentDef | undefined { return AGENTS.find((a) => a.code === code); }

/* ── Agent 의견 ─────────────────────────────────────────────────────────── */
export type Stance = 'support' | 'neutral' | 'oppose' | 'abstain';
export interface AgentOpinion { agent: AgentCode; score: number | null; stance: Stance; confidence: number; rationale: string; supported: boolean }

/** 협업 입력 — 각 Agent 도메인 신호(실제 집계). 없는 신호는 null(abstain). */
export interface CollaborationInput {
  contextKey: string;
  contextHealth?: number | null; contextDrift?: number | null; sample: number;
  predictedCompletion?: number | null; predictedSkip?: number | null; predictionConfidence?: number | null; riskScore?: number | null;
  playlistDiversity?: number | null; playlistFreshness?: number | null;
  trackCoverage?: number | null; artistExposure?: number | null;
  repeatRisk?: number | null; fatigueRisk?: number | null;
  streamingQuality?: number | null; bufferHealth?: number | null;
  roi?: number | null; storeSatisfaction?: number | null;
  governanceHealth?: number | null; constitutionPass?: boolean;
}

function op(agent: AgentCode, score: number | null, confidence: number, rationale: string): AgentOpinion {
  if (!isNum(score)) return { agent, score: null, stance: 'abstain', confidence: 0, rationale: `${rationale} (신호 없음 — abstain)`, supported: false };
  const s = clamp100(score);
  const stance: Stance = s >= 65 ? 'support' : s >= 45 ? 'neutral' : 'oppose';
  return { agent, score: s, stance, confidence: clamp100(confidence), rationale, supported: true };
}
const avg = (...xs: Array<number | null | undefined>) => { const v = xs.filter(isNum); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

/** 각 Agent 독립 의견 생성(도메인 신호 기반, 결정적). */
export function generateOpinions(inp: CollaborationInput): AgentOpinion[] {
  const conf = clamp100(Math.min(100, (inp.sample / 200) * 100));
  return [
    op('context', avg(inp.contextHealth, isNum(inp.contextDrift) ? 100 - inp.contextDrift : null), conf, 'Context Health/Drift'),
    op('prediction', avg(inp.predictedCompletion, isNum(inp.predictedSkip) ? 100 - inp.predictedSkip : null, isNum(inp.riskScore) ? 100 - inp.riskScore : null), inp.predictionConfidence ?? conf, 'Completion/Skip/Risk 예측'),
    op('playlist', avg(inp.playlistDiversity, inp.playlistFreshness), conf, 'Diversity/Freshness'),
    op('ranking', avg(inp.trackCoverage, inp.artistExposure), conf, 'Coverage/Exposure/Discovery'),
    op('rotation', avg(isNum(inp.repeatRisk) ? 100 - inp.repeatRisk : null, isNum(inp.fatigueRisk) ? 100 - inp.fatigueRisk : null), conf, '반복/Fatigue 역'),
    op('quality', avg(inp.streamingQuality, inp.bufferHealth), conf, 'Streaming/Buffer Quality'),
    op('revenue', avg(inp.roi, inp.storeSatisfaction), conf, 'ROI/Store Satisfaction'),
    op('governance', inp.constitutionPass === false ? 0 : (inp.governanceHealth ?? null), conf, inp.constitutionPass === false ? 'Constitution 위반' : 'Governance Health'),
  ];
}

/* ── Consensus Engine ───────────────────────────────────────────────────── */
export type ConsensusType = 'unanimous' | 'majority' | 'weighted_consensus' | 'governance_required' | 'insufficient_data';
export interface ConsensusResult { type: ConsensusType; score: number | null; support: number; oppose: number; neutral: number; abstain: number; participants: number; note: string }

/** 의견 stance 분포 + reputation 가중으로 합의 산출. Critical(Governance oppose 또는 강한 대립) → governance_required. */
export function consensusEngine(opinions: AgentOpinion[], reputation: Partial<Record<AgentCode, number>> = {}): ConsensusResult {
  const active = opinions.filter((o) => o.supported && o.stance !== 'abstain');
  const support = active.filter((o) => o.stance === 'support').length;
  const oppose = active.filter((o) => o.stance === 'oppose').length;
  const neutral = active.filter((o) => o.stance === 'neutral').length;
  const abstain = opinions.length - active.length;
  if (active.length < 3) return { type: 'insufficient_data', score: null, support, oppose, neutral, abstain, participants: active.length, note: '참여(비abstain) Agent 3 미만' };

  const gov = opinions.find((o) => o.agent === 'governance');
  const govBlock = gov?.supported && (gov.stance === 'oppose' || (isNum(gov.score) && gov.score < 40));
  // Reputation 가중 평균 점수.
  const wsum = active.reduce((a, o) => a + (reputation[o.agent] ?? 60), 0) || 1;
  const wscore = clamp100(active.reduce((a, o) => a + (o.score as number) * (reputation[o.agent] ?? 60), 0) / wsum);

  if (govBlock || (oppose >= 2 && support >= 2)) {
    return { type: 'governance_required', score: wscore, support, oppose, neutral, abstain, participants: active.length, note: govBlock ? 'Governance Agent 반대/저평가' : '강한 대립 — Governance Review' };
  }
  if (oppose === 0 && neutral === 0) return { type: 'unanimous', score: wscore, support, oppose, neutral, abstain, participants: active.length, note: '전원 support' };
  if (support > oppose + neutral) return { type: 'majority', score: wscore, support, oppose, neutral, abstain, participants: active.length, note: '과반 support' };
  return { type: 'weighted_consensus', score: wscore, support, oppose, neutral, abstain, participants: active.length, note: 'Reputation 가중 합의' };
}

/* ── Conflict Detection ─────────────────────────────────────────────────── */
export interface AgentConflict { a: AgentCode; b: AgentCode; reason: string; severity: 'low' | 'medium' | 'high' }
const CONFLICT_PAIRS: Array<{ a: AgentCode; b: AgentCode; reason: string }> = [
  { a: 'playlist', b: 'rotation', reason: 'Playlist 다양성 vs Rotation 반복 제거' },
  { a: 'revenue', b: 'playlist', reason: 'Revenue ROI vs Diversity' },
  { a: 'prediction', b: 'quality', reason: 'Prediction 성과 vs Playback Quality' },
  { a: 'revenue', b: 'ranking', reason: 'Revenue vs Discovery/Exposure' },
];
/** 상반 도메인 쌍에서 stance 가 대립(support vs oppose)하면 Conflict. 점수차로 severity. */
export function detectConflicts(opinions: AgentOpinion[]): AgentConflict[] {
  const byCode = new Map(opinions.map((o) => [o.agent, o]));
  const out: AgentConflict[] = [];
  for (const p of CONFLICT_PAIRS) {
    const a = byCode.get(p.a); const b = byCode.get(p.b);
    if (!a?.supported || !b?.supported || !isNum(a.score) || !isNum(b.score)) continue;
    const opposed = (a.stance === 'support' && b.stance === 'oppose') || (a.stance === 'oppose' && b.stance === 'support');
    const gap = Math.abs(a.score - b.score);
    if (opposed || gap >= 40) out.push({ a: p.a, b: p.b, reason: p.reason, severity: gap >= 50 ? 'high' : gap >= 25 ? 'medium' : 'low' });
  }
  return out;
}
export function hasCriticalConflict(conflicts: AgentConflict[]): boolean { return conflicts.some((c) => c.severity === 'high'); }

/* ── Agent Reputation(Outcome 기반) ─────────────────────────────────────── */
export interface AgentRepInput { decisions: number; wins: number }
export function agentReputationScore(inp: AgentRepInput): number | null {
  if (inp.decisions <= 0) return null;
  return clamp100((inp.wins / inp.decisions) * 100);
}

/* ── Collaboration 요약 / Governance 연동 ───────────────────────────────── */
export interface CollaborationResult {
  opinions: AgentOpinion[]; consensus: ConsensusResult; conflicts: AgentConflict[];
  finalDecision: 'proceed_to_governance' | 'governance_review' | 'hold'; governanceRequired: boolean; evidence: Array<{ label: string; value: string | number | boolean | null }>;
}
export function runCollaboration(inp: CollaborationInput, reputation: Partial<Record<AgentCode, number>> = {}): CollaborationResult {
  const opinions = generateOpinions(inp);
  const conflicts = detectConflicts(opinions);
  const consensus = consensusEngine(opinions, reputation);
  const governanceRequired = consensus.type === 'governance_required' || hasCriticalConflict(conflicts) || inp.constitutionPass === false;
  const finalDecision: CollaborationResult['finalDecision'] =
    consensus.type === 'insufficient_data' ? 'hold' : governanceRequired ? 'governance_review' : 'proceed_to_governance';
  return {
    opinions, consensus, conflicts, finalDecision, governanceRequired,
    evidence: [
      { label: 'Context', value: inp.contextKey }, { label: '참여 Agent', value: opinions.filter((o) => o.supported).length },
      { label: 'Consensus', value: consensus.type }, { label: 'Consensus Score', value: consensus.score },
      { label: 'Conflicts', value: conflicts.length }, { label: 'Sample', value: inp.sample },
      { label: 'Constitution', value: inp.constitutionPass === false ? 'violation' : 'ok' }, { label: 'Final', value: finalDecision },
    ],
  };
}

export function collaborationIdempotencyKey(parts: { contextKey: string; topic: string; participants: AgentCode[]; inputHash: string | null }): string {
  const s = `${parts.contextKey}|${parts.topic}|${[...parts.participants].sort().join(',')}|${parts.inputHash ?? ''}`;
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `col_${(h >>> 0).toString(16)}`;
}

/* ── 지원 매트릭스 ──────────────────────────────────────────────────────── */
export type AgentSupportStatus = 'supported' | 'partially_supported' | 'unsupported' | 'insufficient_data';
export interface AgentSupport { code: AgentCode; label: string; status: AgentSupportStatus; note: string }
export const AGENT_SUPPORT: AgentSupport[] = [
  { code: 'context', label: 'Context Agent', status: 'supported', note: 'Context Intelligence/Learning' },
  { code: 'prediction', label: 'Prediction Agent', status: 'supported', note: 'Predictive Engine' },
  { code: 'playlist', label: 'Playlist Agent', status: 'supported', note: 'Playlist/Generator 집계' },
  { code: 'ranking', label: 'Ranking Agent', status: 'partially_supported', note: 'Coverage/Exposure(개별 Artist 지표 제한)' },
  { code: 'rotation', label: 'Rotation Agent', status: 'supported', note: 'Rotation/Anti-Fatigue' },
  { code: 'quality', label: 'Quality Agent', status: 'partially_supported', note: 'Streaming 지표 일부(Decoder Error 제한)' },
  { code: 'revenue', label: 'Revenue Agent', status: 'partially_supported', note: 'ROI/Satisfaction(계약 세부 제한)' },
  { code: 'governance', label: 'Governance Agent', status: 'supported', note: 'Constitution/Trust/Audit' },
];

/* ── 표시 헬퍼 ──────────────────────────────────────────────────────────── */
export const STANCE_LABEL: Record<Stance, string> = { support: '찬성', neutral: '중립', oppose: '반대', abstain: '기권' };
export const STANCE_TONE: Record<Stance, 'success' | 'neutral' | 'danger' | 'warning'> = { support: 'success', neutral: 'neutral', oppose: 'danger', abstain: 'warning' };
export const CONSENSUS_LABEL: Record<ConsensusType, string> = { unanimous: '만장일치', majority: '과반', weighted_consensus: '가중 합의', governance_required: 'Governance 필요', insufficient_data: '데이터 부족' };
export const CONSENSUS_TONE: Record<ConsensusType, 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = { unanimous: 'success', majority: 'info', weighted_consensus: 'info', governance_required: 'warning', insufficient_data: 'neutral' };
export const CONFLICT_SEVERITY_TONE: Record<'low' | 'medium' | 'high', 'neutral' | 'warning' | 'danger'> = { low: 'neutral', medium: 'warning', high: 'danger' };
export const FINAL_DECISION_LABEL: Record<CollaborationResult['finalDecision'], string> = { proceed_to_governance: 'Governance 제출', governance_review: 'Governance Review', hold: '보류' };
export function reputationTone(score: number | null): 'success' | 'warning' | 'danger' | 'neutral' { return score == null ? 'neutral' : score >= 65 ? 'success' : score >= 45 ? 'warning' : 'danger'; }
