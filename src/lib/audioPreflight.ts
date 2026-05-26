/**
 * audioPreflight.ts — 업로드 시작 전 사전 검사 (decode/ffmpeg 위험 파일 조기 경고).
 *
 * 전략: 전체 decode 는 비싸므로(30곡 동시 위험) 헤더만 cheap 하게 파싱한다.
 *  - MP3: ID3v2 skip 후 첫 프레임 헤더로 codec/sampleRate/channels/bitrate 추출.
 *  - WAV: RIFF/fmt 청크로 format/sampleRate/channels/bitsPerSample 추출.
 *  - 그 외(flac/m4a/aiff…): 컨테이너만 식별 → 변환 대상.
 *
 * MP3 safe pass-through 판정(재인코딩 생략 가능):
 *   codec=mp3 && sampleRate∈{44100,48000} && channels=2(stereo) && bitrate 128~320kbps.
 *   (decode 성공 / LUFS 분석 가능 여부는 이후 품질 게이트 단계에서 최종 확인.)
 */

export interface AudioSniff {
  container: 'mp3' | 'wav' | 'flac' | 'm4a' | 'aiff' | 'ogg' | 'unknown';
  codec: string | null;
  sampleRate: number | null;
  channels: number | null;
  bitrateKbps: number | null;
  bitsPerSample: number | null;
  /** 확장자와 실제 컨테이너가 다른 경우 */
  extensionMismatch: boolean;
}

export interface PreflightResult {
  level: 'ok' | 'warn' | 'risk';
  /** 재인코딩 없이 그대로 업로드 가능한 정상 MP3 */
  mp3PassThrough: boolean;
  /** 변환(ffmpeg)이 필요한 파일 */
  needsTranscode: boolean;
  reasons: string[];
  sniff: AudioSniff;
}

const MP3_BITRATE_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const MP3_BITRATE_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const MP3_SR_V1 = [44100, 48000, 32000, 0];
const MP3_SR_V2 = [22050, 24000, 16000, 0];
const MP3_SR_V25 = [11025, 12000, 8000, 0];

function parseMp3Header(bytes: Uint8Array): Partial<AudioSniff> | null {
  let offset = 0;
  // ID3v2 skip
  if (bytes.length > 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
    offset = 10 + size;
  }
  // frame sync 검색 (0xFFEx)
  for (let i = offset; i < Math.min(bytes.length - 4, offset + 200_000); i++) {
    if (bytes[i] !== 0xff || (bytes[i + 1] & 0xe0) !== 0xe0) continue;
    const b1 = bytes[i + 1], b2 = bytes[i + 2], b3 = bytes[i + 3];
    const verBits = (b1 >> 3) & 0x03; // 00=2.5, 10=2, 11=1
    const layerBits = (b1 >> 1) & 0x03; // 01=III
    if (verBits === 1 || layerBits === 0) continue; // reserved
    const brIndex = (b2 >> 4) & 0x0f;
    const srIndex = (b2 >> 2) & 0x03;
    if (brIndex === 0 || brIndex === 0x0f || srIndex === 3) continue;
    const chMode = (b3 >> 6) & 0x03; // 00 stereo,01 joint,10 dual,11 mono
    const isV1 = verBits === 3;
    const bitrate = (isV1 ? MP3_BITRATE_V1_L3 : MP3_BITRATE_V2_L3)[brIndex];
    const sr = (verBits === 3 ? MP3_SR_V1 : verBits === 2 ? MP3_SR_V2 : MP3_SR_V25)[srIndex];
    if (!bitrate || !sr) continue;
    return { container: 'mp3', codec: 'mp3', sampleRate: sr, channels: chMode === 3 ? 1 : 2, bitrateKbps: bitrate };
  }
  return null;
}

function parseWavHeader(bytes: Uint8Array): Partial<AudioSniff> | null {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 44) return null;
  // 'RIFF' .... 'WAVE'
  if (!(bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46)) return null;
  if (!(bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45)) return null;
  let pos = 12;
  while (pos + 8 <= bytes.length) {
    const id = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
    const size = dv.getUint32(pos + 4, true);
    if (id === 'fmt ') {
      const fmt = dv.getUint16(pos + 8, true);
      const channels = dv.getUint16(pos + 10, true);
      const sampleRate = dv.getUint32(pos + 12, true);
      const bits = dv.getUint16(pos + 22, true);
      const codec = fmt === 1 ? 'pcm' : fmt === 3 ? 'pcm_float' : fmt === 0xfffe ? 'pcm_ext' : `wav_${fmt}`;
      return { container: 'wav', codec, sampleRate, channels, bitsPerSample: bits };
    }
    pos += 8 + size + (size % 2);
  }
  return { container: 'wav', codec: 'pcm' };
}

function detectContainer(bytes: Uint8Array, ext: string): AudioSniff['container'] {
  if (bytes.length >= 12) {
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
        && bytes[8] === 0x57 && bytes[9] === 0x41) return 'wav';
    if (bytes[0] === 0x66 && bytes[1] === 0x4c && bytes[2] === 0x61 && bytes[3] === 0x43) return 'flac'; // fLaC
    if (bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) return 'ogg'; // OggS
    if (bytes[0] === 0x46 && bytes[1] === 0x4f && bytes[2] === 0x52 && bytes[3] === 0x4d) return 'aiff'; // FORM
    if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return 'm4a'; // ....ftyp
    if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return 'mp3'; // ID3
    if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'mp3'; // raw frame sync
  }
  // fallback: 확장자
  if (ext === 'mp3' || ext === 'wav' || ext === 'flac' || ext === 'm4a' || ext === 'aiff') return ext as AudioSniff['container'];
  return 'unknown';
}

export async function sniffAudio(file: File): Promise<AudioSniff> {
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  const headSize = Math.min(file.size, 512 * 1024); // 512KB 면 ID3 + 첫 프레임 충분
  const buf = new Uint8Array(await file.slice(0, headSize).arrayBuffer());
  const container = detectContainer(buf, ext);

  const base: AudioSniff = {
    container, codec: null, sampleRate: null, channels: null, bitrateKbps: null, bitsPerSample: null,
    extensionMismatch: container !== 'unknown' && ext !== '' && container !== (ext === 'm4a' ? 'm4a' : ext),
  };

  if (container === 'mp3') {
    const m = parseMp3Header(buf);
    if (m) return { ...base, ...m };
  } else if (container === 'wav') {
    const w = parseWavHeader(buf);
    if (w) return { ...base, ...w };
  }
  return base;
}

export async function preflightAudio(file: File): Promise<PreflightResult> {
  const sniff = await sniffAudio(file);
  const reasons: string[] = [];
  let level: PreflightResult['level'] = 'ok';

  if (sniff.container === 'unknown') {
    level = 'risk';
    reasons.push('오디오 형식을 인식하지 못했어요. 손상되었거나 지원하지 않는 파일일 수 있어요.');
  }
  if (sniff.extensionMismatch) {
    level = level === 'risk' ? 'risk' : 'warn';
    reasons.push(`확장자(.${(file.name.split('.').pop() ?? '').toLowerCase()})와 실제 형식(${sniff.container})이 달라요.`);
  }

  // MP3 safe pass-through 판정
  const isMp3 = sniff.container === 'mp3';
  const mp3PassThrough =
    isMp3 &&
    (sniff.sampleRate === 44100 || sniff.sampleRate === 48000) &&
    sniff.channels === 2 &&
    sniff.bitrateKbps != null && sniff.bitrateKbps >= 128 && sniff.bitrateKbps <= 320;

  if (isMp3 && !mp3PassThrough) {
    reasons.push('표준 사양(44.1/48kHz · 스테레오 · 128~320kbps)이 아니어서 업로드 시 표준 MP3로 변환돼요.');
  }
  if (sniff.container === 'wav' && (sniff.codec === 'pcm_float' || (sniff.bitsPerSample ?? 0) > 16)) {
    reasons.push('고해상도/float WAV는 iOS 재생 호환을 위해 표준 MP3로 변환돼요.');
  }

  // mp3 pass-through 이면 변환 불필요, 그 외(인식된 오디오)는 변환 필요
  const needsTranscode = !mp3PassThrough && sniff.container !== 'unknown';

  return { level, mp3PassThrough, needsTranscode, reasons, sniff };
}
