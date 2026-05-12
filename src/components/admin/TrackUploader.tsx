import { useState } from 'react';
import { Upload, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/store/toastStore';

interface Props {
  onUploaded: () => Promise<void> | void;
  onCancel: () => void;
}

const ALLOWED_AUDIO_EXT = ['mp3', 'm4a', 'wav', 'ogg', 'aac', 'flac'];
const MAX_AUDIO_BYTES = 50 * 1024 * 1024; // 50MB
const MAX_COVER_BYTES = 5 * 1024 * 1024; // 5MB

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

  function pickAudio(file: File | null) {
    if (!file) {
      setAudioFile(null);
      return;
    }
    if (!isAudioFile(file)) {
      toast.error('음원 파일만 업로드할 수 있어요. (mp3 / m4a / wav 등)');
      return;
    }
    if (file.size > MAX_AUDIO_BYTES) {
      toast.error(`파일이 너무 커요. 50MB 이하로 올려주세요. (현재 ${Math.round(file.size / 1024 / 1024)}MB)`);
      return;
    }
    setAudioFile(file);
  }

  function pickCover(file: File | null) {
    if (!file) {
      setCoverFile(null);
      return;
    }
    if (!isImageFile(file)) {
      toast.error('이미지 파일만 업로드할 수 있어요.');
      return;
    }
    if (file.size > MAX_COVER_BYTES) {
      toast.error('커버는 5MB 이하 이미지만 업로드할 수 있어요.');
      return;
    }
    setCoverFile(file);
  }

  async function uploadToBucket(bucket: 'audio' | 'covers', file: File): Promise<string> {
    const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase();
    const path = `${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from(bucket).upload(path, file, {
      cacheControl: '31536000',
      upsert: false,
      contentType: file.type || undefined,
    });
    if (error) throw new Error(`스토리지 업로드 실패 (${bucket}): ${error.message}`);
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    if (!data?.publicUrl) {
      throw new Error('Storage public URL 생성 실패. 버킷 Public 설정을 확인해주세요.');
    }
    return data.publicUrl;
  }

  async function detectDuration(file: File): Promise<number | null> {
    return new Promise((resolve) => {
      const audio = document.createElement('audio');
      audio.preload = 'metadata';
      const url = URL.createObjectURL(file);
      const cleanup = () => URL.revokeObjectURL(url);
      audio.onloadedmetadata = () => {
        const d = Number.isFinite(audio.duration) ? Math.round(audio.duration) : null;
        cleanup();
        resolve(d);
      };
      audio.onerror = () => {
        cleanup();
        resolve(null);
      };
      audio.src = url;
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!audioFile) {
      toast.error('음원 파일을 선택해주세요.');
      return;
    }
    if (!title.trim()) {
      toast.error('곡 제목을 입력해주세요.');
      return;
    }
    setBusy(true);
    try {
      setProgress('길이 분석…');
      const duration = await detectDuration(audioFile);
      setProgress('음원 업로드…');
      const audioUrl = await uploadToBucket('audio', audioFile);
      let coverUrl: string | null = null;
      if (coverFile) {
        setProgress('커버 업로드…');
        coverUrl = await uploadToBucket('covers', coverFile);
      }
      setProgress('저장 중…');
      const { error } = await supabase.from('tracks').insert({
        title: title.trim(),
        artist: artist.trim() || null,
        genre: genre.trim() || null,
        mood: mood.trim() || null,
        audio_url: audioUrl,
        cover_url: coverUrl,
        duration,
      });
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
        <button type="button" onClick={onCancel} aria-label="닫기">
          <X size={16} />
        </button>
      </div>

      <input
        required
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="곡 제목 *"
        className="input"
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          value={artist}
          onChange={(e) => setArtist(e.target.value)}
          placeholder="아티스트"
          className="input"
        />
        <input
          value={genre}
          onChange={(e) => setGenre(e.target.value)}
          placeholder="장르"
          className="input"
        />
      </div>
      <input
        value={mood}
        onChange={(e) => setMood(e.target.value)}
        placeholder="무드 (예: chill, energetic)"
        className="input"
      />

      <label className="block space-y-1">
        <span className="text-xs text-ink-mute">음원 파일 * (mp3 / m4a / wav, ≤ 50MB)</span>
        <input
          required
          type="file"
          accept="audio/*,.mp3,.m4a,.wav,.ogg,.aac,.flac"
          onChange={(e) => pickAudio(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-ink file:mr-3 file:rounded-full file:border-0 file:bg-bg-hover file:px-3 file:py-1.5 file:text-xs file:text-ink hover:file:bg-white/10"
        />
        {audioFile && (
          <span className="text-[11px] text-ink-dim">
            {audioFile.name} · {(audioFile.size / 1024 / 1024).toFixed(1)}MB
          </span>
        )}
      </label>

      <label className="block space-y-1">
        <span className="text-xs text-ink-mute">커버 이미지 (선택, ≤ 5MB)</span>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => pickCover(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-ink file:mr-3 file:rounded-full file:border-0 file:bg-bg-hover file:px-3 file:py-1.5 file:text-xs file:text-ink hover:file:bg-white/10"
        />
        {coverFile && (
          <span className="text-[11px] text-ink-dim">
            {coverFile.name} · {(coverFile.size / 1024).toFixed(0)}KB
          </span>
        )}
      </label>

      <div className="flex items-center gap-2">
        <button type="submit" disabled={busy} className="btn-primary flex-1">
          <Upload size={14} />
          {busy ? progress || '업로드 중…' : '업로드'}
        </button>
        <button type="button" onClick={onCancel} className="btn-ghost">
          취소
        </button>
      </div>
    </form>
  );
}
