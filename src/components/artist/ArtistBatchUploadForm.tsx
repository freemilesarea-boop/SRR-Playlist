/**
 * ArtistBatchUploadForm — 최대 30곡 일괄 업로드 폼.
 *
 * 설계 원칙:
 * - 기존 단일 업로드 (ArtistUploadForm) 와 완전 독립. uploadArtistTrack 만 재사용.
 * - 각 곡은 독립적으로 성공/실패 — 1곡 실패가 29곡 rollback 을 유발하지 않음.
 * - 동시 업로드 3개 제한 (Supabase Storage / RPC 안정성).
 * - 공통 메타데이터 입력 + "모든 곡 / 비어있는 곡에만" 적용 버튼.
 * - 곡별 메타데이터 개별 수정.
 * - 발매일 today+3 검증 (프론트). DB/RPC 측은 0063 의 submit_artist_release 에 이미 검증.
 * - 중복 음원 검출: uploadArtistTrack 내부의 sha256 pre-check 가 처리. 결과 "duplicate" 표시.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Upload, X, CheckCircle2, AlertCircle, Loader2, Copy, FileAudio, Image as ImageIcon } from 'lucide-react';
import {
  uploadArtistTrack,
  validateArtistAudioFile,
  type ReleaseType,
} from '@/lib/artistApi';
import { toast } from '@/store/toastStore';
import Alert from '@/components/Alert';

const MAX_TRACKS = 30;
const CONCURRENCY = 3;

const SUITABLE_STORE_OPTIONS = [
  '카페', '와인바', '식당', '베이커리', '헬스장', '필라테스', '미용실', '의류매장', '서점', '기타',
];

function defaultReleaseDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  return d.toISOString().slice(0, 10);
}

function titleFromFilename(filename: string): string {
  return filename.replace(/\.[^.]+$/, '').replace(/[_\-]+/g, ' ').trim().slice(0, 80);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

type TrackStatus = 'idle' | 'queued' | 'uploading' | 'success' | 'failed';

interface CommonMeta {
  artist: string;
  albumName: string;
  releaseTitle: string;
  releaseDate: string;
  releaseType: ReleaseType;
  mainGenre: string;
  subGenre: string;
  suitableStore: string;
  mood: string;
  rightsHolderName: string;
  explicit: boolean;
  instrumental: boolean;
  coverFile: File | null;
}

interface TrackRow {
  id: string;
  file: File;
  title: string;
  artist: string;
  isrc: string;
  lyrics: string;
  explicit: boolean;
  instrumental: boolean;
  rightsHolderName: string;
  coverFile: File | null;
  status: TrackStatus;
  trackCode?: string;
  error?: string;
}

function initialCommon(): CommonMeta {
  return {
    artist: '',
    albumName: '',
    releaseTitle: '',
    releaseDate: defaultReleaseDate(),
    releaseType: 'single',
    mainGenre: '',
    subGenre: '',
    suitableStore: '',
    mood: '',
    rightsHolderName: '',
    explicit: false,
    instrumental: false,
    coverFile: null,
  };
}

let _idSeq = 0;
function newRowId(): string {
  return `t_${Date.now()}_${++_idSeq}`;
}

export default function ArtistBatchUploadForm({
  onUploaded,
}: {
  onUploaded: () => void | Promise<void>;
}) {
  const [common, setCommon] = useState<CommonMeta>(initialCommon);
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const successCount = useMemo(() => tracks.filter((t) => t.status === 'success').length, [tracks]);
  const failedCount = useMemo(() => tracks.filter((t) => t.status === 'failed').length, [tracks]);
  const uploadingCount = useMemo(
    () => tracks.filter((t) => t.status === 'uploading' || t.status === 'queued').length,
    [tracks],
  );

  function patchTrack(id: string, patch: Partial<TrackRow>) {
    setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  // 업로드 진행 중 탭 닫힘/새로고침 방지 경고
  useEffect(() => {
    if (!submitting && uploadingCount === 0) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [submitting, uploadingCount]);

  function onPickFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const arr = Array.from(files);
    const remaining = MAX_TRACKS - tracks.length;
    if (arr.length > remaining) {
      toast.error(`최대 ${MAX_TRACKS}곡까지 업로드할 수 있어요 (현재 ${tracks.length}곡, 남은 자리 ${remaining}개)`);
      return;
    }
    const rows: TrackRow[] = [];
    const rejected: string[] = [];
    for (const f of arr) {
      const v = validateArtistAudioFile(f);
      if (!v.ok) {
        rejected.push(`${f.name}: ${v.error}`);
        continue;
      }
      rows.push({
        id: newRowId(),
        file: f,
        title: titleFromFilename(f.name),
        artist: '',
        isrc: '',
        lyrics: '',
        explicit: false,
        instrumental: false,
        rightsHolderName: '',
        coverFile: null,
        status: 'idle',
      });
    }
    if (rejected.length > 0) {
      toast.warning(`${rejected.length}개 파일 제외:\n${rejected.slice(0, 3).join('\n')}${rejected.length > 3 ? '\n…' : ''}`);
    }
    if (rows.length > 0) setTracks((prev) => [...prev, ...rows]);
    if (fileRef.current) fileRef.current.value = '';
  }

  function removeRow(id: string) {
    setTracks((prev) => prev.filter((t) => t.id !== id));
  }

  function clearAll() {
    if (submitting) return;
    if (tracks.length === 0) return;
    if (!confirm('선택한 모든 곡을 제거할까요?')) return;
    setTracks([]);
  }

  /** mode='all' 전체 덮어쓰기, 'empty' 빈 값에만 적용 */
  function applyCommonToAll(mode: 'all' | 'empty') {
    setTracks((prev) =>
      prev.map((t) => ({
        ...t,
        artist:
          mode === 'all' || !t.artist.trim() ? common.artist : t.artist,
        rightsHolderName:
          mode === 'all' || !t.rightsHolderName.trim()
            ? common.rightsHolderName
            : t.rightsHolderName,
        explicit: mode === 'all' ? common.explicit : t.explicit,
        instrumental: mode === 'all' ? common.instrumental : t.instrumental,
        coverFile:
          mode === 'all'
            ? common.coverFile
            : t.coverFile ?? common.coverFile,
      })),
    );
    toast.success(mode === 'all' ? '모든 곡에 공통 메타 적용' : '비어있는 항목에만 적용');
  }

  function validateBeforeSubmit(): string | null {
    if (tracks.length === 0) return '음원 파일을 1개 이상 선택해주세요';
    if (!common.albumName.trim()) return '공통 앨범명을 입력해주세요';
    if (!common.releaseDate) return '공통 발매일을 선택해주세요';
    const min = new Date();
    min.setDate(min.getDate() + 3);
    min.setHours(0, 0, 0, 0);
    if (new Date(common.releaseDate) < min) {
      return '발매일은 오늘 기준 최소 3일 뒤부터 선택할 수 있어요';
    }
    if (!common.mainGenre.trim()) return '공통 메인 장르를 입력해주세요';
    if (!common.subGenre.trim()) return '공통 서브 장르를 입력해주세요';
    if (!common.suitableStore.trim()) return '공통 어울리는 매장을 선택해주세요';
    if (!common.mood.trim()) return '공통 분위기를 입력해주세요';
    if (!rightsConfirmed) return '권리 확인 체크박스를 동의해주세요';
    for (const t of tracks) {
      if (!t.title.trim()) return `곡 제목 미입력: ${t.file.name}`;
    }
    return null;
  }

  async function uploadOne(t: TrackRow): Promise<{ ok: boolean; error?: string; track_code?: string }> {
    return uploadArtistTrack({
      title: t.title.trim(),
      artist: (t.artist.trim() || common.artist.trim()) || undefined,
      album_name: common.albumName.trim(),
      release_title: common.releaseTitle.trim() || common.albumName.trim(),
      release_type: common.releaseType,
      release_date: common.releaseDate,
      isrc: t.isrc.trim() || undefined,
      rights_holder_name:
        (t.rightsHolderName.trim() || common.rightsHolderName.trim()) || undefined,
      explicit_content: t.explicit,
      instrumental: t.instrumental,
      rightsConfirmed,
      main_genre: common.mainGenre,
      sub_genre: common.subGenre,
      suitable_store: common.suitableStore,
      mood: common.mood,
      lyrics: t.lyrics.trim() || undefined,
      audioFile: t.file,
      coverFile: t.coverFile ?? common.coverFile,
    });
  }

  async function runPool(ids: string[]) {
    const queue = [...ids];
    const worker = async () => {
      while (queue.length > 0) {
        const id = queue.shift();
        if (!id) break;
        const t = tracks.find((x) => x.id === id);
        if (!t) continue;
        patchTrack(id, { status: 'uploading', error: undefined });
        try {
          const res = await uploadOne(t);
          if (res.ok) {
            patchTrack(id, { status: 'success', trackCode: res.track_code });
          } else {
            patchTrack(id, { status: 'failed', error: res.error ?? '업로드 실패' });
          }
        } catch (e) {
          patchTrack(id, {
            status: 'failed',
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  }

  async function onSubmit() {
    const err = validateBeforeSubmit();
    if (err) {
      toast.error(err);
      return;
    }
    setSubmitting(true);
    try {
      const targets = tracks.filter((t) => t.status !== 'success').map((t) => t.id);
      if (targets.length === 0) {
        toast.info('업로드할 곡이 없어요 (모두 성공 상태)');
        return;
      }
      setTracks((prev) =>
        prev.map((t) =>
          targets.includes(t.id) ? { ...t, status: 'queued' as TrackStatus, error: undefined } : t,
        ),
      );
      await runPool(targets);
      // 결과 요약 (state 가 최신이 아닐 수 있으므로 ref 대신 setter 콜백 사용)
      setTracks((prev) => {
        const ok = prev.filter((t) => t.status === 'success').length;
        const ng = prev.filter((t) => t.status === 'failed').length;
        if (ng === 0) {
          toast.success(`${ok}곡 업로드 완료. 관리자 검수 후 공개됩니다.`);
        } else {
          toast.warning(`성공 ${ok}곡 · 실패 ${ng}곡. 실패 항목 확인 후 재시도해주세요.`);
        }
        return prev;
      });
      await onUploaded();
    } finally {
      setSubmitting(false);
    }
  }

  async function retryFailed() {
    const failedIds = tracks.filter((t) => t.status === 'failed').map((t) => t.id);
    if (failedIds.length === 0) return;
    const err = validateBeforeSubmit();
    if (err) {
      toast.error(err);
      return;
    }
    setSubmitting(true);
    try {
      setTracks((prev) =>
        prev.map((t) =>
          failedIds.includes(t.id) ? { ...t, status: 'queued' as TrackStatus, error: undefined } : t,
        ),
      );
      await runPool(failedIds);
      await onUploaded();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit();
      }}
      className="space-y-4 rounded-2xl bg-bg-card p-4 ring-1 ring-line/10"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-bold">
          <Upload size={14} className="text-accent" /> 일괄 업로드 (최대 {MAX_TRACKS}곡)
        </h2>
        <span className="text-[11px] text-ink-mute">
          {tracks.length} / {MAX_TRACKS} 곡 선택
          {(successCount > 0 || failedCount > 0) && (
            <> · 성공 {successCount} · 실패 {failedCount}</>
          )}
        </span>
      </header>

      {/* Step 1 — 파일 선택 */}
      <section className="space-y-2">
        <p className="text-xs font-semibold text-ink-mute">1. 음원 파일 선택 (mp3 / wav / m4a / flac, 곡당 100MB 이하)</p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-accent/15 px-3 py-2 text-xs font-semibold text-accent hover:bg-accent/25">
            <FileAudio size={14} />
            파일 추가
            <input
              ref={fileRef}
              type="file"
              accept=".mp3,.wav,.flac,.m4a,audio/*"
              multiple
              className="hidden"
              onChange={(e) => onPickFiles(e.target.files)}
              disabled={submitting || tracks.length >= MAX_TRACKS}
            />
          </label>
          {tracks.length > 0 && (
            <button
              type="button"
              onClick={clearAll}
              disabled={submitting}
              className="rounded-lg bg-bg-soft px-3 py-2 text-xs font-semibold text-ink-mute ring-1 ring-line/10 hover:text-red-400 disabled:opacity-50"
            >
              전체 비우기
            </button>
          )}
        </div>
        {tracks.length === 0 && (
          <p className="text-[11px] text-ink-dim">
            여러 곡을 한꺼번에 선택할 수 있어요. 같은 음원 파일은 중복 차단됩니다.
          </p>
        )}
      </section>

      {/* Step 2 — 공통 메타데이터 */}
      <section className="space-y-2 rounded-xl bg-bg-soft/50 p-3 ring-1 ring-line/10">
        <p className="text-xs font-semibold text-ink-mute">2. 공통 메타데이터</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Field label="대표 아티스트명">
            <input
              type="text"
              value={common.artist}
              onChange={(e) => setCommon({ ...common, artist: e.target.value })}
              placeholder="(기본: 프로필 아티스트명)"
              className="input"
            />
          </Field>
          <Field label="앨범명 *">
            <input
              type="text"
              required
              value={common.albumName}
              onChange={(e) => setCommon({ ...common, albumName: e.target.value })}
              className="input"
            />
          </Field>
          <Field label="발매명">
            <input
              type="text"
              value={common.releaseTitle}
              onChange={(e) => setCommon({ ...common, releaseTitle: e.target.value })}
              placeholder="(기본: 앨범명)"
              className="input"
            />
          </Field>
          <Field label="발매 타입">
            <select
              value={common.releaseType}
              onChange={(e) =>
                setCommon({ ...common, releaseType: e.target.value as ReleaseType })
              }
              className="input"
            >
              <option value="single">single</option>
              <option value="ep">ep</option>
              <option value="album">album</option>
            </select>
          </Field>
          <Field label="발매일 * (today+3 이상)">
            <input
              type="date"
              required
              value={common.releaseDate}
              min={defaultReleaseDate()}
              onChange={(e) => setCommon({ ...common, releaseDate: e.target.value })}
              className="input"
            />
          </Field>
          <Field label="메인 장르 *">
            <input
              type="text"
              required
              value={common.mainGenre}
              onChange={(e) => setCommon({ ...common, mainGenre: e.target.value })}
              placeholder="예: K-POP / Indie / R&B"
              className="input"
            />
          </Field>
          <Field label="서브 장르 *">
            <input
              type="text"
              required
              value={common.subGenre}
              onChange={(e) => setCommon({ ...common, subGenre: e.target.value })}
              className="input"
            />
          </Field>
          <Field label="어울리는 매장 *">
            <select
              required
              value={common.suitableStore}
              onChange={(e) => setCommon({ ...common, suitableStore: e.target.value })}
              className="input"
            >
              <option value="">선택</option>
              {SUITABLE_STORE_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </Field>
          <Field label="분위기 *">
            <input
              type="text"
              required
              value={common.mood}
              onChange={(e) => setCommon({ ...common, mood: e.target.value })}
              placeholder="예: 잔잔한 / 신나는 / 감성적"
              className="input"
            />
          </Field>
          <Field label="권리자명">
            <input
              type="text"
              value={common.rightsHolderName}
              onChange={(e) => setCommon({ ...common, rightsHolderName: e.target.value })}
              placeholder="(기본: 본명)"
              className="input"
            />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <label className="flex items-center gap-2 rounded-md bg-bg-soft p-2 text-xs ring-1 ring-line/10">
            <input
              type="checkbox"
              checked={common.explicit}
              onChange={(e) => setCommon({ ...common, explicit: e.target.checked })}
            />
            explicit (19+)
          </label>
          <label className="flex items-center gap-2 rounded-md bg-bg-soft p-2 text-xs ring-1 ring-line/10">
            <input
              type="checkbox"
              checked={common.instrumental}
              onChange={(e) => setCommon({ ...common, instrumental: e.target.checked })}
            />
            instrumental
          </label>
          <label className="flex items-center gap-2 rounded-md bg-bg-soft p-2 text-xs ring-1 ring-line/10 cursor-pointer hover:bg-bg-soft/80">
            <ImageIcon size={12} className="text-ink-dim" />
            <span className="flex-1 truncate">
              {common.coverFile ? common.coverFile.name : '공통 커버 이미지 (선택)'}
            </span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => setCommon({ ...common, coverFile: e.target.files?.[0] ?? null })}
            />
          </label>
        </div>
        {tracks.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={() => applyCommonToAll('all')}
              disabled={submitting}
              className="inline-flex items-center gap-1 rounded-md bg-accent/15 px-2.5 py-1.5 text-[11px] font-semibold text-accent hover:bg-accent/25 disabled:opacity-50"
            >
              <Copy size={11} /> 모든 곡에 적용
            </button>
            <button
              type="button"
              onClick={() => applyCommonToAll('empty')}
              disabled={submitting}
              className="inline-flex items-center gap-1 rounded-md bg-bg-soft px-2.5 py-1.5 text-[11px] font-semibold text-ink-mute ring-1 ring-line/10 hover:text-ink disabled:opacity-50"
            >
              <Copy size={11} /> 비어있는 항목에만 적용
            </button>
          </div>
        )}
      </section>

      {/* Step 3 — 곡별 메타데이터 / 상태 */}
      {tracks.length > 0 && (
        <section className="space-y-2">
          <p className="text-xs font-semibold text-ink-mute">3. 곡별 정보 / 상태</p>
          <ul className="space-y-1.5">
            {tracks.map((t, idx) => (
              <li key={t.id} className="rounded-lg bg-bg-soft/40 ring-1 ring-line/10">
                <div className="flex items-center gap-2 p-2">
                  <span className="w-6 shrink-0 text-center text-[11px] font-mono text-ink-dim">
                    {idx + 1}
                  </span>
                  <StatusBadge status={t.status} trackCode={t.trackCode} />
                  <input
                    type="text"
                    value={t.title}
                    onChange={(e) => patchTrack(t.id, { title: e.target.value })}
                    placeholder="곡 제목"
                    disabled={submitting || t.status === 'success'}
                    className="input flex-1 min-w-0 text-[12px]"
                  />
                  <span className="hidden shrink-0 truncate text-[10px] text-ink-dim sm:inline-block max-w-[140px]">
                    {t.file.name}
                  </span>
                  <span className="shrink-0 text-[10px] text-ink-dim">
                    {formatFileSize(t.file.size)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setExpanded(expanded === t.id ? null : t.id)}
                    className="rounded p-1 text-[10px] text-ink-dim hover:bg-bg-soft hover:text-ink"
                  >
                    {expanded === t.id ? '닫기' : '더보기'}
                  </button>
                  {t.status !== 'success' && (
                    <button
                      type="button"
                      onClick={() => removeRow(t.id)}
                      disabled={submitting}
                      aria-label="제거"
                      className="rounded p-1 text-ink-dim hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                {expanded === t.id && (
                  <div className="space-y-2 border-t border-line/10 p-2">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <Field label="참여 아티스트">
                        <input
                          type="text"
                          value={t.artist}
                          onChange={(e) => patchTrack(t.id, { artist: e.target.value })}
                          placeholder="(기본: 공통값)"
                          className="input text-[12px]"
                          disabled={submitting || t.status === 'success'}
                        />
                      </Field>
                      <Field label="ISRC">
                        <input
                          type="text"
                          value={t.isrc}
                          onChange={(e) => patchTrack(t.id, { isrc: e.target.value.toUpperCase() })}
                          placeholder="예: KRA012500001"
                          className="input text-[12px] font-mono"
                          disabled={submitting || t.status === 'success'}
                        />
                      </Field>
                      <Field label="권리자명 (곡별)">
                        <input
                          type="text"
                          value={t.rightsHolderName}
                          onChange={(e) => patchTrack(t.id, { rightsHolderName: e.target.value })}
                          placeholder="(기본: 공통값)"
                          className="input text-[12px]"
                          disabled={submitting || t.status === 'success'}
                        />
                      </Field>
                      <label className="flex cursor-pointer items-center gap-2 rounded-md bg-bg-soft p-2 text-[12px] ring-1 ring-line/10">
                        <ImageIcon size={12} className="text-ink-dim" />
                        <span className="flex-1 truncate">
                          {t.coverFile ? t.coverFile.name : '곡별 커버 이미지 (선택)'}
                        </span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          disabled={submitting || t.status === 'success'}
                          onChange={(e) => patchTrack(t.id, { coverFile: e.target.files?.[0] ?? null })}
                        />
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="flex items-center gap-2 rounded-md bg-bg-soft p-2 text-[12px] ring-1 ring-line/10">
                        <input
                          type="checkbox"
                          checked={t.explicit}
                          onChange={(e) => patchTrack(t.id, { explicit: e.target.checked })}
                          disabled={submitting || t.status === 'success'}
                        />
                        explicit
                      </label>
                      <label className="flex items-center gap-2 rounded-md bg-bg-soft p-2 text-[12px] ring-1 ring-line/10">
                        <input
                          type="checkbox"
                          checked={t.instrumental}
                          onChange={(e) => patchTrack(t.id, { instrumental: e.target.checked })}
                          disabled={submitting || t.status === 'success'}
                        />
                        instrumental
                      </label>
                    </div>
                    <Field label="가사 (선택)">
                      <textarea
                        rows={3}
                        value={t.lyrics}
                        onChange={(e) => patchTrack(t.id, { lyrics: e.target.value })}
                        disabled={submitting || t.status === 'success'}
                        className="input text-[12px]"
                      />
                    </Field>
                  </div>
                )}
                {t.error && (
                  <div className="border-t border-line/10 p-2">
                    <Alert tone="error" title="실패 사유">{t.error}</Alert>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Step 4 — 권리 확인 */}
      <section className="space-y-2">
        <label className="flex cursor-pointer items-start gap-2 rounded-lg bg-bg-soft p-3 text-[12px] ring-1 ring-line/10">
          <input
            type="checkbox"
            checked={rightsConfirmed}
            onChange={(e) => setRightsConfirmed(e.target.checked)}
            disabled={submitting}
            className="mt-0.5"
          />
          <span>
            본인은 위 모든 곡의 <strong className="text-accent">저작권·저작인접권 권리자</strong> 본인 또는 정당한 권리자임을 확인하며,
            허위 등록 시 발생하는 모든 법적·민형사상 책임은 본인에게 있음에 동의합니다.
          </span>
        </label>
      </section>

      {/* Step 5 — 제출 */}
      <section className="space-y-2">
        {failedCount > 0 && !submitting && (
          <button
            type="button"
            onClick={() => void retryFailed()}
            className="w-full rounded-xl bg-amber-500/15 py-2.5 text-sm font-bold text-amber-700 ring-1 ring-amber-400/30 hover:bg-amber-500/25 dark:text-amber-200"
          >
            실패한 {failedCount}곡만 재시도
          </button>
        )}
        <button
          type="submit"
          disabled={submitting || tracks.length === 0}
          className="btn-primary w-full py-3 text-sm font-bold"
        >
          {submitting
            ? `업로드 중… (${uploadingCount}곡 진행 중)`
            : `총 ${tracks.length}곡 제출`}
        </button>
        <p className="text-[11px] text-ink-dim">
          동시 업로드 {CONCURRENCY}개씩 순차 처리되며, 각 곡은 독립적으로 성공/실패합니다.
          실패한 곡만 별도로 재시도할 수 있어요.
        </p>
        {(submitting || uploadingCount > 0) && (
          <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-300">
            업로드가 끝날 때까지 창을 닫거나 새로고침하지 마세요. 대량 업로드는 순차 처리되어 시간이 걸릴 수 있어요.
          </p>
        )}
      </section>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-dim">{label}</span>
      {children}
    </label>
  );
}

function StatusBadge({ status, trackCode }: { status: TrackStatus; trackCode?: string }) {
  if (status === 'success') {
    return (
      <span
        title={trackCode ?? '성공'}
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300"
      >
        <CheckCircle2 size={10} /> 성공
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-700 dark:text-red-300">
        <AlertCircle size={10} /> 실패
      </span>
    );
  }
  if (status === 'uploading') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:text-sky-300">
        <Loader2 size={10} className="animate-spin" /> 업로드 중
      </span>
    );
  }
  if (status === 'queued') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
        대기
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-bg-soft px-2 py-0.5 text-[10px] font-semibold text-ink-dim ring-1 ring-line/10">
      준비
    </span>
  );
}
