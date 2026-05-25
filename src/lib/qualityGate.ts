/**
 * qualityGate.ts — 업로드 Loudness 품질 게이트 (등록 이전 차단).
 *
 * 정책: 통과 음원만 storage 업로드 + tracks insert 허용. 자동 normalize/gain 금지.
 * 측정: 브라우저 decode → WebWorker(EBU R128) → 기준 검사. ffmpeg.wasm 미사용(iOS 안정성).
 * 실패/timeout 은 graceful — 업로드 전체를 죽이지 않고 해당 곡만 실패 처리.
 */
import { supabase } from '@/lib/supabase';
import type { LoudnessResult } from '@/lib/loudness';

export interface QualityThresholds {
  enabled: boolean;
  lufs_min: number;
  lufs_max: number;
  true_peak_max: number;
  block_on_clipping: boolean;
}

const DEFAULT_THRESHOLDS: QualityThresholds = {
  enabled: true, lufs_min: -14, lufs_max: -10, true_peak_max: -1.0, block_on_clipping: true,
};

const ANALYZE_TIMEOUT_MS = 60_000;

export interface QualityResult extends LoudnessResult {
  bitrate_kbps: number | null;
  passed: boolean;
  failure_reason: string | null; // 'low_loudness' | 'high_loudness' | 'true_peak' | 'clipping' | 'analysis_failed'
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

/** 정책 검사 — 측정값을 기준과 비교해 통과/실패 + 사유 결정. */
export function evaluateQuality(r: LoudnessResult, th: QualityThresholds): { passed: boolean; reason: string | null } {
  if (r.integrated_lufs == null) return { passed: false, reason: 'analysis_failed' };
  if (th.block_on_clipping && r.clipping_detected) return { passed: false, reason: 'clipping' };
  if (r.true_peak_dbtp != null && r.true_peak_dbtp > th.true_peak_max) return { passed: false, reason: 'true_peak' };
  if (r.integrated_lufs < th.lufs_min) return { passed: false, reason: 'low_loudness' };
  if (r.integrated_lufs > th.lufs_max) return { passed: false, reason: 'high_loudness' };
  return { passed: true, reason: null };
}

/** 실패 사유 → 사용자 안내 메시지 (측정값 포함). */
export function buildQualityMessage(r: QualityResult, th: QualityThresholds): string {
  if (r.passed) return '음질 검사를 통과했어요.';
  const lufs = r.integrated_lufs != null ? `${r.integrated_lufs} LUFS` : '측정불가';
  const tp = r.true_peak_dbtp != null ? `${r.true_peak_dbtp} dBTP` : '측정불가';
  if (r.failure_reason === 'analysis_failed') {
    return '음원 분석에 실패했어요. 파일이 손상되지 않았는지 확인 후 다시 시도해주세요.';
  }
  if (r.failure_reason === 'clipping') {
    return `음원에 클리핑(왜곡)이 감지됐어요. (True Peak ${tp})\n매장 재생 품질을 위해 클리핑 없는 음원만 등록 가능합니다.\n권장: Louver Mastering AI 로 마스터링 후 다시 업로드해주세요.`;
  }
  return (
    `음원 볼륨이 플랫폼 기준에 부합하지 않습니다.\n\n` +
    `현재 측정값:\n· Integrated LUFS: ${lufs}\n· True Peak: ${tp}` +
    (r.loudness_range != null ? `\n· Loudness Range: ${r.loudness_range} LU` : '') +
    `\n\n듣다는 매장 내 일관된 청취 경험을 위해 ${th.lufs_min} ~ ${th.lufs_max} LUFS · True Peak ≤ ${th.true_peak_max} dBTP 음원만 등록 가능합니다.\n` +
    `권장: Louver Mastering AI 로 마스터링 후 다시 업로드해주세요.`
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
    bitrate_kbps: null, passed: false, failure_reason: reason, message: null,
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
    const eval_ = evaluateQuality(result, th);
    const out: QualityResult = { ...result, bitrate_kbps: bitrate, passed: eval_.passed, failure_reason: eval_.reason, message: null };
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
}
export async function listAudioQuality(filter = 'failed', limit = 200): Promise<AudioQualityRow[]> {
  const { data, error } = await supabase.rpc('admin_list_audio_quality', { p_filter: filter, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as AudioQualityRow[];
}
