/**
 * reviewSymptoms — 음원 검수 거절 시 고르는 '증상' 체크박스와 문제 시점 입력 (0547).
 *
 * 운영 거절 기록(8,690곡)에 실제로 쓰인 표현을 묶은 것이다. 구조화해서 남겨야
 * 자동 음질 분석기를 학습·검증할 수 있고, 아티스트에게도 무엇을 고칠지 구체적으로 전달된다.
 */
import { supabase } from '@/lib/supabase';

export interface ReviewSymptom {
  key: string;
  label: string;
}

export const REVIEW_SYMPTOMS: readonly ReviewSymptom[] = [
  { key: 'late_degradation', label: '후반부로 갈수록 음질 저하' },
  { key: 'noise', label: '노이즈' },
  { key: 'vocal_crack', label: '보컬 갈라짐' },
  { key: 'distortion', label: '소리 찢어짐·왜곡' },
  { key: 'harsh_highs', label: '고음이 날카로움(쇳소리)' },
  { key: 'metallic_artifacts', label: '금속성 잡음·AI 잡음' },
  { key: 'loudness_low', label: '음압(볼륨) 부족' },
  { key: 'over_mastered', label: '마스터링 과함·음압 과다' },
  { key: 'boomy_bass', label: '저음 울림(부밍)' },
];

const LABEL = new Map(REVIEW_SYMPTOMS.map((s) => [s.key, s.label]));

/** "1:30, 2:05~2:40, 95" → [90, 125, 160, 95] (중복 제거·정렬). 형식이 틀린 조각은 무시. */
export function parseProblemTimes(raw: string): number[] {
  const out = new Set<number>();
  for (const part of (raw ?? '').split(/[,\s/]+/)) {
    for (const piece of part.split(/[~\-–]/)) {
      const p = piece.trim();
      if (!p) continue;
      const m = /^(\d{1,2}):([0-5]\d)$/.exec(p);
      const sec = m ? Number(m[1]) * 60 + Number(m[2]) : /^\d{1,4}$/.test(p) ? Number(p) : NaN;
      if (Number.isFinite(sec) && sec >= 0 && sec <= 3600) out.add(sec);
    }
  }
  return [...out].sort((a, b) => a - b);
}

export function formatSeconds(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

/** 아티스트에게 전달되는 문장 — "음질 부족: 노이즈, 보컬 갈라짐 (2:30·3:10 부근) / 메모" */
export function composeReason(label: string, symptoms: string[], seconds: number[], note: string): string {
  const parts: string[] = [];
  const sym = symptoms.map((k) => LABEL.get(k)).filter(Boolean).join(', ');
  if (sym) parts.push(sym + (seconds.length ? ` (${seconds.map(formatSeconds).join('·')} 부근)` : ''));
  else if (seconds.length) parts.push(`${seconds.map(formatSeconds).join('·')} 부근`);
  const n = note.trim();
  if (n) parts.push(n);
  return parts.length ? `${label}: ${parts.join(' / ')}` : label;
}

export interface ReviewDetail {
  reasonKey: string;
  symptoms: string[];
  problemSeconds: number[];
  note: string;
}

/** 거절·수정요청 직후 구조화 기록을 남긴다. 실패해도 검수 자체는 이미 끝났으므로 조용히 넘긴다. */
export async function recordReviewDetail(trackIds: string[], decision: 'reject' | 'changes' | 'approve', d: ReviewDetail | null): Promise<void> {
  if (!d || trackIds.length === 0) return;
  const { error } = await supabase.rpc('admin_record_track_review_detail', {
    p_track_ids: trackIds,
    p_decision: decision,
    p_reason_key: d.reasonKey,
    p_symptoms: d.symptoms,
    p_problem_seconds: d.problemSeconds,
    p_note: d.note || null,
  });
  if (error) console.warn('[review-detail] record failed', error.message);
}
