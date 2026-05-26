/**
 * ArtistBatchUploadForm — 최대 30곡 일괄 업로드 폼 (0195 무결성 레이어 적용).
 *
 * 설계 원칙:
 * - 각 곡은 독립적으로 성공/실패 — 1곡 실패가 다른 곡에 영향 없음(격리).
 * - 곡 식별은 항상 immutable client_track_id(crypto.randomUUID). index/배열 위치 기반 key 금지.
 * - 업로드 단계머신: queued → preparing → transcoding → quality_checking → uploading → submitting → submitted / failed.
 * - batch_id 단위 추적(upload_batches/upload_integrity_logs) + 제출 후 서버 무결성 자가점검.
 * - 새로고침 복구: localStorage 스냅샷 + 서버 batch reconcile(성공곡 식별, 미완료곡은 재선택).
 * - 변환 실패는 원본 fallback 없이 해당 곡만 failed(사유 코드 표시).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Upload, X, CheckCircle2, AlertCircle, Loader2, Copy, FileAudio, Image as ImageIcon, ShieldAlert, RotateCcw } from 'lucide-react';
import {
  uploadArtistTrack,
  validateArtistAudioFile,
  fetchArtistUploadEligibility,
  fetchMyArtistProfile,
  getCurrentUserFast,
  formatEligibilityError,
  getMyMetadataTrust,
  type ReleaseType,
  type ArtistProfile,
} from '@/lib/artistApi';
import { toast } from '@/store/toastStore';
import Alert from '@/components/Alert';
import TrackMetaSelectors from '@/components/artist/TrackMetaSelectors';
import {
  emptySelectedMeta, validateSelectedMeta, setTrackSelectedMetadata, type SelectedMeta,
} from '@/lib/trackMetadataOptions';
import { preflightAudio, type PreflightResult } from '@/lib/audioPreflight';
import {
  newClientTrackId, getBrowserSessionId, recordUploadIntegrity, runBatchIntegrityCheck,
  fetchMyUploadBatch, saveBatchSnapshot, loadBatchSnapshot, clearBatchSnapshot,
  UPLOAD_STATUS_LABELS, FAILURE_REASON_LABELS,
  type UploadStatus, type TranscodeStatus, type BatchIntegrityResult, type FailureReason,
} from '@/lib/uploadIntegrity';

const MAX_TRACKS = 30;
// 업로드(네트워크) 동시성. transcode(CPU/메모리)는 audioTranscode 의 전역 mutex 로 직렬화되므로
// 여기 동시성은 업로드/검수 파이프라인용. iOS 메모리(동시 decode) 안정을 위해 보수적으로 3.
const UPLOAD_CONCURRENCY = 3;

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

const TERMINAL_DONE = (s: UploadStatus) => s === 'submitted';
const IN_FLIGHT = (s: UploadStatus) =>
  s === 'queued' || s === 'preparing' || s === 'transcoding' || s === 'quality_checking' || s === 'uploading' || s === 'submitting';

interface CommonMeta {
  artist: string;
  albumName: string;
  releaseTitle: string;
  releaseDate: string;
  releaseType: ReleaseType;
  rightsHolderName: string;
  explicit: boolean;
  instrumental: boolean;
  coverFile: File | null;
}

interface TrackRow {
  /** immutable — 업로드 시작부터 종료까지 절대 변하지 않음 */
  clientTrackId: string;
  /** 새로고침 복구 시 null (직렬화 불가) → needs_reselect */
  file: File | null;
  title: string;
  artist: string;
  isrc: string;
  lyrics: string;
  explicit: boolean;
  instrumental: boolean;
  rightsHolderName: string;
  coverFile: File | null;
  status: UploadStatus;
  transcodeStatus?: TranscodeStatus;
  failureReason?: string | null;
  trackCode?: string;
  trackId?: string;
  error?: string;
  preflight?: PreflightResult;
}

function initialCommon(): CommonMeta {
  return {
    artist: '', albumName: '', releaseTitle: '', releaseDate: defaultReleaseDate(),
    releaseType: 'single', rightsHolderName: '', explicit: false, instrumental: false, coverFile: null,
  };
}

export default function ArtistBatchUploadForm({
  onUploaded,
}: {
  onUploaded: () => void | Promise<void>;
}) {
  const [common, setCommon] = useState<CommonMeta>(initialCommon);
  const [meta, setMeta] = useState<SelectedMeta>(emptySelectedMeta);
  const [trust, setTrust] = useState<{ trust_score: number; tier: 'high' | 'medium' | 'low'; guidance: string } | null>(null);
  useEffect(() => { getMyMetadataTrust().then(setTrust).catch(() => {}); }, []);
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string>(() => crypto.randomUUID());
  const [integrity, setIntegrity] = useState<BatchIntegrityResult | null>(null);
  const [recovered, setRecovered] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const sessionId = useMemo(() => getBrowserSessionId(), []);

  const successCount = useMemo(() => tracks.filter((t) => TERMINAL_DONE(t.status)).length, [tracks]);
  const failedCount = useMemo(() => tracks.filter((t) => t.status === 'failed').length, [tracks]);
  const needsReselectCount = useMemo(() => tracks.filter((t) => t.status === 'needs_reselect').length, [tracks]);
  const inFlightCount = useMemo(() => tracks.filter((t) => IN_FLIGHT(t.status)).length, [tracks]);
  const integrityBlocked = integrity != null && !integrity.ok;

  function patchTrack(clientTrackId: string, patch: Partial<TrackRow>) {
    setTracks((prev) => prev.map((t) => (t.clientTrackId === clientTrackId ? { ...t, ...patch } : t)));
  }

  // ---- 새로고침 복구: localStorage 스냅샷 + 서버 reconcile ----
  useEffect(() => {
    const snap = loadBatchSnapshot();
    if (!snap || snap.rows.length === 0) return;
    let alive = true;
    (async () => {
      let serverLogs: Awaited<ReturnType<typeof fetchMyUploadBatch>> = null;
      try { serverLogs = await fetchMyUploadBatch(snap.batchId); } catch { /* 비로그인/네트워크 */ }
      if (!alive) return;
      const byClient = new Map((serverLogs?.logs ?? []).map((l) => [l.client_track_id, l]));
      const restored: TrackRow[] = snap.rows.map((r) => {
        const server = byClient.get(r.clientTrackId);
        const submitted = (server?.created_track_id != null) || server?.upload_status === 'submitted' || r.uploadStatus === 'submitted';
        return {
          clientTrackId: r.clientTrackId,
          file: null, // File 은 직렬화 불가 → 복구 불가
          title: titleFromFilename(r.originalFilename || '복구된 곡'),
          artist: '', isrc: '', lyrics: '', explicit: false, instrumental: false, rightsHolderName: '', coverFile: null,
          status: submitted ? 'submitted' : 'needs_reselect',
          transcodeStatus: (server?.transcode_status ?? r.transcodeStatus ?? undefined) as TranscodeStatus | undefined,
          failureReason: server?.failure_reason ?? r.failureReason ?? null,
          trackId: server?.created_track_id ?? r.createdTrackId ?? undefined,
          error: submitted ? undefined : '새로고침으로 파일 정보가 유실됐어요. 파일을 다시 선택하면 이어서 업로드할 수 있어요.',
        };
      });
      setBatchId(snap.batchId);
      setTracks(restored);
      setRecovered(true);
      const ok = restored.filter((t) => t.status === 'submitted').length;
      const re = restored.filter((t) => t.status === 'needs_reselect').length;
      toast.info(`이전 업로드 세션 복구 — 완료 ${ok}곡 · 재선택 필요 ${re}곡`);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- 스냅샷 저장 (상태 변할 때마다) ----
  useEffect(() => {
    if (tracks.length === 0) { clearBatchSnapshot(); return; }
    saveBatchSnapshot({
      batchId, browserSessionId: sessionId, updatedAt: Date.now(),
      rows: tracks.map((t) => ({
        clientTrackId: t.clientTrackId,
        originalFilename: t.file?.name ?? t.title,
        uploadStatus: t.status,
        transcodeStatus: t.transcodeStatus ?? null,
        failureReason: t.failureReason ?? null,
        createdTrackId: t.trackId ?? null,
        sha256: null,
      })),
    });
  }, [tracks, batchId, sessionId]);

  // 업로드 진행 중 탭 닫힘/새로고침 방지 경고
  useEffect(() => {
    if (!submitting && inFlightCount === 0) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [submitting, inFlightCount]);

  async function onPickFiles(files: FileList | null) {
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
      if (!v.ok) { rejected.push(`${f.name}: ${v.error}`); continue; }
      rows.push({
        clientTrackId: newClientTrackId(),
        file: f,
        title: titleFromFilename(f.name),
        artist: '', isrc: '', lyrics: '', explicit: false, instrumental: false, rightsHolderName: '', coverFile: null,
        status: 'queued',
      });
    }
    if (rejected.length > 0) {
      toast.warning(`${rejected.length}개 파일 제외:\n${rejected.slice(0, 3).join('\n')}${rejected.length > 3 ? '\n…' : ''}`);
    }
    if (rows.length > 0) setTracks((prev) => [...prev, ...rows]);
    if (fileRef.current) fileRef.current.value = '';

    // 사전 검사(preflight) — 헤더만 읽어 위험 파일 조기 경고 + mp3 pass-through 판정
    let riskCount = 0;
    for (const r of rows) {
      try {
        const pf = await preflightAudio(r.file as File);
        patchTrack(r.clientTrackId, { preflight: pf });
        if (pf.level === 'risk') riskCount += 1;
      } catch { /* preflight 실패는 무시 — 파이프라인이 최종 판정 */ }
    }
    if (riskCount > 0) {
      toast.warning(`${riskCount}곡은 형식 인식이 어려워요. 업로드 시 변환/검사에서 실패할 수 있어요.`);
    }
  }

  // 재선택: needs_reselect 곡에 파일을 다시 붙임 (client_track_id 유지 → 중복 생성 방지)
  function reselectFile(clientTrackId: string, file: File | null) {
    if (!file) return;
    const v = validateArtistAudioFile(file);
    if (!v.ok) { toast.error(v.error ?? '지원하지 않는 파일'); return; }
    patchTrack(clientTrackId, { file, status: 'queued', error: undefined, failureReason: null, title: titleFromFilename(file.name) });
    preflightAudio(file).then((pf) => patchTrack(clientTrackId, { preflight: pf })).catch(() => {});
  }

  function removeRow(clientTrackId: string) {
    setTracks((prev) => prev.filter((t) => t.clientTrackId !== clientTrackId));
  }

  function clearAll() {
    if (submitting) return;
    if (tracks.length === 0) return;
    if (!confirm('선택한 모든 곡을 제거하고 새 배치를 시작할까요?')) return;
    setTracks([]);
    setIntegrity(null);
    setRecovered(false);
    clearBatchSnapshot();
    setBatchId(crypto.randomUUID());
  }

  function applyCommonToAll(mode: 'all' | 'empty') {
    setTracks((prev) =>
      prev.map((t) => ({
        ...t,
        artist: mode === 'all' || !t.artist.trim() ? common.artist : t.artist,
        rightsHolderName: mode === 'all' || !t.rightsHolderName.trim() ? common.rightsHolderName : t.rightsHolderName,
        explicit: mode === 'all' ? common.explicit : t.explicit,
        instrumental: mode === 'all' ? common.instrumental : t.instrumental,
        coverFile: mode === 'all' ? common.coverFile : t.coverFile ?? common.coverFile,
      })),
    );
    toast.success(mode === 'all' ? '모든 곡에 공통 메타 적용' : '비어있는 항목에만 적용');
  }

  function validateBeforeSubmit(targets: TrackRow[]): string | null {
    if (targets.length === 0) return '업로드할 곡이 없어요';
    if (!common.albumName.trim()) return '공통 앨범명을 입력해주세요';
    if (!common.releaseDate) return '공통 발매일을 선택해주세요';
    const min = new Date();
    min.setDate(min.getDate() + 3);
    min.setHours(0, 0, 0, 0);
    if (new Date(common.releaseDate) < min) return '발매일은 오늘 기준 최소 3일 뒤부터 선택할 수 있어요';
    const metaErr = validateSelectedMeta(meta);
    if (metaErr) return `공통 메타데이터: ${metaErr}`;
    if (!rightsConfirmed) return '권리 확인 체크박스를 동의해주세요';
    const hasCommonCover = !!common.coverFile;
    for (const t of targets) {
      if (!t.file) return `파일 재선택 필요: ${t.title}`;
      if (!t.title.trim()) return `곡 제목 미입력: ${t.file.name}`;
      if (!(t.coverFile || hasCommonCover)) {
        return `앨범 자켓 미등록: ${t.file.name} (공통 자켓을 올리거나 개별 자켓을 지정해주세요)`;
      }
    }
    return null;
  }

  async function uploadOne(t: TrackRow, profile: ArtistProfile | null) {
    const pf = t.preflight;
    return uploadArtistTrack({
      title: t.title.trim(),
      artist: (t.artist.trim() || common.artist.trim()) || undefined,
      album_name: common.albumName.trim(),
      release_title: common.releaseTitle.trim() || common.albumName.trim(),
      release_type: common.releaseType,
      release_date: common.releaseDate,
      isrc: t.isrc.trim() || undefined,
      rights_holder_name: (t.rightsHolderName.trim() || common.rightsHolderName.trim()) || undefined,
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
      skipEligibilityCheck: true,
      prefetchedProfile: profile,
      skipPayoutCheck: true,
      // 0195 무결성 레이어
      preflightPassThrough: pf?.mp3PassThrough ?? false,
      onStage: (ev) => {
        // 항상 로컬 UI 갱신
        patchTrack(t.clientTrackId, {
          status: ev.status,
          transcodeStatus: ev.transcodeStatus,
          failureReason: (ev.detail?.reason as string | undefined) ?? undefined,
        });
        // 서버 기록은 부하/경합을 줄이기 위해 진행 전이(시작/변환)만.
        // 종료(submitted/failed)는 runPool 에서 sha/track_id/storage_path 와 함께 1회 확정 기록.
        if (ev.status === 'preparing' || ev.status === 'transcoding') {
          void recordUploadIntegrity({
            batchId,
            clientTrackId: t.clientTrackId,
            browserSessionId: sessionId,
            originalFilename: t.file?.name ?? null,
            fileSize: t.file?.size ?? null,
            mimeType: t.file?.type ?? null,
            transcodeStatus: ev.transcodeStatus ?? null,
            uploadStatus: ev.status,
            detail: ev.detail ?? null,
          });
        }
      },
    });
  }

  async function runPreflight(): Promise<{ error: string | null; profile: ArtistProfile | null }> {
    try {
      const me = await getCurrentUserFast();
      if (!me?.id) return { error: '로그인 정보 확인이 지연됐어요. 새로고침 후 다시 시도해주세요.', profile: null };
      const [elig, profile] = await Promise.all([fetchArtistUploadEligibility(), fetchMyArtistProfile(me.id)]);
      if (!elig.can_upload) return { error: formatEligibilityError(elig.reasons), profile: null };
      if (!profile || profile.approval_status !== 'approved') return { error: '승인된 아티스트만 업로드할 수 있어요.', profile: null };
      return { error: null, profile };
    } catch {
      return { error: '계정 상태 확인이 지연되었습니다. 다시 시도해주세요.', profile: null };
    }
  }

  // 동시 CONCURRENCY 개. 각 곡은 독립 try/catch — 1곡 실패가 다른 곡에 영향 없음.
  async function runPool(rowsSnapshot: TrackRow[], profile: ArtistProfile | null) {
    const queue = [...rowsSnapshot];
    const worker = async () => {
      while (queue.length > 0) {
        const t = queue.shift();
        if (!t) break;
        patchTrack(t.clientTrackId, { status: 'preparing', error: undefined, failureReason: null });
        try {
          const res = await uploadOne(t, profile);
          if (res.ok) {
            if (res.track_id) {
              try { await setTrackSelectedMetadata(res.track_id, meta); }
              catch (me) { console.warn('[batch] set metadata 실패', me); }
              // 최종 sha + track_id + storage_path 확정 기록 (await — 무결성 점검 전 커밋 보장)
              await recordUploadIntegrity({
                batchId, clientTrackId: t.clientTrackId, browserSessionId: sessionId,
                sha256: res.sha256 ?? null, transcodeStatus: res.transcode_status ?? null,
                storagePath: res.storage_path ?? null,
                uploadStatus: 'submitted', createdTrackId: res.track_id,
              });
            }
            patchTrack(t.clientTrackId, { status: 'submitted', trackCode: res.track_code, trackId: res.track_id, transcodeStatus: res.transcode_status, failureReason: null, error: undefined });
            if (res.cover_warning) toast.warning(`${t.title}: ${res.cover_warning}`);
          } else {
            // 실패 확정 기록 (사유 + storage_path → orphan 추적)
            void recordUploadIntegrity({
              batchId, clientTrackId: t.clientTrackId, browserSessionId: sessionId,
              sha256: res.sha256 ?? null, transcodeStatus: res.transcode_status ?? null,
              storagePath: res.storage_path ?? null,
              uploadStatus: 'failed', failureReason: (res.failure_reason as FailureReason | undefined) ?? 'unknown',
            });
            patchTrack(t.clientTrackId, { status: 'failed', error: res.error ?? '업로드 실패', failureReason: res.failure_reason ?? 'unknown', transcodeStatus: res.transcode_status });
          }
        } catch (e) {
          void recordUploadIntegrity({
            batchId, clientTrackId: t.clientTrackId, browserSessionId: sessionId,
            uploadStatus: 'failed', failureReason: 'unknown',
          });
          patchTrack(t.clientTrackId, { status: 'failed', error: e instanceof Error ? e.message : String(e), failureReason: 'unknown' });
        }
      }
    };
    await Promise.all(Array.from({ length: UPLOAD_CONCURRENCY }, () => worker()));
  }

  async function runBatch(targets: TrackRow[]) {
    const err = validateBeforeSubmit(targets);
    if (err) { toast.error(err); return; }
    setSubmitting(true);
    try {
      const { error: preErr, profile } = await runPreflight();
      if (preErr) { toast.error(preErr); return; }
      const ids = new Set(targets.map((t) => t.clientTrackId));
      setTracks((prev) => prev.map((t) => (ids.has(t.clientTrackId) ? { ...t, status: 'queued', error: undefined, failureReason: null } : t)));
      await runPool(targets, profile);

      // 제출 후 서버 무결성 자가점검 — hard issue 면 batch integrity_failed → 재제출 차단
      try {
        const result = await runBatchIntegrityCheck(batchId);
        setIntegrity(result);
        if (!result.ok) {
          toast.error(`업로드 무결성 점검에서 ${result.hard}건의 문제가 발견됐어요. 관리자 확인 전까지 추가 제출이 제한됩니다.`);
        }
      } catch (e) {
        console.warn('[batch] integrity check 실패', e);
      }

      setTracks((prev) => {
        const ok = prev.filter((t) => t.status === 'submitted').length;
        const ng = prev.filter((t) => t.status === 'failed').length;
        if (ng === 0) toast.success(`${ok}곡 업로드 완료. 관리자 검수 후 공개됩니다.`);
        else toast.warning(`성공 ${ok}곡 · 실패 ${ng}곡. 실패 항목 확인 후 재시도해주세요.`);
        return prev;
      });
      await onUploaded();
    } finally {
      setSubmitting(false);
    }
  }

  async function onSubmit() {
    if (integrityBlocked) { toast.error('무결성 점검 실패 배치입니다. 관리자 확인 후 진행해주세요.'); return; }
    // 성공(submitted)/재선택필요 제외 — 성공곡 재업로드 방지
    const targets = tracks.filter((t) => t.status !== 'submitted' && t.status !== 'needs_reselect' && t.file);
    if (targets.length === 0) { toast.info('업로드할 곡이 없어요 (모두 완료 또는 재선택 필요)'); return; }
    await runBatch(targets);
  }

  async function retryFailed() {
    if (integrityBlocked) { toast.error('무결성 점검 실패 배치입니다. 관리자 확인 후 진행해주세요.'); return; }
    const targets = tracks.filter((t) => t.status === 'failed' && t.file);
    if (targets.length === 0) { toast.info('재시도할 실패 곡이 없어요 (파일 재선택이 필요한 곡 포함)'); return; }
    await runBatch(targets);
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void onSubmit(); }} className="space-y-4 rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
      {trust && trust.tier !== 'high' && (
        <div className={`rounded-xl p-3 text-[11px] leading-relaxed ${trust.tier === 'low' ? 'bg-rose-500/10 text-rose-700 ring-1 ring-rose-400/20' : 'bg-amber-500/10 text-amber-700 ring-1 ring-amber-400/20'}`}>
          <b>메타데이터 정확도 안내 (신뢰도 {trust.trust_score})</b>
          <p className="mt-0.5">{trust.guidance}</p>
        </div>
      )}

      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-bold">
          <Upload size={14} className="text-accent" /> 일괄 업로드 (최대 {MAX_TRACKS}곡)
        </h2>
        <span className="text-[11px] text-ink-mute">
          {tracks.length} / {MAX_TRACKS} 곡
          {(successCount > 0 || failedCount > 0) && (<> · 완료 {successCount} · 실패 {failedCount}</>)}
          {needsReselectCount > 0 && <> · 재선택 {needsReselectCount}</>}
        </span>
      </header>

      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-bg-soft/50 px-2.5 py-1.5 text-[10px] text-ink-dim ring-1 ring-line/10">
        <span className="font-semibold text-ink-mute">batch</span>
        <code className="font-mono text-[10px] text-accent">{batchId.slice(0, 8)}…{batchId.slice(-4)}</code>
        {recovered && <span className="rounded bg-sky-500/15 px-1.5 py-0.5 font-semibold text-sky-600">이전 세션 복구됨</span>}
        {integrity && (
          <span className={`rounded px-1.5 py-0.5 font-semibold ${integrity.ok ? 'bg-emerald-500/15 text-emerald-600' : 'bg-rose-500/15 text-rose-600'}`}>
            무결성 {integrity.ok ? '정상' : `실패(${integrity.hard})`}
          </span>
        )}
      </div>

      {integrityBlocked && (
        <Alert tone="error" title="무결성 점검 실패 — 관리자 확인 필요">
          <p className="text-[11px]">이 배치에서 데이터 무결성 문제가 발견되어 추가 제출이 차단되었습니다. 운영팀에 batch ID <code className="font-mono">{batchId.slice(0, 8)}</code> 를 전달해주세요.</p>
          <ul className="mt-1 list-disc pl-4 text-[10px]">
            {integrity?.issues.slice(0, 5).map((i, idx) => <li key={idx}>{i.type} ({i.severity})</li>)}
          </ul>
        </Alert>
      )}

      {/* Step 1 — 파일 선택 */}
      <section className="space-y-2">
        <p className="text-xs font-semibold text-ink-mute">1. 음원 파일 선택 (mp3 / wav / m4a / flac, 곡당 100MB 이하)</p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-accent/15 px-3 py-2 text-xs font-semibold text-accent hover:bg-accent/25">
            <FileAudio size={14} /> 파일 추가
            <input ref={fileRef} type="file" accept=".mp3,.wav,.flac,.m4a,audio/*" multiple className="hidden"
              onChange={(e) => void onPickFiles(e.target.files)} disabled={submitting || tracks.length >= MAX_TRACKS} />
          </label>
          {tracks.length > 0 && (
            <button type="button" onClick={clearAll} disabled={submitting}
              className="rounded-lg bg-bg-soft px-3 py-2 text-xs font-semibold text-ink-mute ring-1 ring-line/10 hover:text-red-400 disabled:opacity-50">
              전체 비우기 (새 배치)
            </button>
          )}
        </div>
        {tracks.length === 0 && (
          <p className="text-[11px] text-ink-dim">여러 곡을 한꺼번에 선택할 수 있어요. 같은 음원 파일은 중복 차단됩니다.</p>
        )}
      </section>

      {/* Step 2 — 공통 메타데이터 */}
      <section className="space-y-2 rounded-xl bg-bg-soft/50 p-3 ring-1 ring-line/10">
        <p className="text-xs font-semibold text-ink-mute">2. 공통 메타데이터</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Field label="대표 아티스트명">
            <input type="text" value={common.artist} onChange={(e) => setCommon({ ...common, artist: e.target.value })} placeholder="(기본: 프로필 아티스트명)" className="input" />
          </Field>
          <Field label="앨범명 *">
            <input type="text" required value={common.albumName} onChange={(e) => setCommon({ ...common, albumName: e.target.value })} className="input" />
          </Field>
          <Field label="발매명">
            <input type="text" value={common.releaseTitle} onChange={(e) => setCommon({ ...common, releaseTitle: e.target.value })} placeholder="(기본: 앨범명)" className="input" />
          </Field>
          <Field label="발매 타입">
            <select value={common.releaseType} onChange={(e) => setCommon({ ...common, releaseType: e.target.value as ReleaseType })} className="input">
              <option value="single">single</option>
              <option value="ep">ep</option>
              <option value="album">album</option>
            </select>
          </Field>
          <Field label="발매일 * (today+3 이상)">
            <input type="date" required value={common.releaseDate} min={defaultReleaseDate()} onChange={(e) => setCommon({ ...common, releaseDate: e.target.value })} className="input" />
          </Field>
          <Field label="권리자명">
            <input type="text" value={common.rightsHolderName} onChange={(e) => setCommon({ ...common, rightsHolderName: e.target.value })} placeholder="(기본: 본명)" className="input" />
          </Field>
        </div>

        <TrackMetaSelectors value={meta} onChange={setMeta} disabled={submitting} />

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="flex items-center gap-2 rounded-md bg-bg-soft p-2 text-xs ring-1 ring-line/10">
            <input type="checkbox" checked={common.explicit} onChange={(e) => setCommon({ ...common, explicit: e.target.checked })} />
            explicit (19+)
          </label>
          <label className="flex items-center gap-2 rounded-md bg-bg-soft p-2 text-xs ring-1 ring-line/10 cursor-pointer hover:bg-bg-soft/80">
            <ImageIcon size={12} className="text-ink-dim" />
            <span className="flex-1 truncate">{common.coverFile ? common.coverFile.name : '공통 커버 이미지 (선택)'}</span>
            <input type="file" accept="image/*" className="hidden" onChange={(e) => setCommon({ ...common, coverFile: e.target.files?.[0] ?? null })} />
          </label>
        </div>
        {tracks.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" onClick={() => applyCommonToAll('all')} disabled={submitting} className="inline-flex items-center gap-1 rounded-md bg-accent/15 px-2.5 py-1.5 text-[11px] font-semibold text-accent hover:bg-accent/25 disabled:opacity-50">
              <Copy size={11} /> 모든 곡에 적용
            </button>
            <button type="button" onClick={() => applyCommonToAll('empty')} disabled={submitting} className="inline-flex items-center gap-1 rounded-md bg-bg-soft px-2.5 py-1.5 text-[11px] font-semibold text-ink-mute ring-1 ring-line/10 hover:text-ink disabled:opacity-50">
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
            {tracks.map((t, idx) => {
              const locked = t.status === 'submitted' || IN_FLIGHT(t.status);
              return (
                <li key={t.clientTrackId} className="rounded-lg bg-bg-soft/40 ring-1 ring-line/10">
                  <div className="flex items-center gap-2 p-2">
                    <span className="w-6 shrink-0 text-center text-[11px] font-mono text-ink-dim">{idx + 1}</span>
                    <StatusBadge status={t.status} failureReason={t.failureReason} transcodeStatus={t.transcodeStatus} trackCode={t.trackCode} />
                    <input type="text" value={t.title} onChange={(e) => patchTrack(t.clientTrackId, { title: e.target.value })} placeholder="곡 제목"
                      disabled={submitting || locked} className="input flex-1 min-w-0 text-[12px]" />
                    {t.file && <span className="hidden shrink-0 truncate text-[10px] text-ink-dim sm:inline-block max-w-[140px]">{t.file.name}</span>}
                    {t.file && <span className="shrink-0 text-[10px] text-ink-dim">{formatFileSize(t.file.size)}</span>}
                    {t.preflight && t.preflight.level !== 'ok' && (
                      <ShieldAlert size={13} className={t.preflight.level === 'risk' ? 'text-rose-500' : 'text-amber-500'} aria-label="사전 검사 경고" />
                    )}
                    {t.status === 'needs_reselect' && (
                      <label className="inline-flex cursor-pointer items-center gap-1 rounded bg-sky-500/15 px-2 py-1 text-[10px] font-semibold text-sky-600 hover:bg-sky-500/25">
                        <RotateCcw size={10} /> 파일 재선택
                        <input type="file" accept=".mp3,.wav,.flac,.m4a,audio/*" className="hidden" disabled={submitting}
                          onChange={(e) => reselectFile(t.clientTrackId, e.target.files?.[0] ?? null)} />
                      </label>
                    )}
                    <button type="button" onClick={() => setExpanded(expanded === t.clientTrackId ? null : t.clientTrackId)}
                      className="rounded p-1 text-[10px] text-ink-dim hover:bg-bg-soft hover:text-ink">
                      {expanded === t.clientTrackId ? '닫기' : '더보기'}
                    </button>
                    {t.status !== 'submitted' && !IN_FLIGHT(t.status) && (
                      <button type="button" onClick={() => removeRow(t.clientTrackId)} disabled={submitting} aria-label="제거"
                        className="rounded p-1 text-ink-dim hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50">
                        <X size={14} />
                      </button>
                    )}
                  </div>
                  {expanded === t.clientTrackId && (
                    <div className="space-y-2 border-t border-line/10 p-2">
                      {t.preflight && t.preflight.reasons.length > 0 && (
                        <div className="rounded-md bg-amber-500/10 p-2 text-[10px] text-amber-700 dark:text-amber-300">
                          {t.preflight.sniff.container.toUpperCase()}
                          {t.preflight.sniff.sampleRate ? ` · ${(t.preflight.sniff.sampleRate / 1000).toFixed(1)}kHz` : ''}
                          {t.preflight.sniff.channels ? ` · ${t.preflight.sniff.channels === 1 ? 'mono' : 'stereo'}` : ''}
                          {t.preflight.sniff.bitrateKbps ? ` · ${t.preflight.sniff.bitrateKbps}kbps` : ''}
                          {t.preflight.mp3PassThrough && <span className="ml-1 font-semibold text-emerald-600">· 변환 생략(pass-through)</span>}
                          <ul className="mt-1 list-disc pl-4">{t.preflight.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
                        </div>
                      )}
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <Field label="참여 아티스트">
                          <input type="text" value={t.artist} onChange={(e) => patchTrack(t.clientTrackId, { artist: e.target.value })} placeholder="(기본: 공통값)" className="input text-[12px]" disabled={submitting || locked} />
                        </Field>
                        <Field label="ISRC">
                          <input type="text" value={t.isrc} onChange={(e) => patchTrack(t.clientTrackId, { isrc: e.target.value.toUpperCase() })} placeholder="예: KRA012500001" className="input text-[12px] font-mono" disabled={submitting || locked} />
                        </Field>
                        <Field label="권리자명 (곡별)">
                          <input type="text" value={t.rightsHolderName} onChange={(e) => patchTrack(t.clientTrackId, { rightsHolderName: e.target.value })} placeholder="(기본: 공통값)" className="input text-[12px]" disabled={submitting || locked} />
                        </Field>
                        <label className="flex cursor-pointer items-center gap-2 rounded-md bg-bg-soft p-2 text-[12px] ring-1 ring-line/10">
                          <ImageIcon size={12} className="text-ink-dim" />
                          <span className="flex-1 truncate">{t.coverFile ? t.coverFile.name : '곡별 커버 이미지 (선택)'}</span>
                          <input type="file" accept="image/*" className="hidden" disabled={submitting || locked} onChange={(e) => patchTrack(t.clientTrackId, { coverFile: e.target.files?.[0] ?? null })} />
                        </label>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="flex items-center gap-2 rounded-md bg-bg-soft p-2 text-[12px] ring-1 ring-line/10">
                          <input type="checkbox" checked={t.explicit} onChange={(e) => patchTrack(t.clientTrackId, { explicit: e.target.checked })} disabled={submitting || locked} />
                          explicit
                        </label>
                        <label className="flex items-center gap-2 rounded-md bg-bg-soft p-2 text-[12px] ring-1 ring-line/10">
                          <input type="checkbox" checked={t.instrumental} onChange={(e) => patchTrack(t.clientTrackId, { instrumental: e.target.checked })} disabled={submitting || locked} />
                          instrumental
                        </label>
                      </div>
                      <Field label="가사 (선택)">
                        <textarea rows={3} value={t.lyrics} onChange={(e) => patchTrack(t.clientTrackId, { lyrics: e.target.value })} disabled={submitting || locked} className="input text-[12px]" />
                      </Field>
                    </div>
                  )}
                  {t.error && (
                    <div className="border-t border-line/10 p-2">
                      <Alert tone={t.status === 'needs_reselect' ? 'warning' : 'error'} title={t.failureReason ? (FAILURE_REASON_LABELS[t.failureReason] ?? '실패 사유') : '안내'}>{t.error}</Alert>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Step 4 — 권리 확인 */}
      <section className="space-y-2">
        <label className="flex cursor-pointer items-start gap-2 rounded-lg bg-bg-soft p-3 text-[12px] ring-1 ring-line/10">
          <input type="checkbox" checked={rightsConfirmed} onChange={(e) => setRightsConfirmed(e.target.checked)} disabled={submitting} className="mt-0.5" />
          <span>
            본인은 위 모든 곡의 <strong className="text-accent">저작권·저작인접권 권리자</strong> 본인 또는 정당한 권리자임을 확인하며,
            허위 등록 시 발생하는 모든 법적·민형사상 책임은 본인에게 있음에 동의합니다.
          </span>
        </label>
      </section>

      {/* Step 5 — 제출 */}
      <section className="space-y-2">
        {failedCount > 0 && !submitting && (
          <button type="button" onClick={() => void retryFailed()} disabled={integrityBlocked}
            className="w-full rounded-xl bg-amber-500/15 py-2.5 text-sm font-bold text-amber-700 ring-1 ring-amber-400/30 hover:bg-amber-500/25 disabled:opacity-50 dark:text-amber-200">
            실패한 {failedCount}곡만 재시도
          </button>
        )}
        <button type="submit" disabled={submitting || tracks.length === 0 || integrityBlocked} className="btn-primary w-full py-3 text-sm font-bold">
          {submitting ? `업로드 중… (${inFlightCount}곡 진행 중)` : `총 ${tracks.filter((t) => t.status !== 'submitted').length}곡 제출`}
        </button>
        <p className="text-[11px] text-ink-dim">
          동시 업로드 {UPLOAD_CONCURRENCY}개씩 처리되며(변환은 메모리 보호를 위해 순차), 각 곡은 독립적으로 성공/실패합니다.
          변환 실패 곡은 격리되어 사유와 함께 표시되고, 실패한 곡만 재시도할 수 있어요.
        </p>
        {(submitting || inFlightCount > 0) && (
          <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-300">
            업로드가 끝날 때까지 창을 닫거나 새로고침하지 마세요. (새로고침해도 완료된 곡은 복구되지만 진행 중 곡은 파일 재선택이 필요해요.)
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

function StatusBadge({ status, failureReason, transcodeStatus, trackCode }: {
  status: UploadStatus; failureReason?: string | null; transcodeStatus?: TranscodeStatus; trackCode?: string;
}) {
  const label = UPLOAD_STATUS_LABELS[status] ?? status;
  if (status === 'submitted') {
    return (
      <span title={trackCode ?? '제출 완료'} className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 size={10} /> {label}{transcodeStatus === 'passthrough' && ' · 원본MP3'}
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span title={failureReason ? FAILURE_REASON_LABELS[failureReason] ?? failureReason : undefined}
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-700 dark:text-red-300">
        <AlertCircle size={10} /> {label}{failureReason ? ` · ${failureReason}` : ''}
      </span>
    );
  }
  if (status === 'needs_reselect') {
    return <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:text-sky-300">{label}</span>;
  }
  if (IN_FLIGHT(status)) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:text-sky-300">
        <Loader2 size={10} className="animate-spin" /> {label}
      </span>
    );
  }
  return <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-bg-soft px-2 py-0.5 text-[10px] font-semibold text-ink-dim ring-1 ring-line/10">{label}</span>;
}
