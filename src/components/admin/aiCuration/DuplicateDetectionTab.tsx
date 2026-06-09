import { Fragment, useCallback, useEffect, useState } from 'react';
import { RefreshCw, Play } from 'lucide-react';
import {
  adminFindDuplicateTracks,
  adminFindAllDuplicateCandidates,
  adminFingerprintFailureSummary,
  adminListFingerprintFailures,
  adminResetFingerprintFailure,
  adminListCorruptionCandidates,
  adminMarkFingerprintQcRisk,
  type DuplicateCandidate,
  type FingerprintFailureSummary,
  type FingerprintFailureRow,
  type CorruptionCandidate,
} from '@/lib/aiCuration';
import { toast } from '@/store/toastStore';

export default function DuplicateDetectionTab() {
  const [threshold, setThreshold] = useState(0.85);
  const [durationTolerance, setDurationTolerance] = useState(3.0);
  const [maxResults, setMaxResults] = useState(100);
  const [rows, setRows] = useState<DuplicateCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [singleTrackId, setSingleTrackId] = useState('');
  const [openCompareKey, setOpenCompareKey] = useState<string | null>(null);
  // 0244 — fingerprint 상태 패널
  const [fpSummary, setFpSummary] = useState<FingerprintFailureSummary | null>(null);
  const [fpFailures, setFpFailures] = useState<FingerprintFailureRow[]>([]);
  const [showFailures, setShowFailures] = useState(false);
  const [onlyExhausted, setOnlyExhausted] = useState(false);
  const [fpBusy, setFpBusy] = useState(false);

  const fmtDuration = (s: number | null): string => {
    if (s == null) return '—';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };
  const fmtSimilarity = (v: number): string => `${(v * 100).toFixed(1)}%`;
  const fmtBytes = (b: number | null): string => {
    if (b == null) return '—';
    if (b < 1024) return `${b}B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)}KB`;
    return `${(b / 1024 / 1024).toFixed(1)}MB`;
  };

  const loadFpSummary = useCallback(async () => {
    try {
      const s = await adminFingerprintFailureSummary();
      setFpSummary(s);
    } catch (e) {
      console.warn('[fp-summary]', e);
    }
  }, []);

  const loadFpFailures = useCallback(async () => {
    setFpBusy(true);
    try {
      const list = await adminListFingerprintFailures(200, onlyExhausted);
      setFpFailures(list);
    } catch (e) {
      toast.error(`실패 목록 조회 실패: ${(e as Error).message}`);
    } finally {
      setFpBusy(false);
    }
  }, [onlyExhausted]);

  useEffect(() => { void loadFpSummary(); }, [loadFpSummary]);
  useEffect(() => { if (showFailures) void loadFpFailures(); }, [showFailures, loadFpFailures]);

  const resetFailure = async (trackId: string) => {
    if (!confirm('이 트랙의 실패 기록을 삭제하고 재시도 가능 상태로 되돌리시겠어요?')) return;
    setFpBusy(true);
    try {
      await adminResetFingerprintFailure(trackId);
      toast.success('재시도 가능 상태로 초기화.');
      await Promise.all([loadFpSummary(), loadFpFailures()]);
    } catch (e) {
      toast.error(`초기화 실패: ${(e as Error).message}`);
    } finally {
      setFpBusy(false);
    }
  };

  // 0245 — 손상 음원 후보 큐
  const [corruption, setCorruption] = useState<CorruptionCandidate[]>([]);
  const [showCorruption, setShowCorruption] = useState(false);
  const [corrBusy, setCorrBusy] = useState(false);
  const [probeResults, setProbeResults] = useState<Record<string, { playable: boolean; duration?: number; error?: string; ms: number }>>({});

  const loadCorruption = useCallback(async () => {
    setCorrBusy(true);
    try {
      const list = await adminListCorruptionCandidates(200, false);
      setCorruption(list);
    } catch (e) {
      toast.error(`손상 후보 조회 실패: ${(e as Error).message}`);
    } finally {
      setCorrBusy(false);
    }
  }, []);

  useEffect(() => { if (showCorruption) void loadCorruption(); }, [showCorruption, loadCorruption]);

  // HTML5 Audio 로 재생 가능 여부 probe (브라우저 디코딩)
  const probePlayability = useCallback((trackId: string, url: string) => {
    if (!url) return;
    const t0 = performance.now();
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.crossOrigin = 'anonymous';
    const cleanup = () => { audio.src = ''; audio.removeAttribute('src'); };
    const timer = window.setTimeout(() => {
      cleanup();
      setProbeResults((prev) => ({ ...prev, [trackId]: { playable: false, error: 'timeout (10s)', ms: Math.round(performance.now() - t0) } }));
    }, 10000);
    audio.addEventListener('loadedmetadata', () => {
      window.clearTimeout(timer);
      const dur = isFinite(audio.duration) ? audio.duration : undefined;
      cleanup();
      setProbeResults((prev) => ({ ...prev, [trackId]: { playable: true, duration: dur, ms: Math.round(performance.now() - t0) } }));
    }, { once: true });
    audio.addEventListener('error', () => {
      window.clearTimeout(timer);
      const err = audio.error;
      const codeMap: Record<number, string> = { 1: 'ABORTED', 2: 'NETWORK', 3: 'DECODE', 4: 'SRC_NOT_SUPPORTED' };
      const reason = err ? `${codeMap[err.code] ?? err.code}: ${err.message ?? ''}` : 'unknown';
      cleanup();
      setProbeResults((prev) => ({ ...prev, [trackId]: { playable: false, error: reason, ms: Math.round(performance.now() - t0) } }));
    }, { once: true });
    audio.src = url;
    audio.load();
  }, []);

  const markQcRisk = async (trackId: string) => {
    if (!confirm('이 트랙을 QC 위험 큐(HIGH)에 등록하시겠어요? (자동 차단/삭제 없음)')) return;
    setCorrBusy(true);
    try {
      await adminMarkFingerprintQcRisk(trackId);
      toast.success('QC 위험 큐에 등록 — 기존 QC 워크플로에서 검토 가능.');
      await loadCorruption();
    } catch (e) {
      toast.error(`QC 마크 실패: ${(e as Error).message}`);
    } finally {
      setCorrBusy(false);
    }
  };

  const runAll = useCallback(async () => {
    setLoading(true);
    setRows([]);
    setOpenCompareKey(null);
    try {
      const data = await adminFindAllDuplicateCandidates(threshold, maxResults, durationTolerance);
      setRows(data);
      if (data.length === 0) toast.success('유사도 임계점 위 후보가 없어요.');
      else toast.success(`후보 ${data.length}건 검출.`);
    } catch (e) {
      toast.error(`전수 탐지 실패: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [threshold, maxResults, durationTolerance]);

  const runSingle = useCallback(async () => {
    if (!singleTrackId.trim()) {
      toast.error('track_id 를 입력해 주세요.');
      return;
    }
    setLoading(true);
    setRows([]);
    setOpenCompareKey(null);
    try {
      const data = await adminFindDuplicateTracks(singleTrackId.trim(), threshold, 20, 5.0);
      setRows(data);
      if (data.length === 0) toast.success('해당 트랙과 유사한 후보가 없어요.');
      else toast.success(`유사 후보 ${data.length}건.`);
    } catch (e) {
      toast.error(`단일 탐지 실패: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [singleTrackId, threshold]);

  return (
    <div className="space-y-3">
      {/* Fingerprint 상태 패널 (X2.3 0244) */}
      <div className="rounded-xl bg-bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold">Fingerprint 백필 상태</h3>
          <div className="flex items-center gap-2">
            <button onClick={() => void loadFpSummary()}
              className="inline-flex items-center gap-1 rounded bg-bg-deep px-2 py-1 text-xs hover:bg-bg-hover">
              <RefreshCw size={12} /> 새로고침
            </button>
            <button onClick={() => setShowFailures((v) => !v)}
              className="inline-flex items-center gap-1 rounded bg-bg-deep px-2 py-1 text-xs hover:bg-bg-hover">
              {showFailures ? '실패 목록 숨김' : '실패 목록 보기'}
            </button>
          </div>
        </div>
        {fpSummary ? (
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs md:grid-cols-5">
            <div className="rounded bg-emerald-500/10 p-2"><div className="text-[10px] text-ink-dim">성공</div><div className="text-lg font-bold text-emerald-500">{fpSummary.total_success}</div></div>
            <div className="rounded bg-rose-500/10 p-2"><div className="text-[10px] text-ink-dim">실패 (총)</div><div className="text-lg font-bold text-rose-500">{fpSummary.total_failed}</div></div>
            <div className="rounded bg-amber-500/10 p-2"><div className="text-[10px] text-ink-dim">재시도 가능</div><div className="text-lg font-bold text-amber-500">{fpSummary.total_retryable}</div></div>
            <div className="rounded bg-gray-500/10 p-2"><div className="text-[10px] text-ink-dim">재시도 소진</div><div className="text-lg font-bold text-gray-500">{fpSummary.total_exhausted}</div></div>
            <div className="rounded bg-blue-500/10 p-2"><div className="text-[10px] text-ink-dim">미시도</div><div className="text-lg font-bold text-blue-500">{fpSummary.pending_never_attempted}</div></div>
          </div>
        ) : (
          <p className="mt-2 text-xs text-ink-dim">상태 로딩 중…</p>
        )}
        {fpSummary && Object.keys(fpSummary.failure_breakdown ?? {}).length > 0 && (
          <details className="mt-2 text-xs">
            <summary className="cursor-pointer text-ink-mute">실패 사유 breakdown ({Object.keys(fpSummary.failure_breakdown).length}개 패턴)</summary>
            <ul className="mt-1 space-y-1">
              {Object.entries(fpSummary.failure_breakdown)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 20)
                .map(([sig, cnt]) => (
                  <li key={sig} className="flex items-start gap-2 text-[11px]">
                    <span className="shrink-0 rounded bg-rose-500/15 px-1.5 font-bold text-rose-500">{cnt}</span>
                    <code className="break-all text-ink-mute">{sig}</code>
                  </li>
                ))}
            </ul>
          </details>
        )}
        {showFailures && (
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={onlyExhausted} onChange={(e) => setOnlyExhausted(e.target.checked)} />
                <span>재시도 소진(≥3회) 만 보기</span>
              </label>
              <span className="text-ink-dim">총 {fpFailures.length}건</span>
            </div>
            {fpFailures.length === 0 ? (
              <p className="rounded bg-bg-deep px-3 py-4 text-center text-xs text-ink-dim">{fpBusy ? '로딩 중…' : '실패 트랙이 없어요.'}</p>
            ) : (
              <div className="overflow-x-auto rounded bg-bg-deep">
                <table className="w-full text-left text-[11px]">
                  <thead>
                    <tr className="border-b border-line/10 text-ink-dim">
                      <th className="px-2 py-1.5">곡</th>
                      <th className="px-2 py-1.5">retry</th>
                      <th className="px-2 py-1.5">size</th>
                      <th className="px-2 py-1.5">content_type</th>
                      <th className="px-2 py-1.5">error</th>
                      <th className="px-2 py-1.5">시도일</th>
                      <th className="px-2 py-1.5">조치</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fpFailures.map((f) => (
                      <tr key={f.track_id} className="border-b border-line/10">
                        <td className="px-2 py-1.5">
                          <div className="font-semibold">{f.title ?? '(제목없음)'}</div>
                          <div className="text-ink-dim">{f.artist ?? ''}</div>
                          <div className="text-[10px] text-ink-dim/70">{f.track_id.slice(0, 8)}…</div>
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <span className={`rounded px-1.5 font-bold ${f.retry_count >= 3 ? 'bg-gray-500/20 text-gray-500' : 'bg-amber-500/15 text-amber-500'}`}>{f.retry_count}</span>
                        </td>
                        <td className="px-2 py-1.5 text-ink-mute">{fmtBytes(f.download_size_bytes)}</td>
                        <td className="px-2 py-1.5 text-ink-mute">{f.download_content_type ?? '—'}</td>
                        <td className="px-2 py-1.5">
                          <details>
                            <summary className="cursor-pointer text-rose-500">{(f.error ?? '').slice(0, 60)}{(f.error ?? '').length > 60 ? '…' : ''}</summary>
                            <pre className="mt-1 max-w-md whitespace-pre-wrap break-all text-[10px] text-ink-mute">{f.error}</pre>
                          </details>
                        </td>
                        <td className="px-2 py-1.5 text-ink-mute">{f.attempted_at ? new Date(f.attempted_at).toLocaleString() : '—'}</td>
                        <td className="px-2 py-1.5">
                          <button disabled={fpBusy} onClick={() => void resetFailure(f.track_id)}
                            className="rounded bg-accent/15 px-2 py-0.5 font-semibold text-accent disabled:opacity-50">
                            재시도 가능으로
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-[10px] text-ink-dim">
              실패 트랙은 자동 삭제/차단되지 않습니다. 운영자가 수동으로 음원 교체 또는 "재시도 가능으로" 버튼으로 큐에 복귀시킬 수 있습니다.
            </p>
          </div>
        )}
      </div>

      {/* 손상 음원 후보 큐 (X2.3 0245) */}
      <div className="rounded-xl bg-bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold">손상 음원 후보 (Corruption Queue)</h3>
          <button onClick={() => setShowCorruption((v) => !v)}
            className="inline-flex items-center gap-1 rounded bg-bg-deep px-2 py-1 text-xs hover:bg-bg-hover">
            {showCorruption ? '큐 닫기' : '큐 열기'}
          </button>
        </div>
        <p className="mt-1 text-[11px] text-ink-dim">
          fingerprint_status=failed 트랙 + 메타데이터 비교 (tracks.duration vs. 다운로드 size/content_type) + 기존 QC report 신호.
          자동 삭제/차단 없음. 운영자가 재생 가능 여부 확인 후 QC 위험 큐에 마크하거나 음원 교체.
        </p>
        {showCorruption && (
          <div className="mt-2 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-ink-mute">총 {corruption.length}건</span>
              <button onClick={() => void loadCorruption()} disabled={corrBusy}
                className="inline-flex items-center gap-1 rounded bg-bg-deep px-2 py-0.5 text-xs hover:bg-bg-hover disabled:opacity-50">
                <RefreshCw size={11} className={corrBusy ? 'animate-spin' : ''} /> 새로고침
              </button>
            </div>
            {corruption.length === 0 ? (
              <p className="rounded bg-bg-deep px-3 py-4 text-center text-xs text-ink-dim">
                {corrBusy ? '조회 중…' : '손상 후보 없음.'}
              </p>
            ) : (
              <div className="overflow-x-auto rounded bg-bg-deep">
                <table className="w-full text-left text-[11px]">
                  <thead>
                    <tr className="border-b border-line/10 text-ink-dim">
                      <th className="px-2 py-1.5">곡</th>
                      <th className="px-2 py-1.5">tracks.dur</th>
                      <th className="px-2 py-1.5">size / type</th>
                      <th className="px-2 py-1.5">QC report</th>
                      <th className="px-2 py-1.5">재생 확인</th>
                      <th className="px-2 py-1.5">조치</th>
                    </tr>
                  </thead>
                  <tbody>
                    {corruption.map((c) => {
                      const probe = probeResults[c.track_id];
                      const trackDur = c.track_duration != null ? Number(c.track_duration) : null;
                      const durMismatch = probe?.duration != null && trackDur != null
                        ? Math.abs(probe.duration - trackDur) > 2 : false;
                      return (
                        <tr key={c.track_id} className="border-b border-line/10">
                          <td className="px-2 py-1.5">
                            <div className="font-semibold">{c.title ?? '(제목없음)'}</div>
                            <div className="text-ink-dim">{c.artist ?? ''}</div>
                            <div className="text-[10px] text-ink-dim/70">{c.track_id.slice(0, 8)}…</div>
                            {c.audio_url && (
                              <a href={c.audio_url} target="_blank" rel="noopener noreferrer"
                                className="break-all text-[10px] text-accent hover:underline">
                                {c.audio_url.length > 60 ? `${c.audio_url.slice(0, 60)}…` : c.audio_url}
                              </a>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-ink-mute">{fmtDuration(trackDur)}</td>
                          <td className="px-2 py-1.5">
                            <div>{fmtBytes(c.download_size_bytes)}</div>
                            <div className="text-[10px] text-ink-dim">{c.download_content_type ?? '—'}</div>
                          </td>
                          <td className="px-2 py-1.5">
                            {c.has_qc_report ? (
                              <>
                                <div className={`font-bold ${c.qc_risk_level === 'CRITICAL' ? 'text-rose-500' : c.qc_risk_level === 'HIGH' ? 'text-amber-500' : 'text-ink-mute'}`}>{c.qc_risk_level ?? '—'}</div>
                                <div className="text-[10px] text-ink-dim">score {c.qc_score ?? '—'} · issues {c.qc_issues_count}</div>
                              </>
                            ) : <span className="text-ink-dim">없음</span>}
                          </td>
                          <td className="px-2 py-1.5">
                            {!probe ? (
                              <button onClick={() => probePlayability(c.track_id, c.audio_url ?? '')}
                                disabled={!c.audio_url}
                                className="rounded bg-accent/15 px-2 py-0.5 font-semibold text-accent disabled:opacity-40">
                                재생 확인
                              </button>
                            ) : probe.playable ? (
                              <div>
                                <span className="rounded bg-emerald-500/20 px-1.5 font-bold text-emerald-500">PLAYABLE</span>
                                <div className="text-[10px] text-ink-dim">
                                  dur {probe.duration?.toFixed(1)}s
                                  {durMismatch && <span className="ml-1 font-bold text-amber-500">≠ tracks.duration</span>}
                                </div>
                                <div className="text-[10px] text-ink-dim/70">{probe.ms}ms</div>
                              </div>
                            ) : (
                              <div>
                                <span className="rounded bg-rose-500/20 px-1.5 font-bold text-rose-500">UNPLAYABLE</span>
                                <div className="text-[10px] text-rose-400/80">{probe.error}</div>
                              </div>
                            )}
                          </td>
                          <td className="px-2 py-1.5">
                            <div className="flex flex-col gap-1">
                              <button disabled={corrBusy} onClick={() => void markQcRisk(c.track_id)}
                                className="rounded bg-rose-500/15 px-2 py-0.5 font-semibold text-rose-500 disabled:opacity-50">
                                QC 위험 큐로 마크
                              </button>
                              <button disabled={corrBusy} onClick={() => void resetFailure(c.track_id)}
                                className="rounded bg-accent/15 px-2 py-0.5 font-semibold text-accent disabled:opacity-50">
                                재시도 가능으로
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-[10px] text-ink-dim">
              "재생 확인" = 브라우저 HTML5 Audio 로 metadata 로딩 시도 (preload=metadata).
              브라우저는 fpcalc 보다 관대해서 truncated mp3 도 어느 정도 재생할 수 있어요.
              브라우저는 OK 인데 fpcalc 만 실패 → 부분 손상 (tail truncation 등).
              브라우저도 UNPLAYABLE → 심각한 손상. "QC 위험 큐로 마크" 는 audio_qc_reports 에
              <code>FINGERPRINT_DECODE_FAILED</code> 이슈로 등록 (자동 차단/삭제 없음).
            </p>
          </div>
        )}
      </div>

      <div className="rounded-xl bg-bg-card p-3">
        <h3 className="mb-2 text-sm font-bold">중복 음원 탐지 (Chromaprint)</h3>
        <p className="text-[11px] text-ink-dim">
          오디오 지문(Chromaprint) 기반 유사도 검사. 자동 삭제/차단은 하지 않으며, 관리자 경고용 목록만 제공합니다.
          재인코딩(mp3↔wav)·길이 약간 다른 버전도 동일 음원으로 탐지됩니다.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-1.5">
            <span className="text-ink-mute">유사도 임계점</span>
            <input type="number" step="0.05" min="0.5" max="1" value={threshold}
              onChange={(e) => setThreshold(parseFloat(e.target.value) || 0.85)}
              className="w-16 rounded bg-bg-deep px-1.5 py-0.5 text-xs" />
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-ink-mute">길이 허용(초)</span>
            <input type="number" step="0.5" min="0" max="30" value={durationTolerance}
              onChange={(e) => setDurationTolerance(parseFloat(e.target.value) || 3)}
              className="w-16 rounded bg-bg-deep px-1.5 py-0.5 text-xs" />
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-ink-mute">최대 결과</span>
            <input type="number" step="10" min="1" max="500" value={maxResults}
              onChange={(e) => setMaxResults(parseInt(e.target.value, 10) || 100)}
              className="w-16 rounded bg-bg-deep px-1.5 py-0.5 text-xs" />
          </label>
          <button onClick={() => void runAll()} disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-black disabled:opacity-50">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> 전수 탐지 실행
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <input type="text" placeholder="단일 탐지용 track_id (UUID)" value={singleTrackId}
            onChange={(e) => setSingleTrackId(e.target.value)}
            className="w-72 rounded bg-bg-deep px-2 py-1 text-xs" />
          <button onClick={() => void runSingle()} disabled={loading || !singleTrackId.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-bg-deep px-3 py-1.5 text-xs font-semibold hover:bg-bg-hover disabled:opacity-50">
            <Play size={13} /> 단일 트랙 탐지
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl bg-bg-card px-4 py-8 text-center text-xs text-ink-dim">
          {loading ? '탐지 중…' : '탐지 결과가 없어요. 임계점/허용폭을 조정해 보세요.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-bg-card">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line/10 text-[11px] uppercase text-ink-dim">
                <th className="px-2 py-2 font-semibold">유사도</th>
                <th className="px-2 py-2 font-semibold">기준 곡</th>
                <th className="px-2 py-2 font-semibold">후보 곡</th>
                <th className="px-2 py-2 font-semibold">길이 차이</th>
                <th className="px-2 py-2 font-semibold">해시 일치</th>
                <th className="px-2 py-2 font-semibold">비교</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const key = `${r.source_track_id}::${r.candidate_track_id}`;
                const sevColor = r.similarity >= 0.95 ? 'text-rose-500' : r.similarity >= 0.90 ? 'text-amber-500' : 'text-emerald-500';
                return (
                  <Fragment key={key}>
                    <tr className="border-b border-line/10">
                      <td className={`px-2 py-2 font-bold ${sevColor}`}>{fmtSimilarity(r.similarity)}</td>
                      <td className="px-2 py-2">
                        <div className="font-semibold">{r.source_title ?? '(제목없음)'}</div>
                        <div className="text-ink-dim">{r.source_artist ?? ''} · {fmtDuration(r.source_duration)}</div>
                        <div className="text-[10px] text-ink-dim/70">{r.source_track_id.slice(0, 8)}…</div>
                      </td>
                      <td className="px-2 py-2">
                        <div className="font-semibold">{r.candidate_title ?? '(제목없음)'}</div>
                        <div className="text-ink-dim">{r.candidate_artist ?? ''} · {fmtDuration(r.candidate_duration)}</div>
                        <div className="text-[10px] text-ink-dim/70">{r.candidate_track_id.slice(0, 8)}…</div>
                      </td>
                      <td className="px-2 py-2 text-ink-mute">{r.duration_delta != null ? `${r.duration_delta.toFixed(2)}s` : '—'}</td>
                      <td className="px-2 py-2">
                        {r.hash_exact ? <span className="rounded bg-rose-500/20 px-1.5 py-0.5 font-bold text-rose-600">EXACT</span> : <span className="text-ink-dim">approx</span>}
                      </td>
                      <td className="px-2 py-2">
                        <button onClick={() => setOpenCompareKey(openCompareKey === key ? null : key)}
                          className="rounded bg-accent/15 px-2 py-1 font-semibold text-accent">
                          {openCompareKey === key ? '닫기' : '비교 보기'}
                        </button>
                      </td>
                    </tr>
                    {openCompareKey === key && (
                      <tr className="border-b border-line/10 bg-bg-deep/40">
                        <td colSpan={6} className="px-3 py-3">
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            <div>
                              <div className="mb-1 text-[11px] uppercase text-ink-dim">기준</div>
                              <div className="font-semibold">{r.source_title ?? '(제목없음)'}</div>
                              <div className="text-xs text-ink-mute">{r.source_artist ?? ''}</div>
                              <div className="mt-1 text-[11px] text-ink-dim">길이: {fmtDuration(r.source_duration)} ({r.source_duration?.toFixed(2)}s)</div>
                              <div className="text-[11px] text-ink-dim">track_id: <code>{r.source_track_id}</code></div>
                            </div>
                            <div>
                              <div className="mb-1 text-[11px] uppercase text-ink-dim">후보</div>
                              <div className="font-semibold">{r.candidate_title ?? '(제목없음)'}</div>
                              <div className="text-xs text-ink-mute">{r.candidate_artist ?? ''}</div>
                              <div className="mt-1 text-[11px] text-ink-dim">길이: {fmtDuration(r.candidate_duration)} ({r.candidate_duration?.toFixed(2)}s)</div>
                              <div className="text-[11px] text-ink-dim">track_id: <code>{r.candidate_track_id}</code></div>
                            </div>
                          </div>
                          <p className="mt-2 text-[11px] text-ink-dim">
                            관리자 경고 모드 — 자동 삭제/차단 없음. 필요 시 운영자가 수동 판단 후 처리해 주세요.
                            (유사도 ≥95% = 사실상 동일, 90~95% = 재인코딩 가능성, 85~90% = 부분 유사)
                          </p>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
