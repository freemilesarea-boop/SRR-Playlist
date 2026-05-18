/**
 * AdminNotificationsBell — 0083 운영 알림 종 + 드롭다운
 *
 * AdminPage 헤더 우측에 표시. unread 카운트 배지 + 클릭 시 드롭다운 패널 열림.
 *
 * 안전 동작:
 * - admin 권한 가드된 RPC 만 호출
 * - 알림 적립은 service_role 만 (Edge Function 내부)
 * - 30초 주기 unread 카운트 폴링
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, AlertTriangle, AlertCircle, Info, CheckCheck, X } from 'lucide-react';
import {
  adminListNotifications,
  adminNotificationUnreadCount,
  adminMarkNotificationRead,
  adminMarkAllNotificationsRead,
  type AdminNotification,
} from '@/lib/artistApi';
import { toast } from '@/store/toastStore';

const SEV_TONE: Record<string, string> = {
  info: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 ring-sky-400/30',
  warning: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-400/30',
  error: 'bg-red-500/15 text-red-700 dark:text-red-300 ring-red-400/30',
};

function SevIcon({ sev }: { sev: AdminNotification['severity'] }) {
  if (sev === 'error') return <AlertCircle size={14} />;
  if (sev === 'warning') return <AlertTriangle size={14} />;
  return <Info size={14} />;
}

function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  return `${d}일 전`;
}

export default function AdminNotificationsBell() {
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<AdminNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const refreshCount = useCallback(async () => {
    try { setUnread(await adminNotificationUnreadCount()); } catch { /* admin guard 차단 등 silent */ }
  }, []);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminListNotifications(false, 50);
      setList(data);
    } catch (e) {
      toast.error('알림 조회 실패: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshCount();
    const t = window.setInterval(() => { void refreshCount(); }, 30_000);
    return () => window.clearInterval(t);
  }, [refreshCount]);

  useEffect(() => {
    if (open) void loadList();
  }, [open, loadList]);

  // outside click
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  async function onMarkRead(id: number) {
    if (busy) return;
    setBusy(true);
    try {
      await adminMarkNotificationRead(id);
      setList((l) => l.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
      await refreshCount();
    } catch (e) {
      toast.error('처리 실패: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }

  async function onMarkAll() {
    if (busy) return;
    setBusy(true);
    try {
      const n = await adminMarkAllNotificationsRead();
      toast.success(`${n}건 확인 완료`);
      await Promise.all([loadList(), refreshCount()]);
    } catch (e) {
      toast.error('처리 실패: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`운영 알림${unread > 0 ? ` (미확인 ${unread}건)` : ''}`}
        aria-expanded={open}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-full bg-bg-card text-ink-mute ring-1 ring-line/10 hover:text-ink"
      >
        <Bell size={16} />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white tabular-nums">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="운영 알림"
          className="absolute right-0 top-full z-40 mt-2 w-[min(420px,calc(100vw-2rem))] overflow-hidden rounded-2xl bg-bg-card shadow-elevated ring-1 ring-line/15 backdrop-blur"
        >
          <div className="flex items-center justify-between border-b border-line/10 px-3 py-2">
            <p className="text-xs font-bold">
              운영 알림 {unread > 0 && <span className="ml-1 text-red-600 dark:text-red-300">· 미확인 {unread}</span>}
            </p>
            <div className="flex gap-1">
              {unread > 0 && (
                <button
                  type="button"
                  onClick={() => void onMarkAll()}
                  disabled={busy}
                  className="inline-flex items-center gap-1 rounded-md bg-bg-soft px-2 py-1 text-[10px] font-semibold text-ink-mute ring-1 ring-line/10 hover:bg-bg-hover hover:text-ink disabled:opacity-50"
                >
                  <CheckCheck size={10} /> 모두 확인
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="닫기"
                className="inline-flex h-6 w-6 items-center justify-center rounded text-ink-mute hover:bg-bg-hover hover:text-ink"
              >
                <X size={12} />
              </button>
            </div>
          </div>

          {loading && (
            <div className="p-6 text-center text-xs text-ink-mute">불러오는 중…</div>
          )}
          {!loading && list.length === 0 && (
            <div className="p-6 text-center text-xs text-ink-mute">
              알림이 없어요.
            </div>
          )}
          {!loading && list.length > 0 && (
            <ul className="max-h-[500px] overflow-y-auto divide-y divide-line/10">
              {list.map((n) => {
                const tone = SEV_TONE[n.severity] ?? SEV_TONE.info;
                const isUnread = !n.read_at;
                return (
                  <li
                    key={n.id}
                    className={`flex gap-2 p-3 ${isUnread ? 'bg-accent/[0.04]' : ''}`}
                  >
                    <div className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1 ${tone}`}>
                      <SevIcon sev={n.severity} />
                    </div>
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="truncate text-xs font-semibold">{n.title}</p>
                      {n.body && (
                        <p className="line-clamp-2 text-[11px] text-ink-mute">{n.body}</p>
                      )}
                      <div className="flex items-center gap-1.5 text-[10px] text-ink-dim">
                        <span>{fmtRelative(n.created_at)}</span>
                        {n.track_code && (
                          <code className="rounded bg-bg-soft px-1 py-0.5 font-mono text-[9px]">
                            {n.track_code}
                          </code>
                        )}
                        {n.track_title && (
                          <span className="truncate">· {n.track_title}</span>
                        )}
                      </div>
                    </div>
                    {isUnread && (
                      <button
                        type="button"
                        onClick={() => void onMarkRead(n.id)}
                        disabled={busy}
                        aria-label="확인 완료"
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-mute hover:bg-bg-hover hover:text-ink disabled:opacity-50"
                      >
                        <CheckCheck size={12} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
