// Phase ENT-OS-1 — 관리자 본사 통합 운영 콘솔 (Enterprise OS).
// 탭: 개요 / 브랜드 / 매장 / 플레이어 / 음악·정책 / 이미지·사이니지 / 계약·정산 / 로그.
// 본사 1곳을 열면 브랜드/매장/음악/이미지/플레이어/정산/로그가 한 흐름에.
//  · 기존 admin_get_enterprise_detail(0406) = 개요/매장/계약·정산/프랜차이즈 음악/로그 (무변경).
//  · admin_get_enterprise_os_detail(0408) = 브랜드/브랜드 음악/이미지/플레이어 세션.
// 브랜드는 본사 내부 객체 — 사용자 입력 코드 없음. 매장은 본사 매장 코드로만 진입.
import { useCallback, useEffect, useState } from 'react';
import { Copy, Plus, Trash2, ExternalLink, Image as ImageIcon, ShieldCheck } from 'lucide-react';
import { AdminModal, AdminCard, AdminButton, AdminBadge, AdminEmpty, AdminSkeleton, AdminAlert, AdminStatCard } from '@/components/admin/ui';
import type { AdminToneName } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  adminGetEnterpriseDetail, adminGetEnterpriseOsDetail,
  type EnterpriseDetail, type EntDetailStore,
  type EnterpriseOsDetail, type EntOsBrandMediaAsset,
} from '@/lib/api/enterpriseDetailApi';
import { adminCreateBrand, adminAddBrandMedia, adminUpdateBrandMedia, adminDeleteBrandMedia } from '@/lib/api/brandPlayerApi';
import { uploadBrandMedia } from '@/lib/brandMediaUpload';
import BrandSignage from '@/components/brand/BrandSignage';

type DetailTab = 'overview' | 'brand' | 'stores' | 'player' | 'music' | 'media' | 'billing' | 'logs';
const TABS: ReadonlyArray<{ key: DetailTab; label: string }> = [
  { key: 'overview', label: '개요' },
  { key: 'brand', label: '브랜드' },
  { key: 'stores', label: '매장' },
  { key: 'player', label: '플레이어' },
  { key: 'music', label: '음악·정책' },
  { key: 'media', label: '이미지·사이니지' },
  { key: 'billing', label: '계약·정산' },
  { key: 'logs', label: '로그' },
];

export default function EnterpriseDetailModal({
  enterpriseId, enterpriseName, onClose,
}: { enterpriseId: string; enterpriseName: string; onClose: () => void }) {
  const [tab, setTab] = useState<DetailTab>('overview');
  const [data, setData] = useState<EnterpriseDetail | null>(null);
  const [os, setOs] = useState<EnterpriseOsDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [d, o] = await Promise.all([
        adminGetEnterpriseDetail(enterpriseId),
        adminGetEnterpriseOsDetail(enterpriseId),
      ]);
      setData(d); setOs(o);
    } catch (e) { setError(e instanceof Error ? e.message : '상세 조회 실패'); }
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
          <div className="flex flex-wrap gap-1 rounded-2xl bg-bg-card p-1 text-xs">
            {TABS.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`rounded-full px-3 py-1.5 font-semibold transition ${tab === t.key ? 'bg-accent text-black' : 'text-ink-mute hover:bg-bg-hover'}`}>
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'overview' && <OverviewTab d={data} />}
          {tab === 'brand' && <BrandTab os={os} enterpriseId={enterpriseId} enterpriseName={data.enterprise.enterprise_name} reload={load} />}
          {tab === 'stores' && <StoresTab d={data} />}
          {tab === 'player' && <PlayerTab os={os} reload={load} />}
          {tab === 'music' && <MusicTab d={data} os={os} />}
          {tab === 'media' && <MediaTab os={os} reload={load} />}
          {tab === 'billing' && <BillingTab d={data} />}
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

// ── 브랜드 ───────────────────────────────────────────────────────────
// 브랜드는 본사 내부 객체. 미연결 시 "이 본사에 브랜드 생성" (코드 없음, 본사명 기본).
function BrandTab({ os, enterpriseId, enterpriseName, reload }: {
  os: EnterpriseOsDetail | null; enterpriseId: string; enterpriseName: string; reload: () => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const brand = os?.brand ?? null;

  async function createBrand() {
    setCreating(true);
    try {
      await adminCreateBrand({ name: enterpriseName, enterpriseAccountId: enterpriseId });
      toast.success('브랜드를 생성하고 이 본사에 연결했어요');
      await reload();
    } catch (e) { toast.error(`브랜드 생성 실패: ${(e as Error).message}`); }
    finally { setCreating(false); }
  }

  if (!brand) {
    return (
      <AdminCard title="브랜드">
        <AdminEmpty
          icon={<ImageIcon size={26} />}
          title="이 본사에 연결된 브랜드가 없어요"
          description="브랜드를 생성하면 이 본사의 매장 코드로 매장이 브랜드 음악·사이니지에 진입합니다. 브랜드는 사용자 입력 코드 없이 관리자 내부 객체로 만들어집니다."
          action={<AdminButton tone="primary" size="sm" leftIcon={<Plus size={14} />} disabled={creating} onClick={() => void createBrand()}>{creating ? '생성 중…' : '이 본사에 브랜드 생성'}</AdminButton>}
        />
        <p className="mt-2 text-center text-[11px] text-ink-dim">브랜드명 기본값: <b className="text-ink-mute">{enterpriseName}</b> · 상태 active · 본사 1:1 자동 연결</p>
      </AdminCard>
    );
  }

  return (
    <div className="space-y-4">
      <AdminCard title="연결 브랜드" subtitle="이 본사에 연결된 브랜드 (본사당 1개).">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-base font-bold text-ink">{brand.name}</span>
          <AdminBadge tone={brand.status === 'active' ? 'success' : 'neutral'}>{brand.status === 'active' ? '활성' : '비활성'}</AdminBadge>
          {brand.industry_type && <AdminBadge tone="neutral">{brand.industry_type}</AdminBadge>}
        </div>
        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
          <KV k="brand_id" v={brand.id} copy mono abbrev />
          <KV k="연결 본사 ID" v={brand.enterprise_account_id} copy mono abbrev />
          <KV k="이미지(전체/활성)" v={`${brand.media_count} / ${brand.active_media_count}`} />
          <KV k="재생 가능 트랙" v={String(brand.playlist_track_count)} />
          <KV k="연결 매장 수" v={String(brand.connected_store_count)} />
          <KV k="생성" v={fmt(brand.created_at)} />
        </dl>
        {brand.description && <p className="mt-2 rounded bg-bg px-2 py-1.5 text-xs text-ink-mute">{brand.description}</p>}
        <p className="mt-3 text-[11px] text-ink-dim">이미지 관리는 <b className="text-ink-mute">이미지·사이니지</b> 탭, 플레이어 상태는 <b className="text-ink-mute">플레이어</b> 탭, 음악 정책은 <b className="text-ink-mute">음악·정책</b> 탭에서 확인하세요. 브랜드 상세 편집(정책/본사 재연결)은 <b className="text-ink-mute">브랜드 플레이어</b> 메뉴에서 수행합니다.</p>
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

function playerTone(st: Pick<EntDetailStore, 'playback_error' | 'player_status' | 'last_seen_at'>): AdminToneName {
  if (st.playback_error) return 'danger';
  if (st.player_status === 'playing') return 'success';
  if (st.player_status === 'paused') return 'warning';
  if (!st.last_seen_at) return 'neutral';
  return 'neutral';
}

// ── 플레이어 ─────────────────────────────────────────────────────────
// 매장 코드(복사) · 연결 브랜드 · 세션 · 설정 상태 · /brand 이동 · 설정 점검(비파괴).
function PlayerTab({ os, reload }: { os: EnterpriseOsDetail | null; reload: () => Promise<void> }) {
  const [checking, setChecking] = useState(false);
  const brand = os?.brand ?? null;
  const code = os?.enterprise.store_invite_code ?? null;

  if (!brand) {
    return <AdminEmpty title="브랜드를 먼저 생성하세요" description="플레이어는 연결 브랜드가 있어야 동작합니다. '브랜드' 탭에서 이 본사에 브랜드를 생성하세요." />;
  }

  const checks = playerReadiness(os);

  async function runCheck() {
    setChecking(true);
    try {
      await reload();
      const r = playerReadiness(os);
      if (r.blocking.length === 0) toast.success('플레이어 설정 정상 — 매장 진입 준비 완료');
      else toast.error(`설정 점검: ${r.blocking.join(', ')}`);
    } finally { setChecking(false); }
  }

  const sum = os?.brand_session_summary;
  const sessions = os?.brand_player_sessions ?? [];

  return (
    <div className="space-y-4">
      <AdminCard title="매장 진입 코드" subtitle="매장은 이 코드만 입력하면 자동으로 연결 브랜드 플레이어에 진입합니다.">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-ink-dim">매장 코드 (Store Invite Code)</p>
            {code ? (
              <div className="mt-0.5 flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-bg px-2 py-1.5 font-mono text-sm font-bold text-ink">{code}</code>
                <button type="button" title="복사" onClick={() => doCopy(code)} className="rounded bg-bg p-1.5 hover:bg-bg-hover"><Copy size={12} /></button>
              </div>
            ) : <p className="mt-0.5 rounded bg-bg px-2 py-1.5 text-xs text-ink-dim">코드 없음 · 본사 초대코드 관리에서 발급</p>}
          </div>
          <div className="flex items-end gap-2">
            <AdminButton size="sm" variant="subtle" tone="neutral" leftIcon={<ExternalLink size={13} />} onClick={() => window.open('/brand', '_blank', 'noopener')}>/brand 열기</AdminButton>
            <AdminButton size="sm" tone="primary" leftIcon={<ShieldCheck size={13} />} disabled={checking} onClick={() => void runCheck()}>{checking ? '점검 중…' : '설정 점검'}</AdminButton>
          </div>
        </div>
      </AdminCard>

      <AdminCard title="설정 상태" subtitle="매장 진입 전 확인 항목 (비파괴 점검).">
        <ul className="space-y-1.5">
          {checks.items.map((c) => (
            <li key={c.label} className="flex items-center justify-between gap-2 border-b border-line/5 pb-1.5 text-xs">
              <span className="text-ink-mute">{c.label}</span>
              <AdminBadge tone={c.tone}>{c.value}</AdminBadge>
            </li>
          ))}
        </ul>
      </AdminCard>

      <AdminCard title="플레이어 세션">
        <div className="mb-3 grid grid-cols-3 gap-2">
          <AdminStatCard label="누적 세션" value={String(sum?.total ?? 0)} />
          <AdminStatCard label="활성(10분)" value={String(sum?.active_recent ?? 0)} tone={(sum?.active_recent ?? 0) > 0 ? 'success' : 'neutral'} />
          <AdminStatCard label="24h" value={String(sum?.last_24h ?? 0)} tone="neutral" />
        </div>
        {sessions.length === 0 ? (
          <AdminEmpty title="세션 기록 없음" description="아직 이 브랜드로 진입한 플레이어가 없습니다." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead className="text-ink-dim"><tr>
                <th className="px-2 py-1 text-left">최근 접속</th><th className="px-2 py-1 text-left">재생 시작</th>
                <th className="px-2 py-1 text-left">현재곡</th><th className="px-2 py-1 text-left">User-Agent</th>
                <th className="px-2 py-1 text-left">session_id</th>
              </tr></thead>
              <tbody>
                {sessions.map((sess) => (
                  <tr key={sess.id} className="border-t border-line/10 align-top">
                    <td className="px-2 py-1.5 whitespace-nowrap text-ink">{fmt(sess.last_seen_at)}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-ink-dim">{fmt(sess.playback_started_at)}</td>
                    <td className="px-2 py-1.5">{sess.current_track_id ? <InlineCopy value={sess.current_track_id} /> : <span className="text-ink-dim">—</span>}</td>
                    <td className="px-2 py-1.5 max-w-[220px] truncate text-ink-mute" title={sess.user_agent ?? ''}>{sess.user_agent ?? '—'}</td>
                    <td className="px-2 py-1.5"><InlineCopy value={sess.id} /></td>
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

function playerReadiness(os: EnterpriseOsDetail | null): {
  items: Array<{ label: string; value: string; tone: AdminToneName }>; blocking: string[];
} {
  const brand = os?.brand ?? null;
  const code = os?.enterprise.store_invite_code ?? null;
  const policy = os?.brand_music_policy ?? null;
  const tracks = brand?.playlist_track_count ?? 0;
  const activeMedia = brand?.active_media_count ?? 0;
  const blocking: string[] = [];
  if (!brand) blocking.push('브랜드 미연결');
  if (!code) blocking.push('매장 코드 없음');
  if (tracks === 0) blocking.push('재생 가능 트랙 없음');
  const items: Array<{ label: string; value: string; tone: AdminToneName }> = [
    { label: '브랜드 연결', value: brand ? '연결됨' : '미연결', tone: brand ? 'success' : 'danger' },
    { label: '매장 코드', value: code ? '발급됨' : '없음', tone: code ? 'success' : 'danger' },
    { label: '음악 정책', value: policy ? '설정됨' : '기본값', tone: policy ? 'success' : 'warning' },
    { label: '재생 가능 트랙', value: String(tracks), tone: tracks > 0 ? 'success' : 'danger' },
    { label: '활성 이미지', value: String(activeMedia), tone: activeMedia > 0 ? 'success' : 'neutral' },
  ];
  return { items, blocking };
}

// ── 음악·정책 (A: 프랜차이즈 / B: 브랜드) ────────────────────────────
function MusicTab({ d, os }: { d: EnterpriseDetail; os: EnterpriseOsDetail | null }) {
  const bp = os?.brand_music_policy ?? null;
  const hasBrand = !!os?.brand;
  return (
    <div className="space-y-4">
      <AdminCard title={`A. 프랜차이즈 음악 정책 (${d.music_policy.length})`} subtitle="본사(franchise) 단위 정책. 매장 정책 버전의 소스.">
        {d.music_policy.length === 0 ? <AdminEmpty title="프랜차이즈 음악 정책 없음" description="등록된 프랜차이즈 음악 정책이 없습니다." /> : (
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

      <AdminCard title="B. 브랜드 음악 정책" subtitle="연결 브랜드의 플레이어 음악 정책 (조회). 편집은 브랜드 플레이어 메뉴에서.">
        {!hasBrand ? (
          <AdminEmpty title="브랜드 미연결" description="'브랜드' 탭에서 이 본사에 브랜드를 생성하면 브랜드 음악 정책이 표시됩니다." />
        ) : !bp ? (
          <AdminEmpty title="브랜드 음악 정책 없음" description="브랜드 기본값으로 자동 생성 재생됩니다." />
        ) : (
          <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
            <KV k="선호 장르" v={csvOrDash(bp.preferred_genres)} />
            <KV k="차단 장르" v={csvOrDash(bp.blocked_genres)} />
            <KV k="선호 무드" v={csvOrDash(bp.preferred_moods)} />
            <KV k="차단 무드" v={csvOrDash(bp.blocked_moods)} />
            <KV k="에너지" v={`${bp.energy_min ?? '—'} ~ ${bp.energy_max ?? '—'}`} />
            <KV k="보컬 정책" v={bp.vocal_policy} />
            <KV k="자동 플리 생성" v={bp.auto_generate_enabled ? '사용' : '미사용'} />
          </dl>
        )}
      </AdminCard>
    </div>
  );
}

// ── 이미지·사이니지 ──────────────────────────────────────────────────
// 연결 브랜드의 media_assets 관리 (이미지 전용). 업로드 로직은 BrandPlayerPanel 재사용.
function MediaTab({ os, reload }: { os: EnterpriseOsDetail | null; reload: () => Promise<void> }) {
  const [uploading, setUploading] = useState(false);
  const brand = os?.brand ?? null;
  const assets = os?.brand_media_assets ?? [];

  if (!brand) {
    return <AdminEmpty title="브랜드를 먼저 생성하세요" description="이미지·사이니지는 연결 브랜드가 있어야 등록할 수 있습니다. '브랜드' 탭에서 브랜드를 생성하세요." />;
  }

  async function onPickImage(file: File) {
    setUploading(true);
    try {
      const up = await uploadBrandMedia(brand!.id, file);
      if (!up.ok || !up.url) { toast.error(up.error || '업로드 실패'); return; }
      await adminAddBrandMedia({ brandId: brand!.id, imageUrl: up.url, displayDurationSeconds: 10 });
      toast.success('이미지를 추가했어요'); await reload();
    } catch (e) { toast.error(`이미지 추가 실패: ${(e as Error).message}`); }
    finally { setUploading(false); }
  }

  async function toggleMedia(m: EntOsBrandMediaAsset) {
    try {
      await adminUpdateBrandMedia({ assetId: m.id, status: m.status === 'active' ? 'inactive' : 'active' });
      await reload();
    } catch (e) { toast.error(`수정 실패: ${(e as Error).message}`); }
  }
  async function deleteMedia(id: string) {
    if (!confirm('이 이미지를 삭제할까요?')) return;
    try { await adminDeleteBrandMedia(id); toast.success('삭제했어요'); await reload(); }
    catch (e) { toast.error(`삭제 실패: ${(e as Error).message}`); }
  }

  const previewItems = assets
    .filter((m) => (m.status ?? 'active') === 'active')
    .map((m) => ({ id: m.id, title: m.title, image_url: m.image_url, display_duration_seconds: m.display_duration_seconds ?? 10 }));

  return (
    <AdminCard
      title={`이미지 사이니지 (${assets.length})`}
      subtitle="순서대로 노출 시간만큼 표시 후 반복. jpg/png/webp, 10MB 이하. (영상/HTML은 추후)"
      action={
        <label className="cursor-pointer">
          <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={uploading}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPickImage(f); e.currentTarget.value = ''; }} />
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-black">
            <Plus size={13} /> {uploading ? '업로드 중…' : '이미지 추가'}
          </span>
        </label>
      }
    >
      {assets.length === 0 ? (
        <AdminEmpty icon={<ImageIcon size={22} />} title="이미지 없음" description="이미지를 추가하면 플레이어에서 순차 노출됩니다." />
      ) : (
        <div className="space-y-2">
          {assets.map((m) => (
            <div key={m.id} className="flex items-center gap-3 rounded-lg border border-line/20 bg-bg p-2">
              <img src={m.image_url} alt={m.title ?? ''} className="h-12 w-16 shrink-0 rounded object-cover" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-ink">{m.title || '(제목 없음)'}</p>
                <p className="text-[11px] text-ink-dim">노출 {m.display_duration_seconds ?? '—'}초 · 순서 {m.sort_order ?? '—'}</p>
              </div>
              <AdminBadge tone={(m.status ?? 'active') === 'active' ? 'success' : 'neutral'}>{(m.status ?? 'active') === 'active' ? '표시' : '숨김'}</AdminBadge>
              <AdminButton size="sm" variant="ghost" tone={m.status === 'active' ? 'neutral' : 'success'} onClick={() => void toggleMedia(m)}>{m.status === 'active' ? '숨김' : '표시'}</AdminButton>
              <AdminButton size="sm" variant="ghost" tone="danger" onClick={() => void deleteMedia(m.id)}><Trash2 size={13} /></AdminButton>
            </div>
          ))}
        </div>
      )}

      {previewItems.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-[11px] font-semibold text-ink-dim">플레이어 미리보기</p>
          <BrandSignage items={previewItems} brandName={brand.name} className="h-48 w-full rounded-lg" />
        </div>
      )}
    </AdminCard>
  );
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

function csvOrDash(arr: string[] | null | undefined): string | null {
  const list = (arr ?? []).filter(Boolean);
  return list.length ? list.join(', ') : null;
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
