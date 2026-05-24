/// <reference lib="webworker" />
/**
 * audioAnalysisWorker.ts — 무거운 framewise FFT/피처 추출을 메인 스레드 밖에서 실행.
 * 메인 스레드는 decodeAudioData 후 PCM(Float32Array)만 transfer 한다.
 * (플레이어/업로드/검수 UI 블로킹 방지)
 */
import { computeFeaturesFromPCM } from './audioFeatures';

self.onmessage = (e: MessageEvent<{ pcm: Float32Array; sampleRate: number }>) => {
  try {
    const { pcm, sampleRate } = e.data;
    const features = computeFeaturesFromPCM(pcm, sampleRate);
    (self as unknown as Worker).postMessage({ ok: true, features });
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
