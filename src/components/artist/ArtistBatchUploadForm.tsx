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
  fetchArtistUploadEligibility,
  fetchMyArtistProfile,
  getCurrentUserFast,
  formatEligibilityError,
  getMyMetadataTrust,
  computeAudioSha256,
  fetchMyUploadQuota,
  type UploadQuotaInfo,
  type ReleaseType,
  type ArtistProfile,
} from '@/lib/artistApi';
import { toast } from '@/store/toastStore';
import { supabase } from '@/lib/supabase';
import Alert from '@/components/Alert';
import TrackMetaSelectors from '@/components/artist/TrackMetaSelectors';
import AudioQcGuideCard from '@/components/artist/AudioQcGuideCard';
import { captureError } from '@/lib/sentry';
import {
  emptySelectedMeta, validateSelectedMeta, setTrackSelectedMetadata, type SelectedMeta,
} from '@/lib/trackMetadataOptions';

const MAX_TRACKS = 30;
const CONCURRENCY = 3;

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
  fingerprint: string;
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
  /** 0196 — batch 내 동일 콘텐츠 사전 차단/재사용용 원본 SHA-256 */
  audioSha256?: string;
}

// 0196 — 새로고침 복구용 manifest (File 은 보관 불가 → 메타/상태만 저장).
const RECOVERY_KEY = 'srr-batch-upload-manifest';
interface RecoveryItem { clientTrackId: string; filename: string; title: string; status: TrackStatus }
interface RecoveryManifest { batchId: string; savedAt: number; items: RecoveryItem[] }

function saveRecoveryManifest(batchId: string, rows: TrackRow[]): void {
  try {
    const m: RecoveryManifest = {
      batchId, savedAt: Date.now(),
      items: rows.map((t) => ({ clientTrackId: t.id, filename: t.file.name, title: t.title, status: t.status })),
    };
    localStorage.setItem(RECOVERY_KEY, JSON.stringify(m));
  } catch { /* noop */ }
}
function readRecoveryManifest(): RecoveryManifest | null {
  try {
    const raw = localStorage.getItem(RECOVERY_KEY);
    if (!raw) return null;
    const m = JSON.parse(raw) as RecoveryManifest;
    if (!m.batchId || !Array.isArray(m.items)) return null;
    if (Date.now() - (m.savedAt ?? 0) > 24 * 3600 * 1000) return null; // 24h 초과 무시
    return m;
  } catch { return null; }
}
function clearRecoveryManifest(): void {
  try { localStorage.removeItem(RECOVERY_KEY); } catch { /* noop */ }
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
  // 불변 client_track_id — 비동기 업로드/변환/insert 결과 매핑은 index 가 아닌 이 id 기준.
  try { return crypto.randomUUID(); } catch { return `t_${Date.now()}_${++_idSeq}_${Math.random().toString(36).slice(2)}`; }
}

/** 파일 지문(중복 선택 감지/디버깅용): 이름|크기|수정시각. */
function fileFingerprint(f: File): string {
  return `${f.name}|${f.size}|${f.lastModified}`;
}

export default function ArtistBatchUploadForm({
  onUploaded,
}: {
  onUploaded: () => void | Promise<void>;
}) {
  const [common, setCommon] = useState<CommonMeta>(initialCommon);
  const [meta, setMeta] = useState<SelectedMeta>(emptySelectedMeta);
  const [trust, setTrust] = useState<{ trust_score: number; tier: 'high' | 'medium' | 'low'; guidance: string } | null>(null);
  const [quota, setQuota] = useState<UploadQuotaInfo | null>(null);
  useEffect(() => { getMyMetadataTrust().then(setTrust).catch(() => {}); }, []);
  useEffect(() => { fetchMyUploadQuota().then(setQuota).catch(() => {}); }, []);
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  // 0196 — 무결성 경고(차단) + 새로고침 복구 배너
  const [integrityWarn, setIntegrityWarn] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<{ registered: number; pending: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 0196 — 새로고침 복구: 마운트 시 이전 미완료 batch 가 있으면 서버와 대조해 안내.
  useEffect(() => {
    const m = readRecoveryManifest();
    if (!m) return;
    const incomplete = m.items.filter((it) => it.status !== 'success');
    if (incomplete.length === 0) { clearRecoveryManifest(); return; }
    (async () => {
      try {
        const { data } = await supabase.rpc('get_my_batch_status', { p_batch_id: m.batchId });
        const rows = (data ?? []) as Array<{ client_track_id: string; upload_status: string }>;
        const registered = new Set(rows.filter((r) => r.upload_status === 'success').map((r) => r.client_track_id));
        const pending = incomplete.filter((it) => !registered.has(it.clientTrackId)).map((it) => it.filename);
        if (pending.length > 0) setRecovery({ registered: registered.size, pending });
        else clearRecoveryManifest();
      } catch { /* best-effort: 서버 확인 실패 시 배너 생략 */ }
    })();
  }, []);

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
    const dupNames: string[] = [];
    const seen = new Set(tracks.map((t) => t.fingerprint));
    for (const f of arr) {
      const v = validateArtistAudioFile(f);
      if (!v.ok) {
        rejected.push(`${f.name}: ${v.error}`);
        continue;
      }
      const fp = fileFingerprint(f);
      if (seen.has(fp)) { dupNames.push(f.name); continue; } // 같은 파일 중복 선택 차단
      seen.add(fp);
      rows.push({
        id: newRowId(),
        file: f,
        fingerprint: fp,
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
    if (dupNames.length > 0) {
      toast.warning(`동일한 파일이 이미 선택되어 제외했어요 (${dupNames.length}개): ${dupNames.slice(0, 3).join(', ')}`);
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
    const metaErr = validateSelectedMeta(meta);
    if (metaErr) return `공통 메타데이터: ${metaErr}`;
    if (!rightsConfirmed) return '권리 확인 체크박스를 동의해주세요';
    const hasCommonCover = !!common.coverFile;
    for (const t of tracks) {
      if (!t.title.trim()) return `곡 제목 미입력: ${t.file.name}`;
      // 앨범 자켓 필수 — 개별 자켓 또는 공통 자켓 중 하나는 있어야 검수 제출 가능
      if (!(t.coverFile || hasCommonCover)) {
        return `앨범 자켓 미등록: ${t.file.name} (공통 자켓을 올리거나 개별 자켓을 지정해주세요)`;
      }
    }
    return null;
  }

  async function uploadOne(
    t: TrackRow,
    profile: ArtistProfile | null,
    batchId: string,
    shaById: Map<string, string>,
  ): Promise<{ ok: boolean; error?: string; track_id?: string; track_code?: string; cover_warning?: string }> {
    return uploadArtistTrack({
      batchId,
      clientTrackId: t.id,
      sourceFingerprint: t.fingerprint,
      precomputedAudioSha256: shaById.get(t.id) ?? t.audioSha256 ?? null,
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
      instrumental: meta.vocal_type === 'instrumental',
      rightsConfirmed,
      main_genre: meta.genre_tags[0],
      sub_genre: meta.genre_tags[1] || undefined,
      suitable_store: meta.business_type_tags[0],
      mood: meta.mood_tags[0],
      lyrics: t.lyrics.trim() || undefined,
      audioFile: t.file,
      coverFile: t.coverFile ?? common.coverFile,
      // 자격/프로필/정산계좌는 제출 직전 1회만 확인 (곡마다 RPC/조회 반복 → 연결 경합 timeout 방지)
      skipEligibilityCheck: true,
      prefetchedProfile: profile,
      skipPayoutCheck: true,
    });
  }

  /**
   * 제출 직전 1회만: 업로드 자격(eligibility, payout 포함) + 아티스트 프로필 확인.
   * 통과 시 profile 반환, 실패 시 사용자 메시지 반환. 곡별로 반복하지 않는다.
   */
  async function runPreflight(): Promise<{ error: string | null; profile: ArtistProfile | null }> {
    try {
      const me = await getCurrentUserFast();
      if (!me?.id) {
        return { error: '로그인 정보 확인이 지연됐어요. 새로고침 후 다시 시도해주세요.', profile: null };
      }
      const [elig, profile] = await Promise.all([
        fetchArtistUploadEligibility(),
        fetchMyArtistProfile(me.id),
      ]);
      if (!elig.can_upload) return { error: formatEligibilityError(elig.reasons), profile: null };
      if (!profile || profile.approval_status !== 'approved') {
        return { error: '승인된 아티스트만 업로드할 수 있어요.', profile: null };
      }
      return { error: null, profile };
    } catch {
      return { error: '계정 상태 확인이 지연되었습니다. 다시 시도해주세요.', profile: null };
    }
  }

  /**
   * 0196 — 업로드 직전 batch 내 동일 오디오 콘텐츠(SHA-256) 사전 차단.
   * 서로 다른 client_track_id 가 동일 hash → 첫 곡만 업로드, 나머지는 즉시 failed + 서버 로그.
   * 반환: 실제 업로드할 id 목록 + sha 맵(중복 해싱 방지용).
   */
  async function hashAndDedup(ids: string[], batchId: string): Promise<{ uploadIds: string[]; shaById: Map<string, string> }> {
    const shaById = new Map<string, string>();
    const seen = new Map<string, string>(); // sha → first id
    const uploadIds: string[] = [];
    const dupIds: string[] = [];
    const rowsById = new Map(tracks.map((t) => [t.id, t] as const));
    // 순차 해싱 (메모리/CPU 안정성). SHA-256(100MB)는 수백 ms 수준.
    for (const id of ids) {
      const t = rowsById.get(id);
      if (!t) continue;
      let sha: string | null = t.audioSha256 ?? null;
      if (!sha) {
        try { sha = await computeAudioSha256(t.file); }
        catch { sha = null; } // 해싱 실패 시 차단하지 않고 업로드 진행(서버가 재계산)
      }
      if (!sha) { uploadIds.push(id); continue; }
      shaById.set(id, sha);
      const first = seen.get(sha);
      if (first && first !== id) {
        dupIds.push(id);
        patchTrack(id, { status: 'failed', error: '동일한 오디오 콘텐츠가 이 배치의 다른 곡과 중복됩니다 (업로드 차단).' });
        // 관리자 로그 기록 (best-effort)
        void supabase.rpc('record_upload_integrity2', {
          p_batch_id: batchId, p_client_track_id: id, p_track_id: null,
          p_original_filename: t.file.name, p_source_fingerprint: t.fingerprint,
          p_original_sha256: sha, p_final_sha256: null, p_storage_path: null,
          p_duration: null, p_transcoded: false, p_status: 'failed',
          p_error: 'duplicate_audio_in_batch', p_original_filesize: t.file.size,
          p_final_filesize: null, p_transcoding_status: null,
        }).then(undefined, () => {});
      } else {
        seen.set(sha, id);
        uploadIds.push(id);
      }
    }
    if (dupIds.length > 0) {
      toast.warning(`동일 오디오 콘텐츠 ${dupIds.length}곡을 중복으로 차단했어요 (파일명만 다르고 내용이 같음).`);
    }
    return { uploadIds, shaById };
  }

  async function runPool(ids: string[], profile: ArtistProfile | null, batchId: string, shaById: Map<string, string>) {
    const queue = [...ids];
    const worker = async () => {
      while (queue.length > 0) {
        const id = queue.shift();
        if (!id) break;
        const t = tracks.find((x) => x.id === id);
        if (!t) continue;
        patchTrack(id, { status: 'uploading', error: undefined });
        try {
          const res = await uploadOne(t, profile, batchId, shaById);
          if (res.ok) {
            // 표준화 메타데이터(선택형) 저장 — 자동 배치에 사용
            if (res.track_id) {
              try { await setTrackSelectedMetadata(res.track_id, meta); }
              catch (me) { console.warn('[batch] set metadata 실패', me); }
            }
            patchTrack(id, { status: 'success', trackCode: res.track_code });
            if (res.cover_warning) toast.warning(`${t.title}: ${res.cover_warning}`);
          } else {
            patchTrack(id, { status: 'failed', error: res.error ?? '업로드 실패' });
          }
        } catch (e) {
          patchTrack(id, {
            status: 'failed',
            error: e instanceof Error ? e.message : String(e),
          });
          void captureError(e, { scope: 'artist_batch_upload', trackId: id });
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
      const { error: preErr, profile } = await runPreflight();
      if (preErr) {
        toast.error(preErr);
        return;
      }
      setIntegrityWarn(null);
      const batchId = (() => { try { return crypto.randomUUID(); } catch { return `b_${Date.now()}`; } })();
      // 0196 — 업로드 "시작 시점"에 복구 manifest 저장: 업로드 중 새로고침 시 복구 가능하도록.
      setTracks((prev) => {
        const next = prev.map((t) =>
          targets.includes(t.id) ? { ...t, status: 'queued' as TrackStatus, error: undefined } : t,
        );
        saveRecoveryManifest(batchId, next);
        return next;
      });
      // 0196 — 업로드 전 batch 내 동일 콘텐츠 사전 차단
      const { uploadIds, shaById } = await hashAndDedup(targets, batchId);
      if (uploadIds.length > 0) await runPool(uploadIds, profile, batchId, shaById);
      // 결과 요약 + 새로고침 복구 manifest 저장 (state 최신값은 setter 콜백으로 확보)
      setTracks((prev) => {
        const ok = prev.filter((t) => t.status === 'success').length;
        const ng = prev.filter((t) => t.status === 'failed').length;
        if (ng === 0) {
          toast.success(`${ok}곡 업로드 완료. 관리자 검수 후 공개됩니다.`);
        } else {
          toast.warning(`성공 ${ok}곡 · 실패 ${ng}곡. 실패 항목 확인 후 재시도해주세요.`);
        }
        saveRecoveryManifest(batchId, prev);
        return prev;
      });
      // 0194/0196 — 업로드 무결성 self-check: 성공곡 = distinct(콘텐츠 sha) = distinct(path) + NULL sha 0
      let integrityOk = true;
      try {
        const { data } = await supabase.rpc('check_batch_integrity', { p_batch_id: batchId });
        const r = data as { ok?: boolean; success_count?: number; null_sha_count?: number; duplicate_groups?: unknown[] } | null;
        if (r && r.success_count && r.ok === false) {
          integrityOk = false;
          const dupN = Array.isArray(r.duplicate_groups) ? r.duplicate_groups.length : 0;
          setIntegrityWarn(
            `업로드 무결성 검증 실패 — 등록된 곡과 실제 오디오 매핑에 이상이 의심됩니다`
            + `${dupN > 0 ? ` (콘텐츠 중복 그룹 ${dupN}건)` : ''}`
            + `${r.null_sha_count ? ` (콘텐츠 해시 누락 ${r.null_sha_count}건)` : ''}.`
            + ` 아래 대조 리스트를 확인하고, 의심 곡은 내 음원 목록에서 검토/삭제 후 다시 업로드해주세요.`,
          );
          toast.error('업로드 무결성 오류가 감지되었습니다. 대조 리스트를 확인해주세요.');
        }
      } catch { /* best-effort: 검증 실패 시 통과로 간주하지 않고 경고만 */ }
      // 무결성 이상 시 자동 새로고침/닫기(onUploaded) 차단 — 사용자가 직접 검토하도록.
      if (integrityOk) {
        clearRecoveryManifest();
        await onUploaded();
      }
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
      const { error: preErr, profile } = await runPreflight();
      if (preErr) {
        toast.error(preErr);
        return;
      }
      const batchId = (() => { try { return crypto.randomUUID(); } catch { return `b_${Date.now()}`; } })();
      setTracks((prev) => {
        const next = prev.map((t) =>
          failedIds.includes(t.id) ? { ...t, status: 'queued' as TrackStatus, error: undefined } : t,
        );
        saveRecoveryManifest(batchId, next);
        return next;
      });
      const { uploadIds, shaById } = await hashAndDedup(failedIds, batchId);
      if (uploadIds.length > 0) await runPool(uploadIds, profile, batchId, shaById);
      // 완료 후 최신 상태로 manifest 갱신
      setTracks((prev) => { saveRecoveryManifest(batchId, prev); return prev; });
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
      {/* X6.35: 업로드 전 음질 기준 + 자주 반려되는 사유 안내 */}
      <AudioQcGuideCard />
      {quota && (
        <div className={`flex items-center justify-between rounded-xl p-3 text-[11px] leading-relaxed ring-1 ${
          quota.remaining === 0 ? 'bg-rose-500/10 text-rose-700 ring-rose-400/20'
            : quota.remaining <= 5 ? 'bg-amber-500/10 text-amber-700 ring-amber-400/20'
            : 'bg-emerald-500/10 text-emerald-700 ring-emerald-400/20'
        }`}>
          <div>
            <b>이번 달 등록 한도</b>
            <p className="mt-0.5">
              {quota.used} / {quota.quota}곡 사용 ·{' '}
              <b>잔여 {quota.remaining}곡</b>
              {quota.remaining === 0 && ' — 다음 달 1일부터 다시 등록 가능합니다'}
            </p>
          </div>
          <div className="text-right text-[10px] opacity-70">
            <div>~ {new Date(quota.period_end).toLocaleDateString()}</div>
          </div>
        </div>
      )}
      {trust && trust.tier !== 'high' && (
        <div className={`rounded-xl p-3 text-[11px] leading-relaxed ${trust.tier === 'low' ? 'bg-rose-500/10 text-rose-700 ring-1 ring-rose-400/20' : 'bg-amber-500/10 text-amber-700 ring-1 ring-amber-400/20'}`}>
          <b>메타데이터 정확도 안내 (신뢰도 {trust.trust_score})</b>
          <p className="mt-0.5">{trust.guidance}</p>
        </div>
      )}
      {recovery && (
        <div className="rounded-xl bg-amber-500/10 p-3 text-[11px] leading-relaxed text-amber-700 ring-1 ring-amber-400/30 dark:text-amber-200">
          <b>이전 업로드가 완료되지 않았어요.</b>
          <p className="mt-0.5">
            서버 확인 결과 {recovery.registered}곡은 정상 등록됐고, 다음 {recovery.pending.length}곡은 미완료 상태예요:
            {' '}{recovery.pending.slice(0, 5).join(', ')}{recovery.pending.length > 5 ? ' …' : ''}.
            {' '}브라우저 특성상 파일은 자동 복구되지 않으니, 미완료 곡 파일을 다시 선택해 업로드해주세요. (이미 등록된 곡은 중복 차단됩니다.)
          </p>
          <button
            type="button"
            onClick={() => { clearRecoveryManifest(); setRecovery(null); }}
            className="mt-1.5 rounded-md bg-amber-500/20 px-2 py-1 text-[10px] font-semibold hover:bg-amber-500/30"
          >
            확인했어요
          </button>
        </div>
      )}
      {integrityWarn && (
        <div className="rounded-xl bg-rose-500/10 p-3 text-[11px] leading-relaxed text-rose-700 ring-1 ring-rose-400/30 dark:text-rose-200">
          <b>⚠ 업로드 무결성 경고</b>
          <p className="mt-0.5">{integrityWarn}</p>
        </div>
      )}
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

        {/* 선택형 표준 메타데이터 (장르/무드/매장/보컬/시간대) */}
        <TrackMetaSelectors value={meta} onChange={setMeta} disabled={submitting} />

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="flex items-center gap-2 rounded-md bg-bg-soft p-2 text-xs ring-1 ring-line/10">
            <input
              type="checkbox"
              checked={common.explicit}
              onChange={(e) => setCommon({ ...common, explicit: e.target.checked })}
            />
            explicit (19+)
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

      {/* 0196 — 업로드 완료 대조 리스트: 업로드 파일명 ↔ 등록된 곡명/상태 */}
      {(successCount > 0 || failedCount > 0) && (
        <section className="space-y-2 rounded-xl bg-bg-soft/40 p-3 ring-1 ring-line/10">
          <p className="text-xs font-semibold text-ink-mute">대조 리스트 (업로드 파일 ↔ 등록된 곡)</p>
          <ul className="divide-y divide-line/5 text-[11px]">
            {tracks.filter((t) => t.status === 'success' || t.status === 'failed').map((t) => (
              <li key={t.id} className="flex items-center gap-2 py-1.5">
                <StatusBadge status={t.status} trackCode={t.trackCode} />
                <span className="min-w-0 flex-1 truncate" title={t.file.name}>
                  <FileAudio size={10} className="mr-1 inline text-ink-dim" />{t.file.name}
                </span>
                <span className="text-ink-dim">→</span>
                <span className="min-w-0 flex-1 truncate font-semibold" title={t.title}>
                  {t.title}{t.trackCode ? <span className="ml-1 font-mono text-[10px] text-ink-dim">({t.trackCode})</span> : null}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-ink-dim">
            파일명과 등록된 곡 제목이 의도와 일치하는지 확인해주세요. 다르면 내 음원 목록에서 검토/삭제 후 다시 업로드하세요.
          </p>
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
