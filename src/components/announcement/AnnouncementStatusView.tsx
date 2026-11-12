/**
 * AnnouncementStatusView — 안내방송 송출 현황 (본사 브랜드 콘텐츠 · 관리자 공용, 0554).
 *
 *  · 안내 전용 플레이어: 매장별 켜짐/터치 대기/꺼짐/닫힘 + 마지막 신호
 *  · 오늘 송출 결과: 시각 · 매장 · 일정 · 송출/실패
 * 데이터는 부모가 넘긴다 (본사는 hq_announcement_status, 관리자는 admin_announcement_status).
 */
import { CheckCircle2, Radio, XCircle } from 'lucide-react';
import type { AnnouncementStatusDetail, AnnouncerDeviceState } from '@/lib/api/announcementApi';

const STATE_LABEL: Record<AnnouncerDeviceState, string> = {
  online: '켜짐',
  waiting_tap: '터치 대기',
  offline: '꺼짐',
  closed: '닫힘',
};

const STATE_TONE: Record<AnnouncerDeviceState, string> = {
  online: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200',
  waiting_tap: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200',
  offline: 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200',
  closed: 'bg-bg-hover text-ink-mute',
};

const STATE_HINT: Record<AnnouncerDeviceState, string> = {
  online: '이 기기에서 안내가 나가요',
  waiting_tap: '매장에서 화면을 한 번 눌러야 소리가 나요',
  offline: '신호가 끊겼어요 — 전원·인터넷 확인',
  closed: '매장에서 창을 닫았어요',
};

function hhmm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function ago(iso: string, nowIso: string): string {
  const sec = Math.max(0, Math.round((new Date(nowIso).getTime() - new Date(iso).getTime()) / 1000));
  if (sec < 90) return '방금';
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

export default function AnnouncementStatusView({ data }: { data: AnnouncementStatusDetail }) {
  const { summary, devices, today } = data;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="안내 전용 켜짐" value={summary.devices_online} tone={summary.devices_offline > 0 ? 'warn' : 'ok'}
          sub={summary.devices_offline > 0 ? `꺼짐 ${summary.devices_offline}` : undefined} />
        <Stat label="오늘 송출" value={summary.played} tone="ok" />
        <Stat label="오늘 실패" value={summary.failed} tone={summary.failed > 0 ? 'bad' : 'ok'} />
      </div>

      <div>
        <p className="mb-1.5 flex items-center gap-1 text-[12px] font-semibold text-ink-mute"><Radio size={12} /> 안내 전용 플레이어</p>
        {devices.length === 0 ? (
          <p className="rounded-xl bg-bg-soft p-3 text-[12px] leading-relaxed text-ink-mute">
            최근 3일 동안 켜진 안내 전용 플레이어가 없어요. 매장 기기에서 <b className="text-ink">/brand</b> 화면의
            [안내방송 전용]을 고르고 매장 코드를 넣으면 등록돼요. 없으면 매장 음악 플레이어가 안내를 내보내요.
          </p>
        ) : (
          <ul className="divide-y divide-line/10 rounded-xl bg-bg-soft px-3">
            {devices.map((d, i) => (
              <li key={`${d.store_user_id}-${i}`} className="flex items-center gap-2 py-2">
                <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold ${STATE_TONE[d.state]}`}>{STATE_LABEL[d.state]}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{d.store_label}</p>
                  <p className="truncate text-[11px] text-ink-mute">{STATE_HINT[d.state]}</p>
                </div>
                <span className="shrink-0 text-[11px] text-ink-dim">신호 {ago(d.last_seen_at, data.now)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="mb-1.5 text-[12px] font-semibold text-ink-mute">오늘 송출 결과</p>
        {today.length === 0 ? (
          <p className="rounded-xl bg-bg-soft p-3 text-[12px] text-ink-mute">오늘 나간 안내방송이 아직 없어요.</p>
        ) : (
          <ul className="max-h-72 divide-y divide-line/10 overflow-y-auto rounded-xl bg-bg-soft px-3">
            {today.map((r, i) => (
              <li key={`${r.store_user_id}-${r.scheduled_at}-${i}`} className="flex items-center gap-2 py-1.5 text-[12px]">
                <span className="shrink-0 font-mono text-ink-mute">{hhmm(r.scheduled_at)}</span>
                <span className="min-w-0 flex-1 truncate">
                  <b className="font-semibold">{r.store_label}</b> · {r.schedule_name ?? '안내방송'}
                </span>
                {r.status === 'played' ? (
                  <span className="inline-flex shrink-0 items-center gap-0.5 font-semibold text-emerald-600 dark:text-emerald-300"><CheckCircle2 size={12} /> 송출</span>
                ) : r.status === 'failed' ? (
                  <span className="inline-flex shrink-0 items-center gap-0.5 font-semibold text-rose-600 dark:text-rose-300" title={r.error ?? ''}>
                    <XCircle size={12} /> 실패{r.error?.startsWith('autoplay_blocked') ? ' (화면 터치 안 됨)' : ''}
                  </span>
                ) : (
                  <span className="shrink-0 text-ink-mute">{r.status === 'started' ? '재생 중' : '건너뜀'}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone, sub }: { label: string; value: number; tone: 'ok' | 'warn' | 'bad'; sub?: string }) {
  const color = tone === 'bad' ? 'text-rose-600 dark:text-rose-300' : tone === 'warn' ? 'text-amber-600 dark:text-amber-300' : 'text-ink';
  return (
    <div className="rounded-xl bg-bg-soft px-2 py-2.5">
      <p className={`text-xl font-extrabold tabular-nums ${color}`}>{value}</p>
      <p className="text-[11px] text-ink-mute">{label}{sub ? ` · ${sub}` : ''}</p>
    </div>
  );
}
