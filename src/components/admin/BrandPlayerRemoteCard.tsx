/**
 * BrandPlayerRemoteCard — 매장 플레이어 원격 복구 콘솔 (0518 → 0519 확장).
 *
 * 매장이 멈췄을 때 점주에게 F5 를 부탁하는 것 말고 우리가 할 수 있는 일을 만든다.
 * Slack 장애 알림 → 이 화면 → 매장 확인 → Hard Recovery → 필요하면 Reload.
 *
 * ── 안전 규칙 ───────────────────────────────────────────────────────────────
 *  • 전 매장 버튼은 없다. 명령은 항상 store_user_id + session 을 지목한다.
 *  • Reload 는 더 강한 동작이라 2차 확인을 받는다(리로드 후 자동재생이 막히면
 *    점주가 화면을 눌러야 소리가 난다 — 숙대점 SamsungBrowser 실측 5건 중 3건).
 *  • Hard Recovery 는 같은 문서 안에서 오디오 엘리먼트만 새로 만든다.
 *    자동재생 위험이 없으므로 **먼저 이걸 쓴다.**
 *
 * ── 한계 (UI 에 그대로 적어둔다) ────────────────────────────────────────────
 *  • 매장 기기가 해당 빌드를 받은 뒤에야 동작한다.
 *  • 완전 offline(기기 꺼짐/폰 잠금)이면 배달되지 않는다. TTL 2분 안에 돌아오지
 *    않으면 만료된다 — "보냈으니 됐겠지" 로 오판하지 않게 상태를 표시한다.
 *
 * ── 0520 ────────────────────────────────────────────────────────────────────
 *  • Slack 장애 알림의 "Recovery Console 열기" 는 ?store=<uuid> 를 달고 들어온다.
 *    해당 매장을 맨 위로 올리고 표시한다. **자동 실행은 하지 않는다** — 링크는
 *    화면을 열어줄 뿐이고, 실행은 여기서 사람이 누르고 확인 절차를 거친다.
 *  • 명령이 Realtime 으로 갔는지 heartbeat 로 갔는지 표시한다. Realtime 이 조용히
 *    죽어 있으면 "왜 60초나 걸리지" 를 알 방법이 없다.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RefreshCw, RotateCcw, Play, SkipForward, Radio, Wrench, LifeBuoy } from 'lucide-react';
import {
  AdminSection, AdminCard, AdminButton, AdminBadge, AdminEmpty, AdminSkeleton, AdminAlert,
} from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import { planOneClickRecovery } from '@/lib/oneClickRecovery';
import {
  adminBrandPlayerHealth, requestStoreRecovery,
  type BrandPlayerHealthRow, type BrandPlayerCommand,
} from '@/lib/api/brandPlayerApi';

const COMMAND_LABEL: Record<BrandPlayerCommand, string> = {
  hard_recovery: '오디오 재시작',
  reload: '페이지 재시작',
  play: '재생',
  next: '다음 곡',
};

/** 페이지 재시작은 되돌리기 어렵다 — 2차 확인을 받는다. */
const NEEDS_CONFIRM: ReadonlySet<BrandPlayerCommand> = new Set(['reload']);

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

/** 배달 경로 뱃지. heartbeat 만 계속 찍히면 Realtime 이 죽어 있다는 신호다. */
function sourceLabel(src: string | null | undefined): string | null {
  if (src === 'realtime') return '실시간 전달';
  if (src === 'heartbeat') return '폴링 전달';
  return null;
}

/** 명령 진행 상태 뱃지 — 보냈는데 안 갔는지를 운영자가 알아야 한다. */
function pendingLabel(status: string | null): string | null {
  if (!status) return null;
  if (status === 'pending') return '전달 대기';
  if (status === 'received') return '수신됨';
  if (status === 'executing') return '실행 중';
  return null;
}

export default function BrandPlayerRemoteCard() {
  const [params] = useSearchParams();
  // Slack 딥링크가 지목한 매장. 이 값으로 하는 일은 정렬·강조뿐이다.
  const focusStore = params.get('store');
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

  // 지목된 매장을 맨 위로. 목록 자체는 그대로 두고 순서만 바꾼다.
  const ordered = useMemo(() => {
    if (!rows || !focusStore) return rows;
    return [...rows].sort((a, b) => {
      const av = a.store_user_id === focusStore ? 0 : 1;
      const bv = b.store_user_id === focusStore ? 0 : 1;
      return av - bv;
    });
  }, [rows, focusStore]);

  const focusMissing = !!focusStore && !!rows && !rows.some((r) => r.store_user_id === focusStore);

  const send = useCallback(async (row: BrandPlayerHealthRow, command: BrandPlayerCommand) => {
    if (NEEDS_CONFIRM.has(command)) {
      const ok = window.confirm(
        `${row.store_label}\n세션 ${row.session_id.slice(0, 8)}\n\n`
        + `${COMMAND_LABEL[command]} 을(를) 실행합니다.\n`
        + '페이지를 다시 띄우면 기기에 따라 자동재생이 막혀 점주가 화면을 한 번 눌러야 할 수 있습니다.\n'
        + '먼저 "오디오 재시작" 을 시도하는 것을 권장합니다.',
      );
      if (!ok) return;
    }

    const key = `${row.session_id}:${command}`;
    setBusy(key);
    try {
      const res = await requestStoreRecovery(row.store_user_id, command, {
        sessionId: row.session_id,
        note: `admin console · ${row.store_label}`,
      });
      if (!res.success) {
        if (res.reason === 'cooldown') {
          toast.warning(`대기 시간이 남았습니다 — ${res.retry_after_seconds ?? 0}초 후 다시 시도하세요.`);
        } else {
          toast.error(`명령이 거부되었습니다 (${res.reason ?? 'unknown'})`);
        }
        return;
      }
      toast.success(
        row.status === 'offline'
          ? `${row.store_label} — 명령을 등록했습니다. 기기가 오프라인이라 2분 안에 돌아오지 않으면 만료됩니다.`
          : `${row.store_label} — ${COMMAND_LABEL[command]} 명령을 보냈습니다 (최대 60초 내 반영).`,
      );
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '명령 전송에 실패했습니다.');
    } finally {
      setBusy(null);
    }
  }, [load]);

  return (
    <AdminSection
      title="매장 원격 복구 콘솔"
      description="멈춘 매장을 원격으로 되살립니다. 오디오 재시작을 먼저 쓰고, 그래도 안 되면 페이지 재시작을 씁니다."
      action={
        <AdminButton tone="neutral" variant="subtle" size="sm" leftIcon={<RefreshCw size={14} />} onClick={() => void load()}>
          새로고침
        </AdminButton>
      }
    >
      <AdminAlert tone="info">
        매장 기기가 해당 빌드를 한 번 받아야 동작합니다. 완전 오프라인(기기 꺼짐·화면 잠금) 상태에서는
        명령이 배달되지 않고 <b>2분 뒤 만료</b>됩니다 — 보냈다고 복구된 것이 아닙니다.
      </AdminAlert>

      {focusMissing && (
        <AdminAlert tone="warning">
          알림이 지목한 매장이 최근 24시간 접속 목록에 없습니다. 기기가 완전히 꺼져 있어
          원격 명령이 닿지 않는 상태입니다 — 점주 연락이 필요합니다.
        </AdminAlert>
      )}

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
          {(ordered ?? rows).map((r) => {
            const offline = r.status === 'offline';
            const pending = pendingLabel(r.pending_command_status ?? null);
            const source = sourceLabel(r.pending_command_delivery_source ?? r.last_command_delivery_source);
            const focused = !!focusStore && r.store_user_id === focusStore;
            return (
              <AdminCard key={r.session_id}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.store_label}</span>
                  {focused && <AdminBadge tone="info">알림에서 지목됨</AdminBadge>}
                  <AdminBadge tone={statusTone(r.status)}>{statusLabel(r.status)}</AdminBadge>
                  {pending && <AdminBadge tone="info">{pending}</AdminBadge>}
                  {source && <AdminBadge tone="neutral">{source}</AdminBadge>}
                  <span className="text-[11px] text-ink-dim">{r.brand_name}</span>
                  {r.device && <span className="text-[11px] text-ink-dim">· {r.device}</span>}
                  <span className="text-[11px] text-ink-dim">· 신호 {fmtAgo(r.seconds_since_heartbeat)}</span>
                </div>

                <p className="mt-1 truncate text-[12px] text-ink-dim">
                  현재 곡 {r.current_track_title ?? '-'}
                </p>
                <p className="mt-0.5 font-mono text-[10px] text-ink-dim">
                  session {r.session_id.slice(0, 8)} · store {r.store_user_id.slice(0, 8)}
                </p>

                <div className="mt-2 flex flex-wrap gap-2">
                  {/* 27 — 버튼 하나. 운영자는 장애 종류를 판단하지 않는다.
                      ★ offline 이어도 **비활성화하지 않는다.** 2026-09-15 숙대점에서
                      heartbeat 는 끊겼지만 앱 셸은 26분 38초 동안 살아 있었다 —
                      그때 이 콘솔은 모든 버튼을 잠가두고 있었다. 이제 복구 명령은
                      셸 제어면이 받으므로, 셸이 살아 있으면 닿는다. */}
                  {(() => {
                    const plan = planOneClickRecovery({
                      status: r.status,
                      secondsSinceHeartbeat: r.seconds_since_heartbeat,
                    });
                    return (
                      <AdminButton
                        size="sm" variant="solid" tone="primary" leftIcon={<LifeBuoy size={13} />}
                        disabled={busy === `${r.session_id}:${plan.command}`}
                        title={plan.label + (plan.mayNotReach
                          ? ' · 기기가 완전히 꺼져 있으면 2분 뒤 만료됩니다'
                          : '')}
                        onClick={() => void send(r, plan.command)}
                      >
                        매장 긴급 복구
                      </AdminButton>
                    );
                  })()}
                  <AdminButton
                    size="sm" variant="subtle" tone="primary" leftIcon={<Wrench size={13} />}
                    disabled={offline || busy === `${r.session_id}:hard_recovery`}
                    onClick={() => void send(r, 'hard_recovery')}
                  >
                    오디오 재시작
                  </AdminButton>
                  <AdminButton
                    size="sm" variant="ghost" tone="danger" leftIcon={<RotateCcw size={13} />}
                    disabled={offline || busy === `${r.session_id}:reload`}
                    onClick={() => void send(r, 'reload')}
                  >
                    페이지 재시작
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
                      플레이어 heartbeat 끊김 — 앱 셸이 살아 있으면 긴급 복구는 닿습니다
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
