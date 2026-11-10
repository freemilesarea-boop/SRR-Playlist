/**
 * segmentQc — 구간별 음질 분석 결과(0548 track_segment_qc)를 검수 화면용 신호로 바꾼다.
 *
 * 근거(2026-11-06, 운영 검수 기록 1,054곡 = 통과 628 · 음질 거절 426):
 *   · 16kHz 이상 고역 비율(mean_air_ratio)이 가장 잘 갈랐다(AUC 0.68).
 *       ≥ 0.0013 (상위 10%) → 그중 75% 가 거절됐다
 *       ≥ 0.0008 (상위 19%) → 64% 거절   (전체 평균 40%)
 *   · 뒷부분에서 고역이 늘어나는 곡(late_minus_early_air_ratio > 0.0005) → 59% 거절
 *   · 클리핑·음량·후반 잡음 평탄도는 통과/거절을 거의 가르지 못했다 → 신호로 쓰지 않는다.
 * 그래서 자동 거절이 아니라 '먼저 들어 볼 곡·구간'을 알려 주는 참고 표시로만 쓴다.
 */
import { supabase } from '@/lib/supabase';

export interface SegmentWindow {
  at: number;
  air_ratio: number;
  hf_ratio: number;
  [key: string]: number;
}

export interface SegmentQcRow {
  track_id: string;
  status: 'ok' | 'error';
  features: Record<string, number> | null;
  windows: SegmentWindow[] | null;
}

export type SegmentSignalLevel = 'high' | 'mid';

export interface SegmentSignal {
  level: SegmentSignalLevel;
  label: string;
  /** 마우스를 올리면 보이는 설명(과거 거절 비율 포함) */
  detail: string;
  /** 먼저 들어 볼 지점(초) — 고역이 가장 많은 구간 */
  listenAt: number | null;
}

export const AIR_HIGH = 0.0013;
export const AIR_MID = 0.0008;
export const LATE_AIR_RISE = 0.0005;

export function formatClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 고역이 가장 많은 구간의 시작 시각. */
function loudestAirAt(windows: SegmentWindow[] | null): number | null {
  if (!windows || windows.length === 0) return null;
  let best = windows[0];
  for (const w of windows) if ((w.air_ratio ?? 0) > (best.air_ratio ?? 0)) best = w;
  return typeof best.at === 'number' ? best.at : null;
}

export function segmentSignals(row: SegmentQcRow | undefined | null): SegmentSignal[] {
  if (!row || row.status !== 'ok' || !row.features) return [];
  const f = row.features;
  const air = Number(f.mean_air_ratio ?? 0);
  const lateRise = Number(f.late_minus_early_air_ratio ?? 0);
  const listenAt = loudestAirAt(row.windows);
  const where = listenAt != null ? ` · ${formatClock(listenAt)} 부근부터 들어 보세요` : '';
  const out: SegmentSignal[] = [];
  if (air >= AIR_HIGH) {
    out.push({
      level: 'high',
      label: '고역 과다',
      detail: `16kHz 이상 고음 비율이 높아요(상위 10%). 과거 이런 곡의 75%가 음질로 거절됐어요${where}`,
      listenAt,
    });
  } else if (air >= AIR_MID) {
    out.push({
      level: 'mid',
      label: '고역 많음',
      detail: `16kHz 이상 고음 비율이 다소 높아요. 과거 이런 곡의 64%가 음질로 거절됐어요${where}`,
      listenAt,
    });
  }
  if (lateRise > LATE_AIR_RISE) {
    out.push({
      level: 'mid',
      label: '후반 고역 증가',
      detail: `뒷부분으로 갈수록 고음 잡음이 늘어요. 과거 이런 곡의 59%가 음질로 거절됐어요${where}`,
      listenAt,
    });
  }
  return out;
}

export async function fetchSegmentQc(trackIds: string[]): Promise<Map<string, SegmentQcRow>> {
  const map = new Map<string, SegmentQcRow>();
  if (trackIds.length === 0) return map;
  const { data, error } = await supabase.rpc('admin_get_segment_qc', { p_track_ids: trackIds });
  if (error) throw error;
  for (const r of (data ?? []) as SegmentQcRow[]) map.set(r.track_id, r);
  return map;
}
