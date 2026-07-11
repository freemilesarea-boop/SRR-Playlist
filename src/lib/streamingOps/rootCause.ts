// WEB-OBS-8 — Root-cause evidence chain. Instead of a bare "Recovery Failure", assemble the observed
// evidence sequence (waiting → networkState=2 → readyState=1 → recovery failed → media error) and a
// RULE-derived confidence from how many corroborating links exist. Confidence is CAPPED below 100 — the
// browser can never fully prove causation. Honest caveats are attached (media error ≠ proven network
// failure; a play error ≠ a network outage).

import { ROOTCAUSE_MAX_CONFIDENCE, ROOTCAUSE_MIN_LINKS, ROOTCAUSE_LINK_CONFIDENCE } from './thresholds';
import type { SqEventRow, RootCauseEvidence, RootCauseVerdict, EvidenceLink } from './types';

const MEDIA_LABEL: Record<number, string> = { 0: 'UNKNOWN', 1: 'ABORTED', 2: 'NETWORK', 3: 'DECODE', 4: 'SRC_NOT_SUPPORTED' };
const NET_LABEL: Record<number, string> = { 0: 'EMPTY', 1: 'IDLE', 2: 'LOADING', 3: 'NO_SOURCE' };

/**
 * Build a root-cause evidence chain from the ordered rows of a failing session/incident. The verdict is
 * the strongest corroborated signal; confidence grows with the number of links but is capped and honest.
 */
export function buildRootCauseEvidence(scope: string, rows: SqEventRow[]): RootCauseEvidence {
  const ordered = [...rows].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  const chain: EvidenceLink[] = [];

  const hasStall = ordered.some((e) => (e.eventType === 'recovery_attempted' || e.eventType === 'recovery_failed') && (e.reason === 'stalled' || e.reason === 'neither-playing' || e.reason === 'crossfade-stuck'));
  const mediaErr = ordered.find((e) => e.eventType === 'media_error');
  const recovFail = ordered.some((e) => e.eventType === 'recovery_failed');
  const recovOk = ordered.some((e) => e.eventType === 'recovery_succeeded');
  const netLoading = ordered.find((e) => e.networkState === 2);
  const readyLow = ordered.find((e) => e.readyState != null && e.readyState <= 1);
  const noProgress = !ordered.some((e) => e.eventType === 'first_progress');

  if (hasStall) chain.push({ at: (ordered.find((e) => e.reason === 'stalled')?.receivedAt) ?? ordered[0]?.receivedAt ?? '', signal: 'playback', observed: 'waiting / stalled (frozen progress)' });
  if (netLoading) chain.push({ at: netLoading.receivedAt, signal: 'networkState', observed: `networkState=2 (${NET_LABEL[2]})` });
  if (readyLow) chain.push({ at: readyLow.receivedAt, signal: 'readyState', observed: `readyState=${readyLow.readyState} (버퍼 부족)` });
  if (recovFail) chain.push({ at: (ordered.find((e) => e.eventType === 'recovery_failed')?.receivedAt) ?? '', signal: 'recovery', observed: 'recovery failed' });
  if (mediaErr) chain.push({ at: mediaErr.receivedAt, signal: 'media', observed: `media_error ${mediaErr.mediaCode != null ? MEDIA_LABEL[mediaErr.mediaCode] ?? mediaErr.mediaCode : '?'}` });

  // Verdict priority: media/decoder > network > stall/buffering > recovery-failure > autoplay-blocked.
  let verdict: RootCauseVerdict = 'UNKNOWN';
  if (mediaErr && (mediaErr.mediaCode === 3 || mediaErr.mediaCode === 4)) verdict = 'MEDIA_DECODER';
  else if ((mediaErr && mediaErr.mediaCode === 2) || netLoading) verdict = 'NETWORK';
  else if (hasStall) verdict = 'STALL_BUFFERING';
  else if (recovFail) verdict = 'RECOVERY_FAILURE';
  else if (noProgress && !mediaErr && !hasStall) verdict = 'AUTOPLAY_BLOCKED';

  if (chain.length < ROOTCAUSE_MIN_LINKS || verdict === 'UNKNOWN') {
    return {
      scope, verdict, confidence: chain.length < ROOTCAUSE_MIN_LINKS ? null : Math.min(ROOTCAUSE_MAX_CONFIDENCE, chain.length * ROOTCAUSE_LINK_CONFIDENCE),
      chain, summary: verdict === 'UNKNOWN' ? '단정 가능한 근거 부족 — 추가 신호 필요.' : '근거 링크 부족 — 낮은 신뢰도.',
      caveat: '증거는 상관관계이며 인과를 완전 증명하지 않습니다. media_error ≠ 네트워크 장애 확정, 브라우저는 스피커 출력을 증명 불가.',
    };
  }
  const confidence = Math.min(ROOTCAUSE_MAX_CONFIDENCE, chain.length * ROOTCAUSE_LINK_CONFIDENCE + (recovOk ? 0 : 8));
  const summaries: Record<RootCauseVerdict, string> = {
    MEDIA_DECODER: '디코더/코덱 비호환(DECODE/SRC_NOT_SUPPORTED)이 유력 — 소스/컨테이너·브라우저 확인 권고.',
    NETWORK: '네트워크 지연/중단(networkState=LOADING, MEDIA_ERR_NETWORK)이 유력 — 매장 회선 확인 권고.',
    STALL_BUFFERING: '버퍼링/정지(frozen progress)가 유력 — 네트워크/버퍼 확인 권고.',
    RECOVERY_FAILURE: '복구 실패가 관측됨 — 복구 경로/재발 확인 권고.',
    AUTOPLAY_BLOCKED: '진행 신호 없음(자동재생 차단 가능성) — 사용자 상호작용/정책 확인 권고.',
    CROSSFADE_FALLBACK: 'Crossfade fallback 경로 — 전환 경로 확인(관측만).',
    UNKNOWN: '단정 불가.',
  };
  return {
    scope, verdict, confidence, chain, summary: summaries[verdict],
    caveat: '증거는 상관관계이며 인과를 완전 증명하지 않습니다. media_error ≠ 네트워크 장애 확정, 브라우저는 스피커 출력을 증명 불가.',
  };
}
