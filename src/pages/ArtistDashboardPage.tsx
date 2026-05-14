import { useCallback, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import {
  Mic2,
  CheckCircle2,
  Clock,
  XCircle,
  EyeOff,
  Upload,
  Trash2,
  Music,
  ArrowLeft,
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useFreshFetch } from '@/hooks/useFreshFetch';
import {
  fetchMyArtistProfile,
  fetchMyArtistTracks,
  uploadArtistTrack,
  deleteMyArtistTrack,
  validateArtistAudioFile,
  type ArtistProfile,
  type MyArtistTrackRow,
} from '@/lib/artistApi';
import { toast } from '@/store/toastStore';

import type { LucideIcon } from 'lucide-react';

const STATUS_LABEL: Record<string, { label: string; tone: string; Icon: LucideIcon }> = {
  pending_review: { label: '심사 대기', tone: 'bg-yellow-500/15 text-yellow-200', Icon: Clock },
  approved: { label: '승인됨', tone: 'bg-emerald-500/15 text-emerald-300', Icon: CheckCircle2 },
  rejected: { label: '거절됨', tone: 'bg-red-500/15 text-red-300', Icon: XCircle },
  hidden: { label: '숨김', tone: 'bg-ink/10 text-ink-mute', Icon: EyeOff },
};

export default function ArtistDashboardPage() {
  const { user, profile, loading: authLoading } = useAuthStore();
  const [artist, setArtist] = useState<ArtistProfile | null>(null);
  const [tracks, setTracks] = useState<MyArtistTrackRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const [ap, ts] = await Promise.all([fetchMyArtistProfile(user.id), fetchMyArtistTracks()]);
      setArtist(ap);
      setTracks(ts);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useFreshFetch(load, [user?.id]);

  // 로그인 안 됨
  if (!authLoading && !user) return <Navigate to="/login" replace />;
  // account_type 이 artist 가 아니면 차단
  if (!authLoading && profile && profile.account_type !== 'artist') {
    return <Navigate to="/" replace />;
  }

  const isApproved = artist?.approval_status === 'approved';

  return (
    <div className="space-y-6 px-4 pb-12 pt-6 sm:px-6">
      <header className="flex items-center gap-3">
        <Link to="/profile" className="flex h-9 w-9 items-center justify-center rounded-full bg-bg-card" aria-label="뒤로">
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
            <Mic2 size={20} className="text-accent" /> 아티스트 대시보드
          </h1>
          <p className="text-xs text-ink-mute">{artist?.artist_name ?? '—'}</p>
        </div>
      </header>

      {/* 승인 상태 카드 */}
      {loading ? (
        <div className="h-24 animate-pulse rounded-2xl bg-bg-card" />
      ) : (
        <ApprovalStatusCard artist={artist} />
      )}

      {/* 업로드 폼 — approved 일 때만 활성 */}
      {isApproved ? (
        <ArtistUploadForm onUploaded={load} />
      ) : (
        <div className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
          <h2 className="text-sm font-bold">음원 업로드</h2>
          <p className="mt-1 text-xs text-ink-mute">
            관리자 승인 후 음원 업로드가 가능합니다.
          </p>
        </div>
      )}

      {/* 내 음원 목록 */}
      <section className="space-y-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-lg font-bold tracking-tight">내 음원 ({tracks.length})</h2>
          <span className="text-xs text-ink-mute">최신순</span>
        </div>
        {loading ? (
          <div className="space-y-2">
            {[0, 1].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-bg-card" />
            ))}
          </div>
        ) : tracks.length === 0 ? (
          <p className="rounded-2xl bg-bg-card/60 p-6 text-center text-sm text-ink-mute ring-1 ring-line/10">
            아직 업로드한 음원이 없어요.
          </p>
        ) : (
          <ul className="overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10">
            {tracks.map((t) => (
              <MyTrackRow key={t.track_id} track={t} onChanged={load} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ApprovalStatusCard({ artist }: { artist: ArtistProfile | null }) {
  if (!artist) {
    return (
      <div className="rounded-2xl bg-yellow-500/10 p-4 ring-1 ring-yellow-500/30">
        <p className="text-sm font-bold text-yellow-200">아티스트 프로필이 없습니다</p>
        <p className="mt-1 text-xs text-yellow-100/80">
          회원가입 시 아티스트 정보가 저장되지 않았을 수 있어요. 고객센터로 문의해주세요.
        </p>
      </div>
    );
  }
  if (artist.approval_status === 'pending') {
    return (
      <div className="rounded-2xl bg-yellow-500/10 p-4 ring-1 ring-yellow-500/30">
        <p className="flex items-center gap-2 text-sm font-bold text-yellow-200">
          <Clock size={14} /> 관리자 승인 대기 중입니다
        </p>
        <p className="mt-1 text-xs text-yellow-100/80">
          승인이 완료되면 음원 등록이 가능합니다. 평균 1영업일 이내 처리됩니다.
        </p>
      </div>
    );
  }
  if (artist.approval_status === 'rejected') {
    return (
      <div className="rounded-2xl bg-red-500/10 p-4 ring-1 ring-red-500/30">
        <p className="flex items-center gap-2 text-sm font-bold text-red-200">
          <XCircle size={14} /> 승인이 거절되었습니다
        </p>
        {artist.rejected_reason && (
          <p className="mt-1 text-xs text-red-200/85">사유: {artist.rejected_reason}</p>
        )}
        <p className="mt-2 text-xs text-red-100/70">
          이의가 있으신가요?{' '}
          <a href="mailto:freemilesarea@gmail.com?subject=아티스트 승인 재신청" className="underline">
            고객센터 문의
          </a>
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-2xl bg-emerald-500/10 p-4 ring-1 ring-emerald-500/30">
      <p className="flex items-center gap-2 text-sm font-bold text-emerald-300">
        <CheckCircle2 size={14} /> 승인 완료
      </p>
      <p className="mt-1 text-xs text-emerald-100/80">
        음원을 업로드할 수 있어요. 업로드한 곡은 관리자 검수 후 공개됩니다.
      </p>
    </div>
  );
}

function ArtistUploadForm({ onUploaded }: { onUploaded: () => void | Promise<void> }) {
  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState('');
  const [mood, setMood] = useState('');
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  function pickAudio(f: File | null) {
    if (!f) return setAudioFile(null);
    const v = validateArtistAudioFile(f);
    if (!v.ok) {
      toast.error(v.error ?? '허용되지 않는 파일');
      return;
    }
    setAudioFile(f);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!audioFile) {
      toast.error('오디오 파일을 선택해주세요');
      return;
    }
    setBusy(true);
    try {
      const res = await uploadArtistTrack({
        title,
        genre: genre || undefined,
        mood: mood || undefined,
        audioFile,
        coverFile,
      });
      if (!res.ok) {
        toast.error(res.error ?? '업로드 실패');
        return;
      }
      toast.success('업로드 완료. 관리자 검수 후 공개됩니다.');
      setTitle('');
      setGenre('');
      setMood('');
      setAudioFile(null);
      setCoverFile(null);
      await onUploaded();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
      <h2 className="flex items-center gap-1.5 text-sm font-bold">
        <Upload size={14} className="text-accent" /> 새 음원 업로드
      </h2>

      <Field label="곡 제목 *">
        <input type="text" required value={title} onChange={(e) => setTitle(e.target.value)} className="input" maxLength={120} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="장르">
          <input type="text" value={genre} onChange={(e) => setGenre(e.target.value)} className="input" placeholder="예: 발라드, 인디" />
        </Field>
        <Field label="분위기">
          <input type="text" value={mood} onChange={(e) => setMood(e.target.value)} className="input" placeholder="예: chill, dreamy" />
        </Field>
      </div>

      <Field label="오디오 파일 *" hint="mp3 / wav / m4a / flac · 100MB 이하">
        <input
          type="file"
          accept=".mp3,.wav,.m4a,.flac,audio/*"
          onChange={(e) => pickAudio(e.target.files?.[0] ?? null)}
          className="block w-full text-xs text-ink file:mr-3 file:rounded-md file:border-0 file:bg-bg-deep file:px-3 file:py-1.5 file:text-xs file:text-ink hover:file:bg-ink/10"
        />
        {audioFile && (
          <p className="text-[11px] text-ink-mute">
            {audioFile.name} ({Math.round(audioFile.size / 1024 / 1024)}MB)
          </p>
        )}
      </Field>

      <Field label="커버 이미지" hint="(선택) 정사각형 권장">
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)}
          className="block w-full text-xs text-ink file:mr-3 file:rounded-md file:border-0 file:bg-bg-deep file:px-3 file:py-1.5 file:text-xs file:text-ink hover:file:bg-ink/10"
        />
      </Field>

      <button type="submit" disabled={busy || !audioFile || !title.trim()} className="btn-primary w-full py-2.5">
        {busy ? '업로드 중…' : '업로드 신청'}
      </button>
      <p className="text-[11px] text-ink-dim">
        업로드된 음원은 <strong className="text-accent">관리자 검수</strong> 후 서비스에 노출됩니다.
      </p>
    </form>
  );
}

function MyTrackRow({ track, onChanged }: { track: MyArtistTrackRow; onChanged: () => void | Promise<void> }) {
  const status = STATUS_LABEL[track.visibility_status] ?? STATUS_LABEL.pending_review;
  const Icon = status.Icon;
  const canDelete = track.visibility_status === 'pending_review';

  async function onDelete() {
    if (!window.confirm('이 음원을 삭제하시겠어요? (심사 대기 상태에서만 삭제 가능)')) return;
    const res = await deleteMyArtistTrack(track.track_id);
    if (!res.ok) {
      toast.error(res.error ?? '삭제 실패');
      return;
    }
    toast.success('삭제 완료');
    await onChanged();
  }

  return (
    <li className="flex items-center gap-3 border-b border-line/10 p-3 last:border-b-0">
      <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-bg-hover">
        {track.cover_url ? (
          <img src={track.cover_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-ink-dim">
            <Music size={14} />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{track.title}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-mute">
          <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${status.tone}`}>
            <Icon size={9} /> {status.label}
          </span>
          {track.genre && <span className="text-ink-dim">· {track.genre}</span>}
          <span className="text-ink-dim">
            · {new Date(track.created_at).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' })}
          </span>
        </div>
        {track.rejected_reason && (
          <p className="mt-1 text-[11px] text-red-300">거절 사유: {track.rejected_reason}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {track.audio_url && (
          <audio src={track.audio_url} controls preload="none" className="h-7 max-w-[180px]" />
        )}
        {canDelete && (
          <button
            onClick={onDelete}
            className="rounded-md p-1.5 text-ink-dim hover:bg-red-500/10 hover:text-red-300"
            aria-label="삭제"
            title="삭제 (심사 대기 상태에서만)"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </li>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-[11px] font-semibold uppercase tracking-wider text-ink-mute">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-ink-dim">{hint}</span>}
    </label>
  );
}
