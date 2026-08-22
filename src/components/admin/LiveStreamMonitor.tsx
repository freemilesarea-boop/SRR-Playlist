/**
 * LiveStreamMonitor — 관리자 대시보드 실시간 스트리밍 모니터.
 *
 * 앱/웹 어디서 스트리밍하든 stream_events 에 INSERT 되고, 이를 Supabase Realtime 으로
 * 구독해 실시간 노출한다(모바일 앱 출시 후 앱 스트리밍도 동일하게 여기 잡힘).
 */
import { useEffect, useRef, useState } from 'react';
import { Radio } from 'lucide-react';
import { subscribeStreamEvents, type StreamEventLite } from '@/lib/api/streamMonitorApi';

const MAX_ROWS = 25;

function hhmmss(iso: string | null): string {
  if (!iso) return '--:--:--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--:--';
  return d.toLocaleTimeString('ko-KR', { hour12: false });
}

export default function LiveStreamMonitor() {
  const [rows, setRows] = useState<StreamEventLite[]>([]);
  const [count, setCount] = useState(0);
  const [connected, setConnected] = useState(false);
  const startedAt = useRef<number>(Date.now());

  useEffect(() => {
    const handle = subscribeStreamEvents(
      (row) => {
        setRows((prev) => [row, ...prev].slice(0, MAX_ROWS));
        setCount((c) => c + 1);
      },
      (status) => setConnected(status === 'SUBSCRIBED'),
    );
    return () => handle.unsubscribe();
  }, []);

  const sinceMin = Math.max(1, Math.round((Date.now() - startedAt.current) / 60000));

  return (
    <div className="overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10">
      <header className="flex items-center justify-between gap-3 border-b border-line/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <Radio size={15} className="text-accent" />
          <h3 className="text-sm font-bold">실시간 스트리밍 모니터</h3>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              connected
                ? 'bg-emerald-500/15 text-emerald-500 dark:text-emerald-300'
                : 'bg-ink/10 text-ink-mute'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${connected ? 'animate-pulse bg-emerald-500' : 'bg-ink-mute'}`}
            />
            {connected ? 'LIVE' : '연결 중…'}
          </span>
        </div>
        <div className="text-right">
          <div className="font-mono text-lg font-bold tabular-nums text-accent">{count}</div>
          <div className="text-[10px] text-ink-mute">최근 {sinceMin}분 수신 · 앱/웹 합산</div>
        </div>
      </header>

      <div className="max-h-72 overflow-y-auto">
        {rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-xs text-ink-mute">
            스트리밍 이벤트 대기 중… 앱/웹에서 재생이 시작되면 여기에 실시간으로 표시됩니다.
          </p>
        ) : (
          <ul className="divide-y divide-line/10">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-2 text-xs">
                <span className="font-mono tabular-nums text-ink-mute">{hhmmss(r.created_at)}</span>
                <span className="font-mono text-ink-soft">
                  {r.track_id ? r.track_id.slice(0, 8) : '—'}
                </span>
                <span className="truncate text-ink-mute">{r.source_page || r.event_type || 'stream'}</span>
                <span className="ml-auto">
                  {r.is_effective ? (
                    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-500 dark:text-emerald-300">
                      유효
                    </span>
                  ) : (
                    <span className="rounded-full bg-ink/10 px-2 py-0.5 text-[10px] font-semibold text-ink-mute">
                      집계외
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
