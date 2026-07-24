/**
 * EnterpriseOpsStoreDetailPage — ENTERPRISE-HQ-OPS-1
 *
 * 본사(HQ) 가맹점 상세. 경로: /enterprise/operations/stores/:storeId
 *
 * 섹션: Overview · Playback · Health · Billing · Device
 * - 실제 존재하는 데이터만 표시. Queue/Scheduler 상세·Streaming Quality·매장별 재생량은
 *   아직 미구현 → '현재 미지원' 으로 명확히 표기 (구현된 것처럼 표시 금지).
 * - 상태(operational)는 서버 판정을 그대로 표시 (클라이언트 재계산 없음).
 *
 * 권한은 서버 RPC(get_my_enterprise_ops_store_detail)가 소유 검증까지 강제한다.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import {
  AlertCircle, ArrowLeft, RefreshCw, Radio, HeartPulse, CreditCard, MonitorSmartphone, PlayCircle, Ban,
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import {
  getMyEnterpriseOpsStoreDetail,
  type HqStoreDetail,
} from '@/lib/api/enterpriseHqOpsFleetApi';
import {
  OPERATIONAL_STATUS_LABEL,
  OPERATIONAL_STATUS_TONE,
  HEARTBEAT_STATE_LABEL,
  HEARTBEAT_STATE_TONE,
  fieldOrAbsent,
  formatDDay,
  formatRelativeTime,
  type StatusTone,
} from '@/lib/hqOpsFleet';

const TONE_CLASS: Record<StatusTone, string> = {
  green: 'bg-emerald-500/15 text-emerald-600 ring-emerald-500/30 dark:text-emerald-300',
  amber: 'bg-amber-500/15 text-amber-600 ring-amber-500/30 dark:text-amber-300',
  red: 'bg-rose-500/15 text-rose-600 ring-rose-500/30 dark:text-rose-300',
  gray: 'bg-slate-500/15 text-slate-600 ring-slate-500/30 dark:text-slate-300',
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 text-xs">
      <span className="shrink-0 text-ink-mute">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
      <h2 className="mb-2 flex items-center gap-1.5 text-sm font-bold">{icon}{title}</h2>
      <div className="divide-y divide-line/10">{children}</div>
    </section>
  );
}

/** 미구현 기능 명시 배너 */
function Unsupported({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg bg-bg-deep px-3 py-2 text-[11px] text-ink-mute">
      <Ban size={12} /> {label} — 현재 미지원
    </div>
  );
}

function fmtSeconds(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return '데이터 없음';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function EnterpriseOpsStoreDetailPage() {
  const user = useAuthStore((s) => s.user);
  const { storeId } = useParams<{ storeId: string }>();

  const [detail, setDetail] = useState<HqStoreDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    setError(null);
    try {
      setDetail(await getMyEnterpriseOpsStoreDetail(storeId));
    } catch (e) {
      setError(e instanceof Error ? e.message : '불러오기 실패');
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => { void load(); }, [load]);

  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className="mb-4 flex items-center gap-3">
        <Link to="/enterprise/operations/stores" className="flex h-9 w-9 items-center justify-center rounded-full bg-bg-card" aria-label="목록으로">
          <ArrowLeft size={18} />
        </Link>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-extrabold tracking-tight">
            {detail ? detail.overview.store_name : '매장 상세'}
          </h1>
          <p className="text-xs text-ink-mute">가맹점 운영 상세</p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="ml-auto inline-flex items-center gap-1 rounded bg-bg-card px-2.5 py-1.5 text-[11px] font-semibold hover:bg-bg-hover disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 새로고침
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-2xl bg-rose-50 border border-rose-200 p-4 dark:bg-rose-500/25 dark:border-transparent dark:ring-1 dark:ring-rose-400/40">
          <p className="flex items-center gap-1.5 text-sm text-slate-900 dark:text-rose-100">
            <AlertCircle size={15} /> {error}
          </p>
        </div>
      )}

      {loading && !detail ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-bg-card" />
          ))}
        </div>
      ) : detail ? (
        <div className="space-y-3">
          {/* Overview */}
          <Card title="Overview" icon={<Radio size={15} className="text-accent" />}>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-xs text-ink-mute">운영 상태</span>
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ${TONE_CLASS[OPERATIONAL_STATUS_TONE[detail.overview.operational.status]]}`}>
                {OPERATIONAL_STATUS_LABEL[detail.overview.operational.status]}
              </span>
            </div>
            {detail.overview.operational.reasons.length > 0 && (
              <div className="py-1.5">
                <div className="flex flex-wrap gap-1">
                  {detail.overview.operational.reasons.map((r, i) => (
                    <span key={i} className="rounded bg-bg-deep px-1.5 py-0.5 text-[10px] text-ink-mute">{r}</span>
                  ))}
                </div>
              </div>
            )}
            <Row label="활성 여부" value={detail.overview.is_active ? '활성' : '비활성'} />
            <Row label="브랜드/프랜차이즈" value={fieldOrAbsent(detail.overview.franchise_name)} />
            <Row label="업종" value={fieldOrAbsent(detail.overview.business_category)} />
            <Row label="Store Code" value={<span className="text-ink-mute">미지원</span>} />
            <Row label="연결일" value={detail.overview.joined_at ? new Date(detail.overview.joined_at).toLocaleDateString('ko-KR') : '데이터 없음'} />
          </Card>

          {/* Playback */}
          <Card title="Playback" icon={<PlayCircle size={15} className="text-accent" />}>
            <Row label="현재 재생 곡" value={detail.playback.current_track_title
              ? `${detail.playback.current_track_title} — ${fieldOrAbsent(detail.playback.current_track_artist)}`
              : <span className="text-ink-mute">재생 정보 없음</span>} />
            <Row label="재생 상태" value={fieldOrAbsent(detail.playback.player_status)} />
            <Row label="재생 시작" value={detail.playback.started_at ? formatRelativeTime(detail.playback.started_at) : '데이터 없음'} />
            <Row label="경과 / 남은" value={`${fmtSeconds(detail.playback.elapsed_seconds)} / ${fmtSeconds(detail.playback.remaining_seconds)}`} />
            <Row label="최근 Player Error" value={detail.playback.playback_error
              ? <span className="text-rose-500">{detail.playback.playback_error}</span>
              : <span className="text-ink-mute">없음</span>} />
            <div className="pt-2 space-y-1.5">
              <Unsupported label="Queue / 다음 재생 곡" />
              <Unsupported label="Scheduler 상세" />
              <Unsupported label="Streaming Quality / Buffering" />
            </div>
          </Card>

          {/* Health */}
          <Card title="Health" icon={<HeartPulse size={15} className="text-accent" />}>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-xs text-ink-mute">Health Score</span>
              <span className="text-xl font-extrabold tabular-nums">
                {detail.health.score === null ? '—' : detail.health.score}
              </span>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-xs text-ink-mute">Heartbeat</span>
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ${TONE_CLASS[HEARTBEAT_STATE_TONE[detail.health.heartbeat_state]]}`}>
                {HEARTBEAT_STATE_LABEL[detail.health.heartbeat_state]}
              </span>
            </div>
            <Row label="마지막 Heartbeat" value={formatRelativeTime(detail.health.last_heartbeat_at)} />
            <Row label="활성 Alert" value={`${detail.health.active_alert_count}건`} />
            {detail.health.breakdown && Object.keys(detail.health.breakdown).length > 0 && (
              <div className="py-1.5">
                <div className="flex flex-wrap gap-1">
                  {Object.entries(detail.health.breakdown).map(([k, v]) => (
                    <span key={k} className="rounded bg-bg-deep px-1.5 py-0.5 text-[10px] text-ink-mute">{k}: {v}</span>
                  ))}
                </div>
              </div>
            )}
            <div className="pt-2">
              <Unsupported label="Heartbeat / Online 이력 Timeline" />
            </div>
          </Card>

          {/* Billing */}
          <Card title="Billing / 계약" icon={<CreditCard size={15} className="text-accent" />}>
            <Row label="구분" value={<span className="text-ink-mute">본사 단위 (매장 공유)</span>} />
            <Row label="미납 인보이스" value={`${detail.billing.unpaid_invoice_count}건`} />
            <Row label="연체" value={detail.billing.is_overdue ? <span className="text-rose-500 font-bold">연체 발생</span> : '없음'} />
            {detail.billing.current_invoice ? (
              <>
                <Row label="최근 인보이스" value={`${detail.billing.current_invoice.billing_month} · ${detail.billing.current_invoice.status}`} />
                <Row label="청구액" value={`${detail.billing.current_invoice.total_amount.toLocaleString('ko-KR')}원`} />
              </>
            ) : (
              <Row label="최근 인보이스" value={<span className="text-ink-mute">데이터 없음</span>} />
            )}
            {detail.billing.contract ? (
              <>
                <Row label="계약" value={`${detail.billing.contract.contract_no} · ${detail.billing.contract.status}`} />
                <Row label="계약 기간" value={`${fieldOrAbsent(detail.billing.contract.start_date)} ~ ${fieldOrAbsent(detail.billing.contract.end_date)}`} />
                <Row label="만료 D-Day" value={
                  <span className={detail.billing.contract.is_expiring ? 'text-amber-500 font-bold' : ''}>
                    {formatDDay(detail.billing.contract.days_to_end)}
                  </span>
                } />
              </>
            ) : (
              <Row label="계약" value={<span className="text-ink-mute">데이터 없음</span>} />
            )}
            {detail.billing.settlement ? (
              <Row label="최근 정산" value={`${detail.billing.settlement.settlement_month} · ${detail.billing.settlement.status}`} />
            ) : (
              <Row label="정산" value={<span className="text-ink-mute">데이터 없음</span>} />
            )}
          </Card>

          {/* Device */}
          <Card title="Device" icon={<MonitorSmartphone size={15} className="text-accent" />}>
            <Row label="Player Version" value={fieldOrAbsent(detail.device.app_version, '수집 전')} />
            <Row label="업데이트 필요" value={detail.device.has_update_required ? <span className="text-amber-500 font-bold">필요</span> : '아니오'} />
            <Row label="Device Model" value={fieldOrAbsent(detail.device.device_model, '수집 전')} />
            <Row label="OS" value={fieldOrAbsent(detail.device.device_os, '수집 전')} />
            <Row label="Device ID" value={fieldOrAbsent(detail.device.device_identifier, '수집 전')} />
            <Row label="네트워크" value={fieldOrAbsent(detail.device.connection_type, '수집 전')} />
            <Row label="Wi-Fi" value={fieldOrAbsent(detail.device.wifi_ssid, '수집 전')} />
            <Row label="마지막 접속" value={formatRelativeTime(detail.device.last_heartbeat_at)} />
          </Card>
        </div>
      ) : null}
    </div>
  );
}
