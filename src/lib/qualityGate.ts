/**
 * qualityGate.ts — 업로드 Loudness 품질 게이트 (등록 이전 차단).
 *
 * 정책: 통과 음원만 storage 업로드 + tracks insert 허용. 자동 normalize/gain 금지.
 * 측정: 브라우저 decode → WebWorker(EBU R128) → 기준 검사. ffmpeg.wasm 미사용(iOS 안정성).
 * 실패/timeout 은 graceful — 업로드 전체를 죽이지 않고 해당 곡만 실패 처리.
 */
import { supabase } from '@/lib/supabase';
import type { LoudnessResult } from '@/lib/loudness';

export type QualityGrade = 'pass' | 'warning' | 'reject';

export interface QualityThresholds {
  enabled: boolean;
  lufs_min: number;
  lufs_max: number;
  true_peak_max: number;
  /** WARNING ~ REJECT 경계 TP (이 값 초과 = REJECT) */
  true_peak_reject_max: number;
  block_on_clipping: boolean;
}

const DEFAULT_THRESHOLDS: QualityThresholds = {
  enabled: true,
  lufs_min: -14, lufs_max: -9,
  true_peak_max: 0.0, true_peak_reject_max: 0.3,
  block_on_clipping: true,
};

const ANALYZE_TIMEOUT_MS = 60_000;

export interface QualityResult extends LoudnessResult {
  bitrate_kbps: number | null;
  grade: QualityGrade;
  /** grade === 'pass' || 'warning' (업로드 허용). */
  passed: boolean;
  /** 첫 사유 (호환용). */
  failure_reason: string | null; // 'low_loudness' | 'high_loudness' | 'true_peak' | 'true_peak_reject' | 'clipping' | 'analysis_failed'
  /** 경고/거부 사유 전체. */
  reasons: string[];
  message: string | null;
}

export async function fetchQualityThresholds(): Promise<QualityThresholds> {
  try {
    const { data, error } = await supabase.rpc('get_audio_quality_config');
    if (error || !data) return DEFAULT_THRESHOLDS;
    const d = data as Partial<QualityThresholds>;
    return { ...DEFAULT_THRESHOLDS, ...d };
  } catch {
    return DEFAULT_THRESHOLDS;
  }
}

/** 3단계 정책 검사 — 측정값을 기준과 비교해 pass/warning/reject 결정.
 *  X6.61 fix — 서버 (compute_quality_grade) 와 정책 sync:
 *    서버: LUFS 가 [lufs_min, lufs_max] 밖이면 reject.
 *    클라이언트: 이전엔 warning 처리 → 업로드 통과 → 서버 reject 저장 → "마스터링 안된 음원 유통 성공"
 *  - REJECT: analysis_failed / clipping(설정 시) / TP > true_peak_reject_max /
 *            LUFS [lufs_min..lufs_max] 밖 (서버 정책)
 *  - PASS:   LUFS lufs_min..lufs_max AND TP <= true_peak_max
 *  - WARNING: PASS 밴드 안인데 TP 가 true_peak_max~true_peak_reject_max 사이
 */
export function evaluateQuality(r: LoudnessResult, th: QualityThresholds): { grade: QualityGrade; reasons: string[] } {
  if (r.integrated_lufs == null) return { grade: 'reject', reasons: ['analysis_failed'] };
  if (th.block_on_clipping && r.clipping_detected) return { grade: 'reject', reasons: ['clipping'] };
  if (r.true_peak_dbtp != null && r.true_peak_dbtp > th.true_peak_reject_max) return { grade: 'reject', reasons: ['true_peak_reject'] };
  // X6.61 — LUFS 범위 밖은 REJECT (서버와 동일 정책)
  if (r.integrated_lufs < th.lufs_min) return { grade: 'reject', reasons: ['low_loudness'] };
  if (r.integrated_lufs > th.lufs_max) return { grade: 'reject', reasons: ['high_loudness'] };

  const reasons: string[] = [];
  if (r.true_peak_dbtp != null && r.true_peak_dbtp > th.true_peak_max) reasons.push('true_peak');

  return reasons.length === 0 ? { grade: 'pass', reasons: [] } : { grade: 'warning', reasons };
}

/** 결과 → 사용자 안내 메시지. grade 별 톤 분리(pass/warning/reject). */
export function buildQualityMessage(r: QualityResult, th: QualityThresholds): string {
  if (r.grade === 'pass') return '음질 검사를 통과했어요.';

  if (r.failure_reason === 'analysis_failed') {
    return (
      '음원 분석에 실패했습니다.\n\n' +
      '파일이 손상되었거나 지원하지 않는 형식일 수 있습니다.\n' +
      '확인 후 다시 업로드해주세요.'
    );
  }

  const lufs = r.integrated_lufs != null ? `${r.integrated_lufs} LUFS` : '측정 실패';
  const tp = r.true_peak_dbtp != null ? `${r.true_peak_dbtp} dBTP` : '측정 실패';
  const lines = [`• Integrated LUFS: ${lufs}`, `• True Peak: ${tp}`];
  if (r.loudness_range != null) lines.push(`• Loudness Range: ${r.loudness_range} LU`);

  if (r.grade === 'warning') {
    return (
      '음원 볼륨이 권장 범위를 벗어났지만 업로드는 가능합니다.\n\n' +
      '현재 측정값\n' +
      lines.join('\n') +
      '\n\n' +
      `권장: ${th.lufs_min} ~ ${th.lufs_max} LUFS · True Peak ≤ ${th.true_peak_max} dBTP\n` +
      '매장 환경에서 다른 곡과 볼륨 편차가 있을 수 있습니다.'
    );
  }

  // reject (clipping / TP > reject_max)
  const why = r.failure_reason === 'clipping'
    ? '디지털 클리핑이 감지되었습니다.'
    : `True Peak 이 안전 한계(+${th.true_peak_reject_max} dBTP)를 초과했습니다.`;
  return (
    '심각한 왜곡 위험으로 등록할 수 없습니다.\n\n' +
    why + '\n\n' +
    '현재 측정값\n' +
    lines.join('\n') +
    '\n\n' +
    '매장 스피커 환경에서 왜곡/잡음이 발생할 수 있어\n' +
    '리미터/리마스터링 후 다시 업로드해주세요.'
  );
}

/**
 * 파일을 디코드 → WebWorker 로 EBU R128 측정 → 정책 검사.
 * 실패/timeout/decode 오류는 throw 하지 않고 passed=false(analysis_failed) 로 반환(업로드 전체 보호).
 */
export async function analyzeAudioQuality(file: File, th: QualityThresholds): Promise<QualityResult> {
  const fail = (reason: string): QualityResult => ({
    integrated_lufs: null, true_peak_dbtp: null, sample_peak_dbfs: null, loudness_range: null,
    clipping_detected: false, clip_sample_count: 0, channels: 0, sample_rate: 0, analyzer_version: 'ebur128-js-v1',
    bitrate_kbps: null, grade: 'reject', passed: false, failure_reason: reason, reasons: [reason], message: null,
  });

  const Ctx =
    typeof window !== 'undefined'
      ? window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      : undefined;
  if (!Ctx) return { ...fail('analysis_failed'), message: '이 브라우저는 음질 분석을 지원하지 않습니다.' };

  let audio: AudioBuffer;
  const ctx = new Ctx();
  try {
    const buf = await file.arrayBuffer();
    audio = await ctx.decodeAudioData(buf.slice(0));
  } catch {
    void ctx.close();
    const r = fail('analysis_failed');
    return { ...r, message: buildQualityMessage(r, th) };
  } finally {
    void ctx.close();
  }

  const sr = audio.sampleRate;
  const nCh = Math.min(2, audio.numberOfChannels);
  const channels: Float32Array[] = [];
  for (let c = 0; c < nCh; c++) channels.push(audio.getChannelData(c).slice());
  const bitrate = audio.duration > 0 ? Math.round((file.size * 8) / audio.duration / 1000) : null;

  const worker = new Worker(new URL('./loudnessWorker.ts', import.meta.url), { type: 'module' });
  try {
    const result = await new Promise<LoudnessResult>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('timeout')), ANALYZE_TIMEOUT_MS);
      worker.onmessage = (ev: MessageEvent<{ ok: boolean; result?: LoudnessResult; error?: string }>) => {
        window.clearTimeout(timer);
        if (ev.data.ok && ev.data.result) resolve(ev.data.result);
        else reject(new Error(ev.data.error || 'loudness fail'));
      };
      worker.onerror = (err) => { window.clearTimeout(timer); reject(new Error(err.message)); };
      worker.postMessage({ channels, sampleRate: sr }, channels.map((c) => c.buffer));
    });
    const ev = evaluateQuality(result, th);
    const out: QualityResult = {
      ...result, bitrate_kbps: bitrate,
      grade: ev.grade, passed: ev.grade !== 'reject',
      failure_reason: ev.reasons[0] ?? null, reasons: ev.reasons, message: null,
    };
    out.message = buildQualityMessage(out, th);
    return out;
  } catch {
    const r = { ...fail('analysis_failed'), bitrate_kbps: bitrate, sample_rate: sr, channels: nCh };
    return { ...r, message: buildQualityMessage(r, th) };
  } finally {
    worker.terminate();
  }
}

/** 측정 결과를 서버에 로그 (통과/실패 모두). best-effort. */
export async function recordAudioQuality(input: {
  trackId?: string | null;
  uploadSessionId?: string | null;
  originalFilename?: string | null;
  result: QualityResult;
}): Promise<void> {
  const r = input.result;
  try {
    await supabase.rpc('record_audio_quality', {
      p_track_id: input.trackId ?? null,
      p_upload_session_id: input.uploadSessionId ?? null,
      p_original_filename: input.originalFilename ?? null,
      p_integrated_lufs: r.integrated_lufs,
      p_true_peak: r.true_peak_dbtp,
      p_loudness_range: r.loudness_range,
      p_clipping: r.clipping_detected,
      p_sample_rate: r.sample_rate || null,
      p_channels: r.channels || null,
      p_bitrate_kbps: r.bitrate_kbps,
      p_passed: r.passed,
      p_failure_reason: r.failure_reason,
      p_analyzer_version: r.analyzer_version,
    });
  } catch {
    /* best-effort log */
  }
}

export interface AudioQualityRow {
  id: string; track_id: string | null; original_filename: string | null;
  integrated_lufs: number | null; true_peak: number | null; loudness_range: number | null;
  clipping_detected: boolean; sample_rate: number | null; channels: number | null; bitrate_kbps: number | null;
  passed_quality_check: boolean; failure_reason: string | null; analyzed_at: string;
  title: string | null; artist: string | null;
  quality_grade: QualityGrade | null;
}
export async function listAudioQuality(filter = 'failed', limit = 200): Promise<AudioQualityRow[]> {
  const { data, error } = await supabase.rpc('admin_list_audio_quality', { p_filter: filter, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as AudioQualityRow[];
}
