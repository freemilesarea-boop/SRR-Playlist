import { useAuthStore } from '@/store/authStore';
import { useUploadDebugStore } from '@/store/uploadDebugStore';

function fmtSize(b?: number): string {
  if (!b) return '—';
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)}KB`;
  return `${(b / 1024 / 1024).toFixed(1)}MB`;
}

const STATUS_DOT: Record<string, string> = {
  start: 'bg-sky-400',
  ok: 'bg-emerald-400',
  warn: 'bg-amber-400',
  error: 'bg-red-500',
  info: 'bg-ink-dim',
};

/**
 * 관리자 전용 업로드 디버그 패널.
 * 콘솔을 못 보는 운영자가 "어느 단계에서 실패했는지 + 연결된 Supabase 프로젝트"를
 * 화면에서 바로 확인할 수 있게 한다. 최근 1건의 uploadArtistTrack 진행을 표시.
 */
export default function UploadDebugPanel() {
  const isAdmin = useAuthStore((s) => s.profile?.role === 'admin');
  const record = useUploadDebugStore((s) => s.record);
  const clear = useUploadDebugStore((s) => s.clear);

  if (!isAdmin) return null;

  return (
    <section className="space-y-2 rounded-2xl bg-bg-card p-3 ring-1 ring-amber-400/30">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-amber-600 dark:text-amber-300">🔧 업로드 디버그 (관리자 전용)</h3>
        {record && (
          <button onClick={clear} className="text-[11px] text-ink-dim hover:text-ink">지우기</button>
        )}
      </div>

      <p className="font-mono text-[11px] text-ink-mute">
        Connected Supabase: <span className="text-accent">{record?.projectRef ?? '—'}</span>
      </p>

      {!record ? (
        <p className="text-[11px] text-ink-dim">아직 업로드 기록이 없어요. 음원을 업로드하면 단계별 진행이 여기 표시됩니다.</p>
      ) : (
        <div className="space-y-2 text-[11px]">
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            <KV k="시작" v={new Date(record.startedAt).toLocaleTimeString('ko-KR')} />
            <KV k="제목" v={record.title || '—'} />
            <KV k="audio" v={record.audio ? `${record.audio.name} · ${fmtSize(record.audio.size)} · ${record.audio.type || '?'}` : '없음'} />
            <KV k="cover" v={record.cover ? `${record.cover.name} · ${fmtSize(record.cover.size)} · ${record.cover.type || '?'}` : '없음'} />
            <KV k="audio 업로드" v={record.audioStatus ?? '…'} />
            <KV k="cover 업로드" v={record.coverStatus ?? '…'} />
            <KV k="RPC submit" v={record.rpcStatus ?? '…'} />
            <KV k="track id" v={record.trackId ?? '—'} mono />
            <KV k="release_status" v={record.releaseStatus ?? '—'} />
            <KV k="cover_url" v={record.coverUrl ? '있음' : (record.done ? '없음(NULL)' : '…')} />
          </div>

          {/* 단계 타임라인 */}
          <ol className="space-y-0.5 rounded-lg bg-bg-soft/60 p-2">
            {record.steps.map((s, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[s.status] ?? 'bg-ink-dim'}`} />
                <span className="font-mono">
                  <span className="text-ink">{s.stage}</span>
                  <span className="text-ink-dim"> · {s.status}</span>
                  {s.detail && <span className="text-ink-mute"> — {s.detail}</span>}
                </span>
              </li>
            ))}
          </ol>

          {record.done && (
            record.ok ? (
              <div className={`rounded-lg p-2 ${record.error ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300' : 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'}`}>
                <p className="font-bold">✅ 업로드 완료</p>
                <p>track id: <span className="font-mono">{record.trackId ?? '—'}</span></p>
                <p>cover_url: {record.coverUrl ? '있음' : '없음(NULL)'} · release_status: {record.releaseStatus ?? '—'}</p>
                {record.error && <p className="mt-0.5">⚠️ {record.error}</p>}
              </div>
            ) : (
              <div className="rounded-lg bg-red-500/20 p-2 text-red-700 dark:text-red-300">
                <p className="font-bold">❌ 업로드 실패</p>
                <p className="whitespace-pre-wrap break-all">{record.error ?? '원인 불명'}</p>
              </div>
            )
          )}
        </div>
      )}
    </section>
  );
}

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex gap-1">
      <span className="shrink-0 text-ink-dim">{k}:</span>
      <span className={`min-w-0 break-all text-ink ${mono ? 'font-mono' : ''}`}>{v}</span>
    </div>
  );
}
