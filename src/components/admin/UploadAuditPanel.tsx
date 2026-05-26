import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, HardDrive, AlertTriangle, Trash2, FileWarning, Clock, Boxes, Search, ShieldAlert, Unlock } from 'lucide-react';
import {
  fetchUploadAudit,
  deleteOrphanObjects,
  adminFetchBatchIntegrity,
  adminListUploadOrphans,
  adminIntegrityFailedCount,
  adminClearBatchIntegrity,
  type UploadAudit,
  type BatchIntegrityDetail,
  type BatchListItem,
  type UploadOrphan,
} from '@/lib/uploadAudit';
import { toast } from '@/store/toastStore';

function fmtBytes(n: number | null): string {
  if (!n || n <= 0) return '-';
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}
function fmtTime(iso: string | null): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

export default function UploadAuditPanel() {
  const [audit, setAudit] = useState<UploadAudit | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAudit(await fetchUploadAudit());
      setSelected({});
    } catch (e) {
      toast.error(`점검 데이터를 불러오지 못했어요: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function toggle(name: string) {
    setSelected((s) => ({ ...s, [name]: !s[name] }));
  }
  function selectAllOrphanAudio() {
    if (!audit) return;
    const all: Record<string, boolean> = {};
    audit.orphan_audio.forEach((o) => (all[o.name] = true));
    setSelected((s) => ({ ...s, ...all }));
  }

  async function deleteSelected(bucket: 'audio' | 'covers', names: string[]) {
    const chosen = names.filter((n) => selected[n]);
    if (chosen.length === 0) {
      toast.info('삭제할 파일을 선택해주세요.');
      return;
    }
    if (
      !window.confirm(
        `선택한 ${chosen.length}개 orphan 파일을 ${bucket} 버킷에서 영구 삭제할까요?\n` +
          '이 파일들은 어떤 음원도 참조하지 않는 파일입니다. (되돌릴 수 없음)',
      )
    )
      return;
    setDeleting(true);
    try {
      const { removed } = await deleteOrphanObjects(bucket, chosen);
      toast.success(`${removed}개 orphan 파일을 삭제했어요.`);
      await load();
    } catch (e) {
      toast.error(`삭제 실패: ${(e as Error).message}`);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <HardDrive size={18} className="text-accent" />
            업로드 / 스토리지 점검
          </h2>
          <p className="text-xs text-ink-mute">
            DB와 storage 정합성을 점검합니다. orphan(참조 없는 파일), 누락(참조는 있으나 파일 없음),
            변환 실패, 오래된 검수 대기 곡을 조회/정리합니다.
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-bg-card px-3 py-2 text-xs font-semibold hover:bg-bg-hover"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          새로고침
        </button>
      </div>

      {audit && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <StatCard label="Orphan 음원" value={audit.orphan_audio_count} tone="amber" />
          <StatCard label="Orphan 커버" value={audit.orphan_cover_count} tone="amber" />
          <StatCard label="파일 누락 곡" value={audit.missing_audio_count} tone="rose" />
          <StatCard label="변환 실패" value={audit.conversion_failed_count} tone="rose" />
          <StatCard label="오래된 검수대기" value={audit.stale_pending_count} tone="indigo" />
        </div>
      )}

      {/* 파일 누락 곡 — 가장 위험 (DB엔 있으나 storage 없음) */}
      {audit && audit.missing_audio.length > 0 && (
        <Section title="파일 누락 곡 (DB 참조 O / storage X)" icon={<FileWarning size={15} className="text-rose-500" />}>
          <ul className="space-y-1 text-xs">
            {audit.missing_audio.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-rose-500/5 px-2.5 py-1.5">
                <span className="truncate">
                  <b>{t.title ?? '(제목없음)'}</b> · {t.release_status} · <code className="text-[10px] text-ink-dim">{t.id.slice(0, 8)}</code>
                </span>
                <span className="text-[10px] text-ink-dim">{t.storage_path ?? t.audio_url}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* 변환 실패 */}
      {audit && audit.conversion_failed.length > 0 && (
        <Section title="MP3 변환 실패 곡" icon={<AlertTriangle size={15} className="text-rose-500" />}>
          <p className="mb-2 text-[11px] text-ink-dim">
            "오디오 변환(iOS)" 탭에서 재변환하거나 MP3 를 수동 업로드하세요. 변환 전에는 발매되지 않습니다.
          </p>
          <ul className="space-y-1 text-xs">
            {audit.conversion_failed.map((t) => (
              <li key={t.id} className="flex justify-between gap-2">
                <span className="truncate">{t.title ?? '(제목없음)'} · {t.artist ?? ''}</span>
                <span className="text-[10px] text-ink-dim">{fmtTime(t.audio_health_checked_at)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* 오래된 검수 대기 */}
      {audit && audit.stale_pending.length > 0 && (
        <Section title="오래된 검수 대기 (7일+)" icon={<Clock size={15} className="text-indigo-500" />}>
          <ul className="space-y-1 text-xs">
            {audit.stale_pending.map((t) => (
              <li key={t.id} className="flex justify-between gap-2">
                <span className="truncate">{t.title ?? '(제목없음)'} · {t.artist ?? ''} · {t.release_status}</span>
                <span className="text-[10px] text-ink-dim">제출 {fmtTime(t.submitted_at ?? t.created_at)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Orphan 음원 — 선택 삭제 */}
      {audit && audit.orphan_audio.length > 0 && (
        <Section
          title={`Orphan 음원 파일 (${audit.orphan_audio_count})`}
          icon={<Trash2 size={15} className="text-amber-500" />}
        >
          <div className="mb-2 flex flex-wrap gap-2">
            <button onClick={selectAllOrphanAudio} className="rounded-lg bg-bg-card px-2.5 py-1.5 text-xs font-semibold hover:bg-bg-hover">
              전체 선택
            </button>
            <button
              onClick={() => void deleteSelected('audio', audit.orphan_audio.map((o) => o.name))}
              disabled={deleting}
              className="inline-flex items-center gap-1 rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-500/20 disabled:opacity-50"
            >
              <Trash2 size={12} /> 선택 삭제
            </button>
            <span className="self-center text-[11px] text-ink-dim">
              ※ 어떤 음원도 참조하지 않는 파일만 표시됩니다. 발매/스트리밍 중인 음원은 제외됩니다.
            </span>
          </div>
          <ul className="max-h-80 space-y-0.5 overflow-y-auto text-xs">
            {audit.orphan_audio.map((o) => (
              <li key={o.name} className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-ink/5">
                <input type="checkbox" checked={!!selected[o.name]} onChange={() => toggle(o.name)} />
                <span className="flex-1 truncate font-mono text-[10px]">{o.name}</span>
                <span className="shrink-0 text-ink-dim">{fmtBytes(o.size)}</span>
                <span className="shrink-0 text-[10px] text-ink-dim">{fmtTime(o.created_at)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Orphan 커버 */}
      {audit && audit.orphan_cover.length > 0 && (
        <Section title={`Orphan 커버 파일 (${audit.orphan_cover_count})`} icon={<Trash2 size={15} className="text-amber-500" />}>
          <div className="mb-2 flex flex-wrap gap-2">
            <button
              onClick={() => void deleteSelected('covers', audit.orphan_cover.map((o) => o.name))}
              disabled={deleting}
              className="inline-flex items-center gap-1 rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-500/20 disabled:opacity-50"
            >
              <Trash2 size={12} /> 선택 삭제
            </button>
          </div>
          <ul className="max-h-60 space-y-0.5 overflow-y-auto text-xs">
            {audit.orphan_cover.map((o) => (
              <li key={o.name} className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-ink/5">
                <input type="checkbox" checked={!!selected[o.name]} onChange={() => toggle(o.name)} />
                <span className="flex-1 truncate font-mono text-[10px]">{o.name}</span>
                <span className="shrink-0 text-[10px] text-ink-dim">{fmtTime(o.created_at)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {audit &&
        audit.orphan_audio.length === 0 &&
        audit.missing_audio.length === 0 &&
        audit.conversion_failed.length === 0 &&
        audit.stale_pending.length === 0 && (
          <p className="rounded-xl bg-emerald-500/10 px-4 py-8 text-center text-sm text-emerald-600">
            점검 결과 이상 없음 — orphan/누락/변환실패/오래된 대기 곡이 없습니다.
          </p>
        )}

      <BatchIntegritySection />
      <UploadOrphanSection />
    </div>
  );
}

function UploadOrphanSection() {
  const [orphans, setOrphans] = useState<UploadOrphan[]>([]);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setOrphans(await adminListUploadOrphans()); setSel({}); }
    catch (e) { toast.error(`orphan 조회 실패: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function deleteSelected() {
    const names = orphans.map((o) => o.storage_path).filter((n) => sel[n]);
    if (names.length === 0) { toast.info('삭제할 orphan 을 선택해주세요.'); return; }
    if (!window.confirm(`선택한 ${names.length}개 orphan 음원(업로드됐으나 트랙 미연결, 24h+)을 audio 버킷에서 영구 삭제할까요? (되돌릴 수 없음)`)) return;
    setDeleting(true);
    try {
      const { removed } = await deleteOrphanObjects('audio', names);
      toast.success(`${removed}개 orphan 삭제 (스토리지 비용 회수)`);
      await load();
    } catch (e) { toast.error(`삭제 실패: ${(e as Error).message}`); }
    finally { setDeleting(false); }
  }

  return (
    <Section title={`Orphan 업로드 (submit 실패 잔여물 · ${orphans.length})`} icon={<Trash2 size={15} className="text-amber-500" />}>
      <p className="mb-2 text-[11px] text-ink-dim">
        storage 업로드는 됐지만 트랙 연결 없이 24시간 이상 경과한 객체입니다(submit 실패/중단 잔여물). 선택 삭제로 스토리지 비용 누수를 막습니다.
      </p>
      {orphans.length === 0 ? (
        <p className="py-3 text-center text-xs text-ink-dim">{loading ? '불러오는 중…' : 'orphan 없음'}</p>
      ) : (
        <>
          <div className="mb-2 flex gap-2">
            <button onClick={() => setSel(Object.fromEntries(orphans.map((o) => [o.storage_path, true])))} className="rounded-lg bg-bg-card px-2.5 py-1.5 text-xs font-semibold hover:bg-bg-hover">전체 선택</button>
            <button onClick={() => void deleteSelected()} disabled={deleting} className="inline-flex items-center gap-1 rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-500/20 disabled:opacity-50">
              <Trash2 size={12} /> 선택 삭제
            </button>
            <button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-lg bg-bg-soft px-2.5 py-1.5 text-xs font-semibold hover:bg-bg-hover"><RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 새로고침</button>
          </div>
          <ul className="max-h-72 space-y-0.5 overflow-y-auto text-xs">
            {orphans.map((o) => (
              <li key={o.storage_path} className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-ink/5">
                <input type="checkbox" checked={!!sel[o.storage_path]} onChange={() => setSel((s) => ({ ...s, [o.storage_path]: !s[o.storage_path] }))} />
                <span className="flex-1 truncate font-mono text-[10px]">{o.storage_path}</span>
                <span className="shrink-0 text-[10px] text-ink-dim">{o.original_filename ?? ''}</span>
                <span className="shrink-0 text-[10px] text-ink-dim">{fmtBytes(o.file_size)}</span>
                <span className="shrink-0 text-[10px] text-ink-dim">{o.failure_reason ?? ''}</span>
                <span className="shrink-0 text-[10px] text-ink-dim">{fmtTime(o.created_at)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}

function BatchIntegritySection() {
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState<BatchIntegrityDetail | null>(null);
  const [batches, setBatches] = useState<BatchListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [failedCount, setFailedCount] = useState(0);

  const loadRecent = useCallback(async () => {
    setLoading(true);
    try {
      const [res, cnt] = await Promise.all([adminFetchBatchIntegrity({}), adminIntegrityFailedCount().catch(() => 0)]);
      if ('batches' in res) { setBatches(res.batches); setDetail(null); }
      setFailedCount(cnt);
    } catch (e) {
      toast.error(`배치 목록 조회 실패: ${(e as Error).message}`);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void loadRecent(); }, [loadRecent]);

  async function clearIntegrity(batchId: string) {
    if (!window.confirm(`batch ${batchId.slice(0, 8)} 의 무결성 잠금을 해제(검토 완료)할까요? 사용자가 다시 제출할 수 있게 됩니다.`)) return;
    try {
      await adminClearBatchIntegrity(batchId);
      toast.success('무결성 잠금 해제됨 (admin_action_log 기록)');
      await loadRecent();
      if (detail?.batch?.id === batchId) await lookup(batchId);
    } catch (e) { toast.error(`해제 실패: ${(e as Error).message}`); }
  }

  async function lookup(value: string) {
    const v = value.trim();
    if (!v) { void loadRecent(); return; }
    setLoading(true);
    try {
      // uuid 면 batch 우선, track 둘 다 시도(서버가 batch_id 없으면 track 의 batch 로 resolve)
      const res = await adminFetchBatchIntegrity({ batchId: v, trackId: v });
      if ('logs' in res) { setDetail(res); }
      else { setBatches(res.batches); setDetail(null); toast.info('해당 batch/track 의 무결성 기록이 없어요.'); }
    } catch (e) {
      toast.error(`조회 실패: ${(e as Error).message}`);
    } finally { setLoading(false); }
  }

  return (
    <Section title="업로드 무결성 (batch 추적)" icon={<Boxes size={15} className="text-accent" />}>
      <p className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-ink-dim">
        batch_id 또는 track_id 로 업로드 무결성 로그(곡별 단계/변환/실패 사유/생성 트랙)를 조회합니다.
        {failedCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-bold text-rose-600">
            <ShieldAlert size={11} /> integrity_failed {failedCount}건 — 검토 필요
          </span>
        )}
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-1 items-center gap-1.5 rounded-lg bg-bg-soft px-2.5 py-1.5 ring-1 ring-line/10">
          <Search size={13} className="text-ink-dim" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void lookup(query); }}
            placeholder="batch_id 또는 track_id (UUID)" className="flex-1 bg-transparent text-xs outline-none" />
        </div>
        <button onClick={() => void lookup(query)} className="rounded-lg bg-accent/15 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/25">조회</button>
        <button onClick={() => { setQuery(''); void loadRecent(); }} className="inline-flex items-center gap-1 rounded-lg bg-bg-soft px-2.5 py-1.5 text-xs font-semibold hover:bg-bg-hover">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 최근 배치
        </button>
      </div>

      {detail ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <code className="font-mono text-accent">{detail.batch?.id?.slice(0, 8)}…</code>
            <span className={`rounded px-1.5 py-0.5 font-semibold ${detail.batch?.status === 'integrity_failed' ? 'bg-rose-500/15 text-rose-600' : detail.batch?.status === 'completed' ? 'bg-emerald-500/15 text-emerald-600' : 'bg-ink/10 text-ink-mute'}`}>
              {detail.batch?.status ?? '?'}
            </span>
            <span className="text-ink-dim">{detail.owner_email ?? ''} · {detail.batch?.total_tracks ?? 0}곡</span>
            {detail.batch?.status === 'integrity_failed' && detail.batch?.id && (
              <button onClick={() => void clearIntegrity(detail.batch!.id)} className="inline-flex items-center gap-1 rounded-lg bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-700 hover:bg-amber-500/25 dark:text-amber-300">
                <Unlock size={11} /> 무결성 잠금 해제
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead className="text-ink-dim"><tr className="text-left">
                <th className="py-1 pr-2">파일</th><th>상태</th><th>변환</th><th>실패사유</th><th>retry</th><th>트랙</th><th>sha</th>
              </tr></thead>
              <tbody>
                {detail.logs.map((l) => (
                  <tr key={l.client_track_id} className="border-t border-line/10">
                    <td className="max-w-[160px] truncate py-1 pr-2">{l.original_filename ?? l.client_track_id.slice(0, 8)}</td>
                    <td>{l.upload_status ?? '-'}</td>
                    <td>{l.transcode_status ?? '-'}</td>
                    <td className={l.failure_reason ? 'text-rose-600' : ''}>{l.failure_reason ?? '-'}</td>
                    <td className="tabular-nums">{l.retry_count}</td>
                    <td>{l.track_status ? `${l.track_status}` : (l.created_track_id ? l.created_track_id.slice(0, 8) : '-')}</td>
                    <td className="font-mono">{l.sha256 ? l.sha256.slice(0, 8) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <ul className="space-y-1 text-xs">
          {batches.length === 0 ? (
            <li className="py-4 text-center text-ink-dim">{loading ? '불러오는 중…' : '최근 배치가 없어요.'}</li>
          ) : batches.map((b) => (
            <li key={b.batch_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-bg-soft/40 px-2.5 py-1.5">
              <button onClick={() => void lookup(b.batch_id)} className="font-mono text-[10px] text-accent hover:underline">{b.batch_id.slice(0, 8)}…</button>
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${b.status === 'integrity_failed' ? 'bg-rose-500/15 text-rose-600' : b.status === 'completed' ? 'bg-emerald-500/15 text-emerald-600' : 'bg-ink/10 text-ink-mute'}`}>{b.status}</span>
              <span className="text-[10px] text-ink-dim">{b.owner_email ?? ''} · {b.total_tracks}곡 · {fmtTime(b.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: 'amber' | 'rose' | 'indigo' }) {
  const color =
    value === 0 ? 'text-ink' : tone === 'rose' ? 'text-rose-600' : tone === 'amber' ? 'text-amber-600' : 'text-indigo-600';
  return (
    <div className="rounded-xl bg-bg-card p-3">
      <div className={`text-2xl font-extrabold tabular-nums ${color}`}>{value}</div>
      <div className="text-[11px] text-ink-mute">{label}</div>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-bg-card p-4 ring-1 ring-line/10">
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold">{icon} {title}</h3>
      {children}
    </div>
  );
}
