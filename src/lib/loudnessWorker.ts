/// <reference lib="webworker" />
/**
 * loudnessWorker.ts — EBU R128 라우드니스 측정을 메인 스레드 밖에서 실행.
 * 대용량 WAV 분석 시 UI freeze 방지. 메인 스레드는 decode 후 채널 PCM 만 transfer.
 */
import { computeLoudness } from './loudness';

self.onmessage = (e: MessageEvent<{ channels: Float32Array[]; sampleRate: number }>) => {
  try {
    const { channels, sampleRate } = e.data;
    const result = computeLoudness(channels, sampleRate);
    (self as unknown as Worker).postMessage({ ok: true, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
