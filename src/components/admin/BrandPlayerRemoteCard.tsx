/**
 * BrandPlayerRemoteCard — 매장 플레이어 원격 제어 (0518).
 *
 * 매장이 stalled(세션은 살아있는데 곡이 안 넘어감) 되면 지금까지는 점주에게 F5 를
 * 부탁하는 것 외에 방법이 없었다. 이 카드에서 명령을 넣으면 매장 heartbeat(최대 60초)
 * 응답에 실려 배달된다.
 *
 * 한계 — UI 에 그대로 적어둔다:
 *  - 매장 기기가 0518 이후 빌드를 받은 뒤에야 동작한다.
 *  - 완전 offline(기기 꺼짐/폰 잠금)이면 배달되지 않는다. 깨울 방법은 없다.
 */
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, RotateCcw, Play, SkipForward, Radio } from 'lucide-react';
import {
  AdminSection, AdminCard, AdminButton, AdminBadge, AdminEmpty, AdminSkeleton, AdminAlert,
} from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  adminBrandPlayerHealth, adminEnqueueBrandPlayerCommand,
  type BrandPlayerHealthRow, type BrandPlayerCommand,
} from '@/lib/api/brandPlayerApi';

const COMMAND_LABEL: Record<BrandPlayerCommand, string> = {
  reload: '새로고침',
  play: '재생',
  next: '다음 곡',
};

function statusTone(s: BrandPlayerHealthRow['status']): 'success' | 'warning' | 'danger' {
  if (s === 'playing') return 'success';
  if (s === 'stalled') return 'warning';
  return 'danger';
}

function statusLabel(s: BrandPlayerHealthRow['status']): string {
  if (s === 'playing') return '재생 중';
  if (s === 'stalled') return '멈춤';
  return '오프라인';
}

function fmtAgo(sec: number): string {
  if (sec < 60) return `${sec}초 전`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}분 전`;
  return `${Math.round(m / 60)}시간 전`;
}

export default function BrandPlayerRemoteCard() {
  const [rows, setRows] = useState<BrandPlayerHealthRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setErr(null);
      setRows(await adminBrandPlayerHealth(1440));
    } catch (e) {
      setErr(e instanceof Error ? e.message : '세션 목록을 불러오지 못했습니다.');
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => { void load(); }, 15_000);
    return () => window.clearInterval(id);
  }, [load]);

  const send = useCallback(async (row: BrandPlayerHealthRow, command: BrandPlayerCommand) => {
    const key = `${row.session_id}:${command}`;
    setBusy(key);
    try {
      await adminEnqueueBrandPlayerCommand(row.session_id, command, `admin ui · ${row.store_label}`);
      toast.success(`${row.store_label} — ${COMMAND_LABEL[command]} 명령을 보냈습니다 (최대 60초 내 반영)`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '명령 전송에 실패했습니다.');
    } finally {
      setBusy(null);
    }
  }, []);

  return (
    <AdminSection
      title="매장 원격 제어"
      description="멈춘 매장에 새로고침·재생 명령을 보냅니다. 매장 heartbeat 로 최대 60초 내 전달됩니다."
      action={
        <AdminButton tone="neutral" variant="subtle" size="sm" leftIcon={<RefreshCw size={14} />} onClick={() => void load()}>
          새로고침
        </AdminButton>
      }
    >
      <AdminAlert tone="info">
        매장 기기가 원격 제어 배포 이후 빌드를 한 번 받아야 동작합니다. 완전 오프라인(기기 꺼짐·휴대폰 잠금) 상태는
        원격으로 깨울 수 없어, 그때는 점주에게 연락이 필요합니다.
      </AdminAlert>

      {rows === null && <AdminSkeleton rows={3} />}

      {rows !== null && err !== null && <AdminAlert tone="danger">{err}</AdminAlert>}

      {rows !== null && err === null && rows.length === 0 && (
        <AdminEmpty
          icon={<Radio size={26} />}
          title="최근 24시간 내 접속한 매장 플레이어가 없습니다"
          description="매장에서 플레이어를 실행하면 여기에 표시됩니다."
        />
      )}

      {rows !== null && rows.length > 0 && (
        <div className="grid gap-2">
          {rows.map((r) => {
            const offline = r.status === 'offline';
            return (
              <AdminCard key={r.session_id}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.store_label}</span>
                  <AdminBadge tone={statusTone(r.status)}>{statusLabel(r.status)}</AdminBadge>
                  <span className="text-[11px] text-ink-dim">{r.brand_name}</span>
                  {r.device && <span className="text-[11px] text-ink-dim">· {r.device}</span>}
                  <span className="text-[11px] text-ink-dim">· 신호 {fmtAgo(r.seconds_since_heartbeat)}</span>
                </div>

                <p className="mt-1 truncate text-[12px] text-ink-dim">
                  현재 곡 {r.current_track_title ?? '-'}
                </p>

                <div className="mt-2 flex flex-wrap gap-2">
                  <AdminButton
                    size="sm" variant="subtle" tone="primary" leftIcon={<RotateCcw size={13} />}
                    disabled={offline || busy === `${r.session_id}:reload`}
                    onClick={() => void send(r, 'reload')}
                  >
                    새로고침
                  </AdminButton>
                  <AdminButton
                    size="sm" variant="ghost" tone="neutral" leftIcon={<Play size={13} />}
                    disabled={offline || busy === `${r.session_id}:play`}
                    onClick={() => void send(r, 'play')}
                  >
                    재생
                  </AdminButton>
                  <AdminButton
                    size="sm" variant="ghost" tone="neutral" leftIcon={<SkipForward size={13} />}
                    disabled={offline || busy === `${r.session_id}:next`}
                    onClick={() => void send(r, 'next')}
                  >
                    다음 곡
                  </AdminButton>
                  {offline && (
                    <span className="self-center text-[11px] text-ink-dim">
                      오프라인 — 원격 명령이 닿지 않습니다
                    </span>
                  )}
                </div>
              </AdminCard>
            );
          })}
        </div>
      )}
    </AdminSection>
  );
}
