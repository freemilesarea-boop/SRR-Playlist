import { useMemo, useState } from 'react';
import { Upload, X, ChevronDown } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/store/toastStore';
import {
  MAIN_GENRES,
  SUB_GENRES_BY_MAIN,
  LYRIC_TYPES,
  LANGUAGES,
  MOOD_TAGS,
  MOOD_TAG_LABELS,
  SITUATION_TAGS,
  SITUATION_TAG_LABELS,
  TIME_SLOT_TAGS,
  TIME_SLOT_TAG_LABELS,
  SEASON_TAGS,
  SEASON_TAG_LABELS,
  BUSINESS_TAGS,
  BUSINESS_TAG_LABELS,
  VISIBILITY_OPTIONS,
  COPYRIGHT_OPTIONS,
} from '@/lib/recommendationTaxonomy';

interface Props {
  onUploaded: () => Promise<void> | void;
  onCancel: () => void;
}

const ALLOWED_AUDIO_EXT = ['mp3', 'm4a', 'wav', 'ogg', 'aac', 'flac'];
const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
const MAX_COVER_BYTES = 5 * 1024 * 1024;

/**
 * 확장자 → 정규 audio MIME 매핑.
 * 브라우저가 file.type 을 비워두거나 'application/octet-stream' 으로 채우는
 * 경우 Supabase Storage 의 Content-Type 도 잘못 저장되어 재생이 거부됨.
 * 업로드 시 항상 이 함수로 강제 지정.
 */
const AUDIO_MIME_MAP: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  opus: 'audio/opus',
  webm: 'audio/webm',
};

function audioContentType(filename: string, fallback?: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (AUDIO_MIME_MAP[ext]) return AUDIO_MIME_MAP[ext];
  if (fallback && fallback.startsWith('audio/')) return fallback;
  return 'application/octet-stream';
}

/** 업로드 직후 public URL 접근성 검증 (HEAD) */
async function verifyPublicUrl(
  url: string,
): Promise<{ ok: boolean; status?: number; contentType?: string; error?: string }> {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return {
      ok: res.ok,
      status: res.status,
      contentType: res.headers.get('content-type') ?? undefined,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'fetch failed' };
  }
}

function isAudioFile(file: File): boolean {
  if (file.type && file.type.startsWith('audio/')) return true;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return ALLOWED_AUDIO_EXT.includes(ext);
}

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

export default function TrackUploader({ onUploaded, onCancel }: Props) {
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [genre, setGenre] = useState('');
  const [mood, setMood] = useState('');
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string>('');
  const [advancedOpen, setAdvancedOpen] = useState(true);

  // 메타데이터 (확장)
  const [mainGenre, setMainGenre] = useState<string>('');
  const [subGenre, setSubGenre] = useState<string>('');
  const [language, setLanguage] = useState<string>('');
  const [lyricType, setLyricType] = useState<string>('');
  const [bpm, setBpm] = useState<string>('');
  const [energy, setEnergy] = useState<number>(3);
  const [brightness, setBrightness] = useState<number>(3);
  const [emotional, setEmotional] = useState<number>(3);
  const [vocal, setVocal] = useState<number>(3);
  const [moodTags, setMoodTags] = useState<string[]>([]);
  const [situationTags, setSituationTags] = useState<string[]>([]);
  const [timeSlots, setTimeSlots] = useState<string[]>([]);
  const [seasonTags, setSeasonTags] = useState<string[]>([]);
  const [businessTags, setBusinessTags] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<string>('public');
  const [recPriority, setRecPriority] = useState<string>('0');
  const [copyrightStatus, setCopyrightStatus] = useState<string>('unknown');
  const [isRecommendable, setIsRecommendable] = useState<boolean>(true);

  const subGenres = useMemo(
    () => (mainGenre ? SUB_GENRES_BY_MAIN[mainGenre] ?? [] : []),
    [mainGenre],
  );

  function toggle(arr: string[], v: string): string[] {
    return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
  }

  function pickAudio(file: File | null) {
    if (!file) { setAudioFile(null); return; }
    if (!isAudioFile(file)) { toast.error('음원 파일만 업로드할 수 있어요.'); return; }
    if (file.size > MAX_AUDIO_BYTES) {
      toast.error(`파일이 너무 커요. 100MB 이하로 (현재 ${Math.round(file.size / 1024 / 1024)}MB)`);
      return;
    }
    setAudioFile(file);
  }
  function pickCover(file: File | null) {
    if (!file) { setCoverFile(null); return; }
    if (!isImageFile(file)) { toast.error('이미지 파일만 업로드할 수 있어요.'); return; }
    if (file.size > MAX_COVER_BYTES) { toast.error('커버는 5MB 이하 이미지만 가능해요.'); return; }
    setCoverFile(file);
  }

  async function uploadToBucket(bucket: 'audio' | 'covers', file: File): Promise<string> {
    const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase();
    const path = `${crypto.randomUUID()}.${ext}`;
    // contentType 강제 — mp3 가 'application/octet-stream' 으로 저장되면 재생 X
    const contentType =
      bucket === 'audio'
        ? audioContentType(file.name, file.type)
        : file.type || undefined;

    if (import.meta.env.DEV) {
      console.debug('[upload] start', {
        bucket,
        path,
        fileType: file.type,
        forcedContentType: contentType,
        size: file.size,
      });
    }

    const { error } = await supabase.storage.from(bucket).upload(path, file, {
      cacheControl: '31536000',
      upsert: false,
      contentType,
    });
    if (error) throw new Error(`스토리지 업로드 실패 (${bucket}): ${error.message}`);
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    if (!data?.publicUrl) throw new Error('Storage public URL 생성 실패');
    const publicUrl = data.publicUrl;

    // public URL 패턴 검증 — signed/token URL 금지
    if (publicUrl.includes('/object/sign/') || /[?&]token=/.test(publicUrl)) {
      throw new Error(
        `잘못된 URL 형식 (signed URL). 버킷이 public 인지 확인하세요: ${publicUrl}`,
      );
    }
    if (!publicUrl.includes('/object/public/')) {
      throw new Error(
        `public URL 패턴이 아님. 버킷 '${bucket}' 의 public 설정을 확인하세요: ${publicUrl}`,
      );
    }

    // HEAD 검증 — 실제로 200 이 떨어지는지
    const verify = await verifyPublicUrl(publicUrl);
    if (import.meta.env.DEV) {
      console.debug('[upload] verify', { url: publicUrl, ...verify });
    }
    if (!verify.ok) {
      // 업로드된 객체 정리 (best-effort)
      try {
        await supabase.storage.from(bucket).remove([path]);
      } catch {
        /* noop */
      }
      throw new Error(
        `업로드 후 URL 접근 불가 (status=${verify.status ?? 'network error'}). ` +
          `버킷 '${bucket}' 이 public 인지, Storage RLS 가 SELECT 를 허용하는지 확인하세요.`,
      );
    }
    if (bucket === 'audio' && verify.contentType && !verify.contentType.startsWith('audio/')) {
      console.warn(
        `[upload] content-type 이 audio/* 가 아님 (${verify.contentType}). ` +
          '브라우저가 재생을 거부할 수 있어요.',
      );
    }

    return publicUrl;
  }

  async function detectDuration(file: File): Promise<number | null> {
    return new Promise((resolve) => {
      const audio = document.createElement('audio');
      audio.preload = 'metadata';
      const url = URL.createObjectURL(file);
      const cleanup = () => URL.revokeObjectURL(url);
      audio.onloadedmetadata = () => {
        resolve(Number.isFinite(audio.duration) ? Math.round(audio.duration) : null);
        cleanup();
      };
      audio.onerror = () => { cleanup(); resolve(null); };
      audio.src = url;
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!audioFile) { toast.error('음원 파일을 선택해주세요.'); return; }
    if (!title.trim()) { toast.error('곡 제목을 입력해주세요.'); return; }
    setBusy(true);
    try {
      // ============ 1) 원본 파일 decode smoke test ============
      setProgress('오디오 분석 중…');
      const { validateAudioFile, validateAudioUrl } = await import('@/lib/audioValidation');
      const origCheck = await validateAudioFile(audioFile);
      if (import.meta.env.DEV) {
        console.debug('[upload] origCheck', origCheck);
      }

      // ============ 2) 변환 필요 여부 결정 ============
      // - 원본 decode 실패 → 무조건 transcode
      // - mp3 라도 안전성을 위해 wav/m4a/aac/flac/ogg 는 무조건 transcode
      // - mp3 이고 decode OK 이면 그대로 사용
      const ext = (audioFile.name.split('.').pop() ?? '').toLowerCase();
      const isAlreadyMp3 = ext === 'mp3';
      const needsTranscode = !origCheck.ok || !isAlreadyMp3;

      let uploadFile: File = audioFile;
      let detectedDuration: number | null = origCheck.duration ?? null;

      if (needsTranscode) {
        try {
          setProgress('MP3로 변환 중… (라이브러리 로드)');
          const { transcodeToStandardMp3 } = await import('@/lib/audioTranscode');
          const std = await transcodeToStandardMp3(audioFile, {
            onProgress: (r) => setProgress(`MP3로 변환 중… ${Math.round(r * 100)}%`),
            onLog: (m) => {
              if (import.meta.env.DEV) console.debug('[ffmpeg]', m);
            },
          });
          uploadFile = std;
          // 변환된 파일 재검증
          setProgress('변환 결과 검증 중…');
          const stdCheck = await validateAudioFile(std);
          if (import.meta.env.DEV) console.debug('[upload] transcodedCheck', stdCheck);
          if (!stdCheck.ok) {
            throw new Error(
              `변환된 mp3 의 디코드 검증 실패: ${stdCheck.error ?? 'unknown'}`,
            );
          }
          detectedDuration = stdCheck.duration ?? detectedDuration;
        } catch (e) {
          throw new Error(
            `브라우저에서 이 오디오를 변환하지 못했습니다 (${e instanceof Error ? e.message : 'unknown'}). ` +
              'WAV 또는 표준 MP3 파일로 다시 시도해주세요.',
          );
        }
      } else if (detectedDuration == null) {
        // 정상 mp3 인데 duration 미감지 → 한 번 더 시도
        const d = await detectDuration(audioFile);
        detectedDuration = d;
      }

      // ============ 3) Storage 업로드 ============
      setProgress('업로드 중…');
      const audioUrl = await uploadToBucket('audio', uploadFile);

      // ============ 4) 공개 URL 실제 재생 검증 ============
      setProgress('재생 검증 중…');
      const urlCheck = await validateAudioUrl(audioUrl);
      if (import.meta.env.DEV) console.debug('[upload] urlCheck', urlCheck);
      if (!urlCheck.ok) {
        throw new Error(
          `업로드된 파일을 브라우저가 재생하지 못했어요 (${urlCheck.error ?? 'unknown'}). ` +
            `Content-Type=${urlCheck.contentType ?? '?'}, status=${urlCheck.status ?? '?'}`,
        );
      }

      // ============ 5) 커버 업로드 (옵션) ============
      let coverUrl: string | null = null;
      if (coverFile) {
        setProgress('커버 업로드 중…');
        coverUrl = await uploadToBucket('covers', coverFile);
      }

      setProgress('저장 중…');
      // detectDuration 으로 한 번 더 보강
      const duration = detectedDuration ?? (await detectDuration(uploadFile));
      const insertPayload: Record<string, unknown> = {
        title: title.trim(),
        artist: artist.trim() || null,
        genre: genre.trim() || mainGenre || null,
        mood: mood.trim() || moodTags[0] || null,
        audio_url: audioUrl,
        cover_url: coverUrl,
        duration,
        main_genre: mainGenre || null,
        sub_genre: subGenre || null,
        language: language || null,
        lyric_type: lyricType || null,
        bpm: bpm ? Number(bpm) : null,
        energy_level: energy,
        brightness_level: brightness,
        emotional_intensity: emotional,
        vocal_presence: vocal,
        mood_tags: moodTags,
        situation_tags: situationTags,
        time_slots: timeSlots,
        season_tags: seasonTags,
        business_tags: businessTags,
        visibility,
        recommendation_priority: Number(recPriority) || 0,
        copyright_status: copyrightStatus,
        is_recommendable: isRecommendable,
      };
      const { error } = await supabase.from('tracks').insert(insertPayload);
      if (error) throw new Error(`DB 저장 실패: ${error.message}`);
      toast.success(`업로드 완료: ${title}`);
      await onUploaded();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setProgress('');
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-2xl bg-bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">트랙 업로드</h3>
        <button type="button" onClick={onCancel} aria-label="닫기"><X size={16} /></button>
      </div>

      <input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="곡 제목 *" className="input" />
      <div className="grid grid-cols-2 gap-2">
        <input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="아티스트" className="input" />
        <input value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="장르 (free text, 자동: main_genre)" className="input" />
      </div>
      <input value={mood} onChange={(e) => setMood(e.target.value)} placeholder="무드 (단일, 자동: 첫 mood_tag)" className="input" />

      <label className="block space-y-1">
        <span className="text-xs text-ink-mute">음원 파일 * (mp3 / m4a / wav, ≤ 100MB)</span>
        <input required type="file" accept="audio/*,.mp3,.m4a,.wav,.ogg,.aac,.flac"
          onChange={(e) => pickAudio(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-ink file:mr-3 file:rounded-full file:border-0 file:bg-bg-hover file:px-3 file:py-1.5 file:text-xs file:text-ink hover:file:bg-ink/10" />
        {audioFile && <span className="text-[11px] text-ink-dim">{audioFile.name} · {(audioFile.size / 1024 / 1024).toFixed(1)}MB</span>}
      </label>

      <label className="block space-y-1">
        <span className="text-xs text-ink-mute">커버 이미지 (선택, ≤ 5MB)</span>
        <input type="file" accept="image/*"
          onChange={(e) => pickCover(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-ink file:mr-3 file:rounded-full file:border-0 file:bg-bg-hover file:px-3 file:py-1.5 file:text-xs file:text-ink hover:file:bg-ink/10" />
        {coverFile && <span className="text-[11px] text-ink-dim">{coverFile.name} · {(coverFile.size / 1024).toFixed(0)}KB</span>}
      </label>

      {/* 메타데이터 (collapsible) */}
      <details open={advancedOpen} onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)} className="rounded-xl bg-bg-soft ring-1 ring-line/10">
        <summary className="flex cursor-pointer list-none items-center justify-between p-3 text-xs font-bold uppercase tracking-wider text-ink-mute">
          <span>추천 메타데이터</span>
          <ChevronDown size={14} className={`transition ${advancedOpen ? 'rotate-180' : ''}`} />
        </summary>

        <div className="space-y-4 p-3 pt-1">
          {/* A. 기본 */}
          <Section title="기본 정보">
            <div className="grid grid-cols-2 gap-2">
              <Select value={mainGenre} onChange={setMainGenre} placeholder="메인 장르">
                {MAIN_GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
              </Select>
              <Select value={subGenre} onChange={setSubGenre} placeholder="서브 장르">
                {subGenres.map((g) => <option key={g} value={g}>{g}</option>)}
              </Select>
              <Select value={language} onChange={setLanguage} placeholder="언어">
                {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
              </Select>
              <Select value={lyricType} onChange={setLyricType} placeholder="가사 유무">
                {LYRIC_TYPES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
              </Select>
            </div>
          </Section>

          {/* B. 음악 성향 */}
          <Section title="음악 성향">
            <div className="grid grid-cols-2 gap-2">
              <input type="number" placeholder="BPM" value={bpm} onChange={(e) => setBpm(e.target.value)} className="input text-sm" />
              <Range label="에너지" value={energy} onChange={setEnergy} />
              <Range label="밝기" value={brightness} onChange={setBrightness} />
              <Range label="감성 강도" value={emotional} onChange={setEmotional} />
              <Range label="보컬 존재감" value={vocal} onChange={setVocal} />
            </div>
          </Section>

          {/* C. 태그 */}
          <Section title="무드 태그">
            <Chips options={MOOD_TAGS} labels={MOOD_TAG_LABELS} selected={moodTags} onToggle={(v) => setMoodTags((a) => toggle(a, v))} />
          </Section>
          <Section title="상황 태그">
            <Chips options={SITUATION_TAGS} labels={SITUATION_TAG_LABELS} selected={situationTags} onToggle={(v) => setSituationTags((a) => toggle(a, v))} />
          </Section>
          <Section title="시간대 태그">
            <Chips options={TIME_SLOT_TAGS} labels={TIME_SLOT_TAG_LABELS} selected={timeSlots} onToggle={(v) => setTimeSlots((a) => toggle(a, v))} />
          </Section>
          <Section title="계절 태그">
            <Chips options={SEASON_TAGS} labels={SEASON_TAG_LABELS} selected={seasonTags} onToggle={(v) => setSeasonTags((a) => toggle(a, v))} />
          </Section>
          <Section title="업종 태그">
            <Chips options={BUSINESS_TAGS} labels={BUSINESS_TAG_LABELS} selected={businessTags} onToggle={(v) => setBusinessTags((a) => toggle(a, v))} />
          </Section>

          {/* D. 운영 */}
          <Section title="운영 정보">
            <div className="grid grid-cols-2 gap-2">
              <Select value={visibility} onChange={setVisibility} placeholder="공개 범위">
                {VISIBILITY_OPTIONS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
              </Select>
              <Select value={copyrightStatus} onChange={setCopyrightStatus} placeholder="저작권 상태">
                {COPYRIGHT_OPTIONS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
              </Select>
              <input type="number" placeholder="추천 우선순위 (0~100)" value={recPriority} onChange={(e) => setRecPriority(e.target.value)} className="input text-sm" />
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={isRecommendable} onChange={(e) => setIsRecommendable(e.target.checked)} />
                추천에 노출
              </label>
            </div>
          </Section>
        </div>
      </details>

      <div className="flex items-center gap-2">
        <button type="submit" disabled={busy} className="btn-primary flex-1">
          <Upload size={14} />
          {busy ? progress || '업로드 중…' : '업로드'}
        </button>
        <button type="button" onClick={onCancel} className="btn-ghost">취소</button>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-bold uppercase tracking-wider text-ink-dim">{title}</p>
      {children}
    </div>
  );
}

function Select({ value, onChange, placeholder, children }: {
  value: string; onChange: (v: string) => void; placeholder: string; children: React.ReactNode;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="input text-sm">
      <option value="">{placeholder}</option>
      {children}
    </select>
  );
}

function Range({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-2 rounded-lg bg-bg-card px-3 py-2 text-xs">
      <span className="w-16 shrink-0 text-ink-mute">{label}</span>
      <input type="range" min={1} max={5} value={value} onChange={(e) => onChange(Number(e.target.value))} className="flex-1" />
      <span className="w-6 text-right font-bold tabular-nums">{value}</span>
    </label>
  );
}

function Chips({
  options, labels, selected, onToggle,
}: {
  options: readonly string[];
  labels: Record<string, string>;
  selected: string[];
  onToggle: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((v) => {
        const on = selected.includes(v);
        return (
          <button
            key={v} type="button" onClick={() => onToggle(v)}
            className={`rounded-full px-2.5 py-1 text-[11px] transition ${
              on ? 'bg-accent text-bg ring-1 ring-accent' : 'bg-bg-card text-ink-mute hover:text-ink ring-1 ring-line/10'
            }`}
          >
            {labels[v] ?? v}
          </button>
        );
      })}
    </div>
  );
}
