import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, HardDrive, AlertTriangle, Trash2, FileWarning, Clock } from 'lucide-react';
import {
  fetchUploadAudit,
  deleteOrphanObjects,
  type UploadAudit,
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
        <Section title="파일 누락 곡 (DB 참조 O / storage X)" icon={<FileWarning size={15} className="text-rose-300" />}>
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
        <Section title="MP3 변환 실패 곡" icon={<AlertTriangle size={15} className="text-rose-300" />}>
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
          icon={<Trash2 size={15} className="text-amber-300" />}
        >
          <div className="mb-2 flex flex-wrap gap-2">
            <button onClick={selectAllOrphanAudio} className="rounded-lg bg-bg-card px-2.5 py-1.5 text-xs font-semibold hover:bg-bg-hover">
              전체 선택
            </button>
            <button
              onClick={() => void deleteSelected('audio', audit.orphan_audio.map((o) => o.name))}
              disabled={deleting}
              className="inline-flex items-center gap-1 rounded-lg bg-rose-500/20 px-2.5 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
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
        <Section title={`Orphan 커버 파일 (${audit.orphan_cover_count})`} icon={<Trash2 size={15} className="text-amber-300" />}>
          <div className="mb-2 flex flex-wrap gap-2">
            <button
              onClick={() => void deleteSelected('covers', audit.orphan_cover.map((o) => o.name))}
              disabled={deleting}
              className="inline-flex items-center gap-1 rounded-lg bg-rose-500/20 px-2.5 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
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
          <p className="rounded-xl bg-emerald-500/20 px-4 py-8 text-center text-sm text-emerald-300">
            점검 결과 이상 없음 — orphan/누락/변환실패/오래된 대기 곡이 없습니다.
          </p>
        )}
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: 'amber' | 'rose' | 'indigo' }) {
  const color =
    value === 0 ? 'text-ink' : tone === 'rose' ? 'text-rose-300' : tone === 'amber' ? 'text-amber-300' : 'text-indigo-600';
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
