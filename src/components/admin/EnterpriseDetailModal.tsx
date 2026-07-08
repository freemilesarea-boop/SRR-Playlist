// Phase ENT-DETAIL-1 — 관리자 본사 상세 콘솔 (조회 전용, CS/운영용).
// 탭: 개요 / 매장 / 계약·정산 / 음악·정책 / 로그. 코드/UUID 복사, 로딩·에러·empty 상태.
import { useCallback, useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { AdminModal, AdminCard, AdminButton, AdminBadge, AdminEmpty, AdminSkeleton, AdminAlert, AdminStatCard } from '@/components/admin/ui';
import type { AdminToneName } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import { adminGetEnterpriseDetail, type EnterpriseDetail, type EntDetailStore } from '@/lib/api/enterpriseDetailApi';

type DetailTab = 'overview' | 'stores' | 'billing' | 'music' | 'logs';
const TABS: ReadonlyArray<{ key: DetailTab; label: string }> = [
  { key: 'overview', label: '개요' },
  { key: 'stores', label: '매장' },
  { key: 'billing', label: '계약·정산' },
  { key: 'music', label: '음악·정책' },
  { key: 'logs', label: '로그' },
];

export default function EnterpriseDetailModal({
  enterpriseId, enterpriseName, onClose,
}: { enterpriseId: string; enterpriseName: string; onClose: () => void }) {
  const [tab, setTab] = useState<DetailTab>('overview');
  const [data, setData] = useState<EnterpriseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await adminGetEnterpriseDetail(enterpriseId)); }
    catch (e) { setError(e instanceof Error ? e.message : '상세 조회 실패'); }
    finally { setLoading(false); }
  }, [enterpriseId]);
  useEffect(() => { void load(); }, [load]);

  const s = data?.store_summary;

  return (
    <AdminModal
      open size="xl" onClose={onClose}
      title={<span className="flex items-center gap-2">{data?.enterprise.enterprise_name ?? enterpriseName}{data && <StatusBadge status={data.enterprise.status} />}{data?.enterprise.deleted_at && <AdminBadge tone="danger">삭제됨</AdminBadge>}</span>}
      headerExtra={<AdminButton size="sm" variant="subtle" tone="neutral" onClick={() => void load()}>새로고침</AdminButton>}
      footer={<AdminButton tone="neutral" variant="subtle" onClick={onClose}>닫기</AdminButton>}
    >
      {loading && !data ? (
        <AdminSkeleton variant="block" rows={8} />
      ) : error ? (
        <AdminAlert tone="danger" title="조회 실패" description={error} action={<AdminButton size="sm" onClick={() => void load()}>재시도</AdminButton>} />
      ) : data ? (
        <div className="space-y-4">
          {/* 운영 요약 카드 */}
          {s && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              <AdminStatCard label="총 매장" value={String(s.total)} />
              <AdminStatCard label="활성" value={String(s.active)} tone="success" />
              <AdminStatCard label="재생중" value={String(s.playing)} tone="info" />
              <AdminStatCard label="10분내 접속" value={String(s.heartbeat_recent)} tone={s.heartbeat_recent > 0 ? 'success' : 'neutral'} />
              <AdminStatCard label="24h 접속" value={String(s.connected_24h)} tone="neutral" />
              <AdminStatCard label="오프라인/오류" value={String(s.offline_or_error)} tone={s.offline_or_error > 0 ? 'warning' : 'neutral'} />
            </div>
          )}

          {/* 탭바 */}
          <div className="flex flex-wrap gap-1 rounded-full bg-bg-card p-1 text-xs">
            {TABS.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`flex-1 rounded-full px-3 py-1.5 font-semibold transition ${tab === t.key ? 'bg-accent text-black' : 'text-ink-mute hover:bg-bg-hover'}`}>
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'overview' && <OverviewTab d={data} />}
          {tab === 'stores' && <StoresTab d={data} />}
          {tab === 'billing' && <BillingTab d={data} />}
          {tab === 'music' && <MusicTab d={data} />}
          {tab === 'logs' && <LogsTab d={data} />}
        </div>
      ) : null}
    </AdminModal>
  );
}

// ── 개요 ─────────────────────────────────────────────────────────────
function OverviewTab({ d }: { d: EnterpriseDetail }) {
  const e = d.enterprise; const bp = d.business_profile; const inv = d.invite;
  return (
    <div className="space-y-4">
      <AdminCard title="본사 기본 정보">
        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
          <KV k="enterprise_id" v={e.id} copy mono abbrev />
          <KV k="본사명" v={e.enterprise_name} />
          <KV k="담당자" v={e.manager_name} />
          <KV k="이메일" v={e.manager_email} copy />
          <KV k="전화번호" v={e.manager_phone} copy />
          <KV k="권한(role)" v={e.role} />
          <KV k="생성" v={fmt(e.created_at)} />
          <KV k="수정" v={fmt(e.updated_at)} />
          <KV k="최근 로그인" v={fmt(e.last_login_at)} />
          <KV k="삭제" v={e.deleted_at ? fmt(e.deleted_at) : '—'} />
          <KV k="auth_user_id" v={e.auth_user_id} copy mono abbrev />
          <KV k="온보딩 허용" v={e.onboarding_enabled ? 'Y' : 'N'} />
        </dl>
        {e.notes && <p className="mt-2 rounded bg-bg px-2 py-1.5 text-xs text-ink-mute">메모: {e.notes}</p>}
      </AdminCard>

      <AdminCard title="사업자 / 정산 담당">
        {bp ? (
          <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
            <KV k="상호" v={bp.company_name} />
            <KV k="사업자번호" v={bp.business_number} copy />
            <KV k="대표자" v={bp.representative_name} />
            <KV k="주소" v={bp.business_address} />
            <KV k="연락처" v={bp.contact_phone} copy />
            <KV k="세금계산서 이메일" v={bp.tax_invoice_email} copy />
            <KV k="정산담당" v={bp.settlement_contact_name} />
            <KV k="정산담당 연락처" v={bp.settlement_contact_phone} copy />
          </dl>
        ) : <AdminEmpty title="사업자 프로필 없음" description="아직 등록되지 않았습니다." />}
      </AdminCard>

      <AdminCard title="초대 / 코드">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <CodeRow label="HQ 초대코드" value={inv.hq_invite_code} />
          <CodeRow label="매장 초대코드" value={inv.store_invite_code} />
          <CodeRow label="브랜드 코드" value={inv.brand_code} />
        </div>
        {inv.invite_code_rotated_at && <p className="mt-2 text-[11px] text-ink-dim">코드 최근 재발급: {fmt(inv.invite_code_rotated_at)}</p>}
        <p className="mt-1 text-[11px] text-ink-dim">코드 재발급/수정은 "초대코드 관리"(별도 confirm)에서 수행하세요.</p>

        <p className="mt-3 mb-1 text-[11px] font-semibold text-ink-dim">가입/초대 claim 이력 ({inv.claims.length})</p>
        {inv.claims.length === 0 ? (
          <p className="text-xs text-ink-dim">claim 이력 없음</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead><tr className="text-ink-dim"><th className="px-2 py-1 text-left">유형</th><th className="px-2 py-1 text-left">상태</th><th className="px-2 py-1 text-left">코드끝4</th><th className="px-2 py-1 text-left">입력값</th><th className="px-2 py-1 text-left">시각</th></tr></thead>
              <tbody>
                {inv.claims.map((c, i) => (
                  <tr key={i} className="border-t border-line/10">
                    <td className="px-2 py-1">{c.claim_type ?? '—'}</td>
                    <td className="px-2 py-1"><AdminBadge tone={c.status === 'success' ? 'success' : c.status === 'failed' ? 'danger' : 'neutral'}>{c.status ?? '—'}</AdminBadge></td>
                    <td className="px-2 py-1 font-mono">{c.invite_code_last4 ?? '—'}</td>
                    <td className="px-2 py-1 text-ink-mute">{[c.store_name_input, c.region_name_input, c.brand_name_input].filter(Boolean).join(' / ') || '—'}</td>
                    <td className="px-2 py-1 text-ink-dim">{fmt(c.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminCard>

      <AdminCard title={`지역 (${d.regions.length})`}>
        {d.regions.length === 0 ? <AdminEmpty title="지역 없음" /> : (
          <div className="flex flex-wrap gap-2">
            {d.regions.map((r) => (
              <div key={r.id} className="rounded-lg border border-line/20 bg-bg px-3 py-1.5 text-xs">
                <span className="font-semibold text-ink">{r.region_name ?? '—'}</span>
                {r.region_code && <span className="ml-1 font-mono text-ink-dim">{r.region_code}</span>}
                <span className="ml-2 text-ink-mute">매장 {r.store_count ?? 0}</span>
              </div>
            ))}
          </div>
        )}
      </AdminCard>
    </div>
  );
}

// ── 매장 ─────────────────────────────────────────────────────────────
function StoresTab({ d }: { d: EnterpriseDetail }) {
  if (d.stores.length === 0) return <AdminEmpty title="연결된 매장 없음" description="이 본사에 등록된 매장이 없습니다." />;
  return (
    <AdminCard title={`매장 목록 (${d.stores.length})`} subtitle="플레이어 상태·정책 버전·현재 재생곡 (CS 조회용)">
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead className="text-ink-dim">
            <tr>
              <th className="px-2 py-1 text-left">매장</th><th className="px-2 py-1 text-left">지역</th>
              <th className="px-2 py-1 text-left">상태</th><th className="px-2 py-1 text-left">플레이어</th>
              <th className="px-2 py-1 text-left">최근접속</th><th className="px-2 py-1 text-left">정책 v</th>
              <th className="px-2 py-1 text-left">현재곡</th><th className="px-2 py-1 text-left">기기/오류</th>
              <th className="px-2 py-1 text-left">store_id</th>
            </tr>
          </thead>
          <tbody>
            {d.stores.map((st) => (
              <tr key={st.store_id} className="border-t border-line/10 align-top">
                <td className="px-2 py-1.5"><div className="font-semibold text-ink">{st.store_name ?? '—'}</div>{st.business_category && <div className="text-ink-dim">{st.business_category}</div>}</td>
                <td className="px-2 py-1.5 text-ink-mute">{st.region_name ?? '—'}</td>
                <td className="px-2 py-1.5"><AdminBadge tone={st.store_status === 'active' ? 'success' : 'neutral'}>{st.store_status ?? '—'}</AdminBadge></td>
                <td className="px-2 py-1.5"><AdminBadge tone={playerTone(st)}>{st.player_status ?? 'unknown'}</AdminBadge></td>
                <td className="px-2 py-1.5 text-ink-dim">{st.last_seen_at ? fmt(st.last_seen_at) : '미접속'}</td>
                <td className="px-2 py-1.5">{st.active_version_number != null ? `v${st.active_version_number}` : '—'}</td>
                <td className="px-2 py-1.5 text-ink-mute">{st.current_track_title ? `${st.current_track_title}${st.current_track_artist ? ' · ' + st.current_track_artist : ''}` : '—'}</td>
                <td className="px-2 py-1.5">{st.device_model || st.device_os ? <span className="text-ink-mute">{[st.device_model, st.device_os].filter(Boolean).join(' / ')}</span> : <span className="text-ink-dim">—</span>}{st.playback_error && <div className="text-danger">⚠ {st.playback_error}</div>}</td>
                <td className="px-2 py-1.5"><InlineCopy value={st.store_id} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminCard>
  );
}

function playerTone(st: EntDetailStore): AdminToneName {
  if (st.playback_error) return 'danger';
  if (st.player_status === 'playing') return 'success';
  if (st.player_status === 'paused') return 'warning';
  if (!st.last_seen_at) return 'neutral';
  return 'neutral';
}

// ── 계약·정산 ────────────────────────────────────────────────────────
function BillingTab({ d }: { d: EnterpriseDetail }) {
  const c = d.contract;
  return (
    <div className="space-y-4">
      <AdminCard title="현재 계약">
        {c ? (
          <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
            <KV k="계약번호" v={c.contract_no} copy />
            <KV k="계약명" v={c.contract_name} />
            <KV k="상태" v={c.status} />
            <KV k="유형" v={c.contract_type} />
            <KV k="기간" v={`${c.start_date ?? '—'} ~ ${c.end_date ?? '—'}`} />
            <KV k="자동갱신" v={c.auto_renew ? 'Y' : 'N'} />
            <KV k="매장 단가(월)" v={won(c.monthly_store_price)} />
            <KV k="수수료율" v={c.commission_rate != null ? `${c.commission_rate}%` : null} />
            <KV k="최소 정산금" v={won(c.minimum_payout)} />
            <KV k="정산방식" v={c.settlement_method} />
            <KV k="서명일" v={fmt(c.signed_at)} />
          </dl>
        ) : <AdminEmpty title="계약 없음" description="등록된 계약이 없습니다." />}
      </AdminCard>

      <AdminCard title={`월 정산 이력 (${d.settlements.length})`}>
        {d.settlements.length === 0 ? <AdminEmpty title="정산 이력 없음" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead className="text-ink-dim"><tr>
                <th className="px-2 py-1 text-left">정산월</th><th className="px-2 py-1 text-left">상태</th>
                <th className="px-2 py-1 text-right">매장수</th><th className="px-2 py-1 text-right">매장단가</th>
                <th className="px-2 py-1 text-right">수수료율</th><th className="px-2 py-1 text-right">총 커미션</th>
                <th className="px-2 py-1 text-left">최소미달</th><th className="px-2 py-1 text-left">지급일</th>
              </tr></thead>
              <tbody>
                {d.settlements.map((ms) => (
                  <tr key={ms.id} className="border-t border-line/10">
                    <td className="px-2 py-1">{ms.settlement_month ?? '—'}</td>
                    <td className="px-2 py-1"><AdminBadge tone={ms.status === 'paid' ? 'success' : ms.status === 'approved' ? 'info' : ms.status === 'held' ? 'warning' : 'neutral'}>{ms.status ?? '—'}</AdminBadge></td>
                    <td className="px-2 py-1 text-right">{ms.active_store_count ?? '—'}</td>
                    <td className="px-2 py-1 text-right">{won(ms.monthly_store_price)}</td>
                    <td className="px-2 py-1 text-right">{ms.commission_rate != null ? `${ms.commission_rate}%` : '—'}</td>
                    <td className="px-2 py-1 text-right font-semibold">{won(ms.total_commission)}</td>
                    <td className="px-2 py-1">{ms.below_minimum ? <AdminBadge tone="warning">미달</AdminBadge> : '—'}</td>
                    <td className="px-2 py-1 text-ink-dim">{ms.paid_at ? fmt(ms.paid_at) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminCard>
    </div>
  );
}

// ── 음악·정책 ────────────────────────────────────────────────────────
function MusicTab({ d }: { d: EnterpriseDetail }) {
  return (
    <AdminCard title={`음악 정책 (${d.music_policy.length})`} subtitle="본사(franchise) 음악 정책. 매장별 업종은 '매장' 탭 참고.">
      {d.music_policy.length === 0 ? <AdminEmpty title="음악 정책 없음" description="등록된 프랜차이즈 음악 정책이 없습니다." /> : (
        <div className="space-y-2">
          {d.music_policy.map((mp) => (
            <div key={mp.id} className="rounded-lg border border-line/20 bg-bg p-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-ink">{mp.name ?? '(무명 정책)'}</span>
                {mp.is_default && <AdminBadge tone="info">기본</AdminBadge>}
                <AdminBadge tone={mp.status === 'active' ? 'success' : 'neutral'}>{mp.status ?? '—'}</AdminBadge>
                {mp.latest_version != null && <span className="text-[11px] text-ink-dim">v{mp.latest_version}</span>}
              </div>
              {mp.description && <p className="mt-1 text-xs text-ink-mute">{mp.description}</p>}
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
                <KV k="소스" v={mp.source_type} />
                <KV k="트랙수(snapshot)" v={mp.track_count_snapshot != null ? String(mp.track_count_snapshot) : null} />
                <KV k="적용시작" v={fmt(mp.effective_from)} />
                <KV k="source_playlist_id" v={mp.source_playlist_id} copy mono abbrev />
              </dl>
            </div>
          ))}
        </div>
      )}
    </AdminCard>
  );
}

// ── 로그 ─────────────────────────────────────────────────────────────
function LogsTab({ d }: { d: EnterpriseDetail }) {
  return (
    <AdminCard title={`감사 로그 (최근 ${d.audit_logs.length})`}>
      {d.audit_logs.length === 0 ? <AdminEmpty title="관련 로그 없음" description="이 본사와 연결된 운영 로그가 없습니다." /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead className="text-ink-dim"><tr>
              <th className="px-2 py-1 text-left">시각</th><th className="px-2 py-1 text-left">source</th>
              <th className="px-2 py-1 text-left">category</th><th className="px-2 py-1 text-left">level</th>
              <th className="px-2 py-1 text-left">메시지</th>
            </tr></thead>
            <tbody>
              {d.audit_logs.map((l, i) => (
                <tr key={i} className="border-t border-line/10">
                  <td className="px-2 py-1 whitespace-nowrap text-ink-dim">{fmt(l.created_at)}</td>
                  <td className="px-2 py-1 text-ink-mute">{l.source ?? '—'}</td>
                  <td className="px-2 py-1 text-ink-mute">{l.category ?? '—'}</td>
                  <td className="px-2 py-1"><AdminBadge tone={l.level === 'error' ? 'danger' : l.level === 'warn' ? 'warning' : 'neutral'}>{l.level ?? '—'}</AdminBadge></td>
                  <td className="px-2 py-1 text-ink">{l.message ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminCard>
  );
}

// ── shared helpers ───────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const tone: AdminToneName = status === 'active' ? 'success' : status === 'suspended' ? 'warning' : status === 'invited' ? 'info' : 'neutral';
  return <AdminBadge tone={tone}>{status}</AdminBadge>;
}

function KV({ k, v, copy, mono, abbrev }: { k: string; v: string | null | undefined; copy?: boolean; mono?: boolean; abbrev?: boolean }) {
  const val = v ?? '—';
  const shown = abbrev && v && v.length > 12 ? `${v.slice(0, 8)}…` : val;
  return (
    <div className="flex items-start justify-between gap-2 border-b border-line/5 pb-1">
      <span className="shrink-0 text-[11px] text-ink-dim">{k}</span>
      <span className="flex items-center gap-1 text-right">
        <span className={`text-xs text-ink ${mono ? 'font-mono' : ''}`}>{shown}</span>
        {copy && v && <button type="button" title="복사" onClick={() => doCopy(v)} className="rounded p-0.5 text-ink-dim hover:bg-bg-hover hover:text-ink"><Copy size={11} /></button>}
      </span>
    </div>
  );
}

function CodeRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-ink-dim">{label}</p>
      {value ? (
        <div className="mt-0.5 flex items-center gap-2">
          <code className="flex-1 truncate rounded bg-bg px-2 py-1 font-mono text-sm font-semibold text-ink">{value}</code>
          <button type="button" title="복사" onClick={() => doCopy(value)} className="rounded bg-bg p-1.5 hover:bg-bg-hover"><Copy size={11} /></button>
        </div>
      ) : (
        <div className="mt-0.5 flex items-center gap-2 rounded bg-bg px-2 py-1 text-xs text-ink-dim">현재 없음 · 재발급 필요</div>
      )}
    </div>
  );
}

function InlineCopy({ value }: { value: string }) {
  return (
    <button type="button" title={value} onClick={() => doCopy(value)} className="inline-flex items-center gap-1 font-mono text-ink-dim hover:text-ink">
      {value.slice(0, 8)}… <Copy size={10} />
    </button>
  );
}

function doCopy(v: string) {
  void navigator.clipboard?.writeText(v).then(() => toast.success('복사됨')).catch(() => toast.error('복사 실패'));
}

function fmt(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
}

function won(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${n.toLocaleString('ko-KR')}원`;
}
