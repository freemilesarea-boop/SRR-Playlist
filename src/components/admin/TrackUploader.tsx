import { useState } from 'react';
import { Upload, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface Props {
  onUploaded: () => Promise<void> | void;
  onCancel: () => void;
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

  async function uploadToBucket(bucket: 'audio' | 'covers', file: File): Promise<string> {
    const ext = file.name.split('.').pop() ?? 'bin';
    const path = `${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from(bucket).upload(path, file, {
      cacheControl: '31536000',
      upsert: false,
    });
    if (error) throw error;
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  }

  async function detectDuration(file: File): Promise<number | null> {
    return new Promise((resolve) => {
      const audio = document.createElement('audio');
      audio.preload = 'metadata';
      audio.onloadedmetadata = () => {
        resolve(Number.isFinite(audio.duration) ? Math.round(audio.duration) : null);
        URL.revokeObjectURL(audio.src);
      };
      audio.onerror = () => resolve(null);
      audio.src = URL.createObjectURL(file);
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!audioFile) {
      alert('음원 파일을 선택해주세요.');
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
        title,
        artist: artist || null,
        genre: genre || null,
        mood: mood || null,
        audio_url: audioUrl,
        cover_url: coverUrl,
        duration,
      });
      if (error) throw error;
      await onUploaded();
    } catch (err) {
      alert(`업로드 실패: ${err instanceof Error ? err.message : String(err)}`);
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
        placeholder="곡 제목"
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
        <span className="text-xs text-ink-mute">음원 파일 (mp3 등)</span>
        <input
          required
          type="file"
          accept="audio/*"
          onChange={(e) => setAudioFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-ink file:mr-3 file:rounded-full file:border-0 file:bg-bg-hover file:px-3 file:py-1.5 file:text-xs file:text-ink hover:file:bg-white/10"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-xs text-ink-mute">커버 이미지 (선택)</span>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-ink file:mr-3 file:rounded-full file:border-0 file:bg-bg-hover file:px-3 file:py-1.5 file:text-xs file:text-ink hover:file:bg-white/10"
        />
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
