// Phase ENT-DETAIL-1 — 관리자 본사 상세 콘솔 (조회 전용, CS/운영용).
// 탭: 개요 / 매장 / 계약·정산 / 음악·정책 / 로그. 코드/UUID 복사, 로딩·에러·empty 상태.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Copy, CheckCircle2, AlertTriangle, MinusCircle, CircleDashed, ChevronRight, ChevronDown } from 'lucide-react';
import { AdminModal, AdminCard, AdminButton, AdminBadge, AdminEmpty, AdminSkeleton, AdminAlert, AdminStatCard } from '@/components/admin/ui';
import type { AdminToneName } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import { adminGetEnterpriseDetail, type EnterpriseDetail, type EntDetailRegion, type EntDetailInviteClaim, type EntDetailStore } from '@/lib/api/enterpriseDetailApi';
import {
  computeEnterpriseReadiness, countIncomplete, settlementReadiness,
  getEnterpriseRequiredActions, splitForDisplay,
  type ReadinessItem, type ReadinessStatus, type ReadinessActionKind,
} from '@/lib/enterpriseReadiness';

type DetailTab = 'overview' | 'stores' | 'billing' | 'music' | 'logs';
const TABS: ReadonlyArray<{ key: DetailTab; label: string }> = [
  { key: 'overview', label: '개요' },
  { key: 'stores', label: '매장' },
  { key: 'billing', label: '계약·정산' },
  { key: 'music', label: '음악·정책' },
  { key: 'logs', label: '로그' },
];

/**
 * 운영 준비 상태 보드의 '즉시 처리' 액션 — 모두 기존 지원 기능에 연결된다(신규 백엔드 없음).
 * 부모(EnterpriseAccountsPanel)가 자신이 이미 렌더하는 Dialog/탭 이동으로 매핑해 전달한다.
 * 미제공(undefined) 시 카드는 안전한 상세 탭 이동 또는 명확한 Disabled 상태로 대체된다.
 */
export interface EnterpriseDetailActions {
  /** 초대·코드 관리(InviteCodesModal): brand/hq/store 코드 확인·복사·재발급. */
  onManageInvite?: () => void;
  /** 정산·사업자 검토(SettlementReviewModal): 승인/반려/지급설정. */
  onReviewSettlement?: () => void;
  /** 지역 관리 화면(enterprise-regions 탭) 이동. */
  onManageRegions?: () => void;
  /** 계정 편집(EditModal): 상태·권한 변경 포함. */
  onEditAccount?: () => void;
  /** 계정 삭제(DeleteConfirmModal): 기존 confirm 절차 유지. */
  onDeleteAccount?: () => void;
}

export default function EnterpriseDetailModal({
  enterpriseId, enterpriseName, onClose, actions,
}: { enterpriseId: string; enterpriseName: string; onClose: () => void; actions?: EnterpriseDetailActions }) {
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

          {tab === 'overview' && <OverviewTab d={data} onNavigate={setTab} actions={actions} />}
          {tab === 'stores' && <StoresTab d={data} />}
          {tab === 'billing' && <BillingTab d={data} />}
          {tab === 'music' && <MusicTab d={data} />}
          {tab === 'logs' && <LogsTab d={data} />}
        </div>
      ) : null}
    </AdminModal>
  );
}

// ── 개요 (운영 Workspace) ────────────────────────────────────────────
// 순서: 계정 요약 → 운영 준비 상태 → 지금 처리할 작업 → 운영 연결 →
//       사업자·정산 → 초대·코드 → 지역 → 고급 시스템 정보 → 위험 작업.
// 운영자가 자주 쓰는 정보를 위로, 원시 시스템 값은 접힌 고급 영역으로.
// 상세 탭 키/조회 데이터/기능은 그대로 유지(신규 백엔드 없음).
function OverviewTab({ d, onNavigate, actions }: { d: EnterpriseDetail; onNavigate: (t: DetailTab) => void; actions?: EnterpriseDetailActions }) {
  return (
    <div className="space-y-3">
      <AccountSummary d={d} />
      <ReadinessBoard d={d} onNavigate={onNavigate} actions={actions} />
      <RequiredTasksPanel d={d} onNavigate={onNavigate} actions={actions} />
      <OperationalConnections d={d} onNavigate={onNavigate} actions={actions} />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <BusinessCard d={d} onNavigate={onNavigate} actions={actions} />
        <InviteCard d={d} onNavigate={onNavigate} actions={actions} />
      </div>
      <RegionCard d={d} onNavigate={onNavigate} actions={actions} />
      <AdvancedSystemInfo d={d} />
      <DangerZone actions={actions} />
    </div>
  );
}

// 계정 요약 — 운영에 자주 쓰는 연락/권한 정보(원시 시스템 값은 고급 영역).
function AccountSummary({ d }: { d: EnterpriseDetail }) {
  const e = d.enterprise;
  return (
    <AdminCard title="계정 요약">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        <KV k="본사명" v={e.enterprise_name} />
        <KV k="담당자" v={e.manager_name} />
        <KV k="권한" v={roleLabel(e.role)} />
        <KV k="이메일" v={e.manager_email} copy />
        <KV k="전화" v={e.manager_phone} copy />
        <KV k="최근 로그인" v={fmt(e.last_login_at)} />
      </dl>
      {e.notes && <p className="mt-2 rounded bg-bg px-2 py-1.5 text-xs text-ink-mute">메모: {e.notes}</p>}
    </AdminCard>
  );
}

// 지금 처리할 작업 — 미완료/확인필요만. 완료 시 완료 메시지.
function RequiredTasksPanel({ d, onNavigate, actions }: SectionProps) {
  const tasks = getEnterpriseRequiredActions(d);
  if (tasks.length === 0) {
    return (
      <AdminCard title="지금 처리할 작업">
        <div className="flex items-start gap-2 rounded-lg border border-line/15 bg-bg p-3">
          <AdminBadge tone="success" icon={<CheckCircle2 size={12} />}>완료</AdminBadge>
          <div>
            <p className="text-sm font-bold text-ink">필수 운영 설정 완료</p>
            <p className="text-[11px] text-ink-dim">현재 추가로 처리할 필수 작업이 없습니다.</p>
          </div>
        </div>
      </AdminCard>
    );
  }
  return (
    <AdminCard title="지금 처리할 작업" action={<AdminBadge tone="warning">{tasks.length}건</AdminBadge>}>
      <div className="space-y-2">
        {tasks.map((t) => (
          <div key={t.id} className="flex flex-col gap-2 rounded-lg border border-line/15 bg-bg p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <AdminBadge tone={t.priority === 'required' ? 'danger' : 'neutral'}>{t.priority === 'required' ? '필수' : '권장'}</AdminBadge>
                <span className="text-sm font-bold text-ink">{t.title}</span>
              </div>
              <p className="mt-0.5 text-[11px] text-ink-dim">{t.description}</p>
            </div>
            <div className="shrink-0">
              <ActionLink label={kindLabel(t.actionKind)} kind={t.actionKind} onNavigate={onNavigate} actions={actions} variant="button" />
            </div>
          </div>
        ))}
      </div>
    </AdminCard>
  );
}

// 운영 연결 — 브랜드·HQ·매장·지역 관계를 한 카드로(현재 데이터 계약 범위만).
function OperationalConnections({ d, onNavigate, actions }: SectionProps) {
  const e = d.enterprise; const inv = d.invite; const s = d.store_summary;
  return (
    <AdminCard title="운영 연결" subtitle="브랜드 · HQ · 매장 · 지역">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <ConnTile label="브랜드" value={inv.brand_code ?? '미발급'} mono={!!inv.brand_code}>
          {inv.brand_code && <CopyChip value={inv.brand_code} />}
          <ActionLink label="초대·코드 관리" kind="invite" onNavigate={onNavigate} actions={actions} />
        </ConnTile>
        <ConnTile label="HQ" value={e.enterprise_name}>
          <StatusBadge status={e.status} />
        </ConnTile>
        <ConnTile label="매장" value={`연결 ${s.total}개`}>
          <ActionLink label="매장 보기" kind="tab:stores" onNavigate={onNavigate} actions={actions} />
        </ConnTile>
        <ConnTile label="지역" value={`연결 ${d.regions.length}개`}>
          <ActionLink label="지역 관리" kind="regions" onNavigate={onNavigate} actions={actions} />
        </ConnTile>
      </div>
    </AdminCard>
  );
}

// 사업자 / 정산 — 관리자 수정 RPC 없음 → 편집 버튼 없이 검토 화면으로만 연결.
function BusinessCard({ d, onNavigate, actions }: SectionProps) {
  const bp = d.business_profile;
  const settle = settlementReadiness(d);
  const sMeta = READINESS_META[settle.status];
  return (
    <AdminCard title="사업자 / 정산" action={<ActionLink label="사업자·정산 검토" kind="settlement" onNavigate={onNavigate} actions={actions} />}>
      {!bp ? (
        <CompactEmpty title="미등록 또는 검토 필요" desc="계약 및 정산 진행 전에 확인이 필요합니다." />
      ) : (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
          <KV k="상호명" v={bp.company_name} />
          <KV k="사업자등록번호" v={bp.business_number} copy />
          <KV k="대표자" v={bp.representative_name} />
          <KV k="주소" v={bp.business_address} />
          <KV k="연락처" v={bp.contact_phone} copy />
          <KV k="세금계산서 이메일" v={bp.tax_invoice_email} copy />
          <KV k="정산 담당" v={bp.settlement_contact_name} />
          <KV k="정산 담당 연락처" v={bp.settlement_contact_phone} copy />
        </dl>
      )}
      <div className="mt-2 flex items-center gap-1.5 border-t border-line/10 pt-2 text-[11px]">
        <span className="text-ink-dim">정산 준비:</span>
        <AdminBadge tone={sMeta.tone}>{settle.headline}</AdminBadge>
      </div>
    </AdminCard>
  );
}

// 초대 / 코드 — 관리형 목록. rotate/generate 는 기존 InviteCodesModal 에서만.
function InviteCard({ d, onNavigate, actions }: SectionProps) {
  const inv = d.invite;
  return (
    <AdminCard title="초대 / 코드">
      <div className="space-y-2">
        <CodeManageRow label="HQ 초대코드" value={inv.hq_invite_code} onNavigate={onNavigate} actions={actions} />
        <CodeManageRow label="매장 초대코드" value={inv.store_invite_code} onNavigate={onNavigate} actions={actions} />
        <CodeManageRow label="브랜드 코드" value={inv.brand_code} onNavigate={onNavigate} actions={actions} />
      </div>
      {inv.invite_code_rotated_at && <p className="mt-2 text-[11px] text-ink-dim">코드 최근 재발급: {fmt(inv.invite_code_rotated_at)}</p>}
      <ClaimHistory claims={inv.claims} />
    </AdminCard>
  );
}

// 지역 — 0개면 한 줄 empty, 있으면 3개 + 더보기.
function RegionCard({ d, onNavigate, actions }: SectionProps) {
  const [expanded, setExpanded] = useState(false);
  const { shown, hiddenCount } = splitForDisplay(d.regions, expanded ? -1 : 3);
  return (
    <AdminCard title={`지역 (${d.regions.length})`} action={<ActionLink label="지역 관리" kind="regions" onNavigate={onNavigate} actions={actions} />}>
      {d.regions.length === 0 ? (
        <CompactEmpty title="연결된 지역 없음" desc="본사의 운영 지역이 아직 지정되지 않았습니다." />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {shown.map((r) => <RegionChip key={r.id} r={r} />)}
          </div>
          {hiddenCount > 0 && (
            <button type="button" onClick={() => setExpanded(true)} className="mt-2 text-[11px] font-semibold text-accent hover:underline">
              + {hiddenCount}개 더 보기
            </button>
          )}
          {expanded && d.regions.length > 3 && (
            <button type="button" onClick={() => setExpanded(false)} className="mt-2 ml-3 text-[11px] text-ink-dim hover:underline">접기</button>
          )}
        </>
      )}
    </AdminCard>
  );
}

// 고급 시스템 정보 — 원시 ID/타임스탬프/플래그. 기본 접힘(disclosure).
function AdvancedSystemInfo({ d }: { d: EnterpriseDetail }) {
  const [open, setOpen] = useState(false);
  const e = d.enterprise;
  return (
    <div className="rounded-xl bg-bg-card ring-1 ring-line/10">
      <button
        type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-bold text-ink">고급 시스템 정보</span>
        <ChevronDown size={14} className={`text-ink-dim transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-line/10 px-4 pb-3">
          <dl className="grid grid-cols-1 gap-x-4 gap-y-2 pt-3 sm:grid-cols-2">
            <KV k="enterprise_id" v={e.id} copy mono abbrev />
            <KV k="auth_user_id" v={e.auth_user_id} copy mono abbrev />
            <KV k="brand_registry_id" v={e.brand_registry_id} copy mono abbrev />
            <KV k="role (raw)" v={e.role} />
            <KV k="생성일" v={fmt(e.created_at)} />
            <KV k="수정일" v={fmt(e.updated_at)} />
            <KV k="최근 로그인 (raw)" v={fmt(e.last_login_at)} />
            <KV k="삭제일" v={e.deleted_at ? fmt(e.deleted_at) : '—'} />
            <KV k="온보딩 허용" v={e.onboarding_enabled ? 'Y' : 'N'} />
            <KV k="지역 자율등록" v={e.allow_self_register_region ? 'Y' : 'N'} />
            <KV k="자동 온보딩" v={e.auto_onboarded ? 'Y' : 'N'} />
          </dl>
        </div>
      )}
    </div>
  );
}

// 위험 작업 — 기존 EditModal(상태·권한) / DeleteConfirmModal(확인 절차) 재사용.
// 실제 연결(actions)이 없으면 렌더하지 않음(빈 Danger Zone 생성 금지).
function DangerZone({ actions }: { actions?: EnterpriseDetailActions }) {
  if (!actions?.onEditAccount && !actions?.onDeleteAccount) return null;
  return (
    <AdminCard title="위험 작업">
      <div className="flex flex-col gap-2 sm:flex-row">
        {actions.onEditAccount && (
          <AdminButton size="sm" variant="subtle" tone="warning" onClick={actions.onEditAccount}>계정 편집 (상태·권한)</AdminButton>
        )}
        {actions.onDeleteAccount && (
          <AdminButton size="sm" variant="subtle" tone="danger" onClick={actions.onDeleteAccount}>계정 삭제</AdminButton>
        )}
      </div>
      <p className="mt-2 text-[11px] text-ink-dim">상태 변경·권한 조정은 계정 편집에서, 삭제는 확인 절차를 거칩니다.</p>
    </AdminCard>
  );
}

type SectionProps = { d: EnterpriseDetail; onNavigate: (t: DetailTab) => void; actions?: EnterpriseDetailActions };

// ── 운영 준비 상태 보드 ──────────────────────────────────────────────
const READINESS_META: Record<ReadinessStatus, { tone: AdminToneName; label: string; Icon: typeof CheckCircle2 }> = {
  ready:     { tone: 'success', label: '완료',   Icon: CheckCircle2 },
  partial:   { tone: 'info',    label: '부분',   Icon: CircleDashed },
  attention: { tone: 'danger',  label: '주의',   Icon: AlertTriangle },
  missing:   { tone: 'warning', label: '미완료', Icon: MinusCircle },
};

function ReadinessBoard({ d, onNavigate, actions }: { d: EnterpriseDetail; onNavigate: (t: DetailTab) => void; actions?: EnterpriseDetailActions }) {
  const items = computeEnterpriseReadiness(d);
  const incomplete = countIncomplete(items);
  const doneCount = items.length - incomplete;
  return (
    <AdminCard
      title="운영 준비 상태"
      subtitle="누락 항목을 카드에서 바로 처리 — 브랜드·사업자·정산·초대·지역·매장 (한 화면 운영)"
      action={
        <AdminBadge tone={incomplete === 0 ? 'success' : 'warning'}>
          {incomplete === 0 ? '전체 완료' : `준비 ${doneCount}/${items.length} · 확인필요 ${incomplete}`}
        </AdminBadge>
      }
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it) => <ReadinessCard key={it.domain} item={it} onNavigate={onNavigate} actions={actions} />)}
      </div>
    </AdminCard>
  );
}

/** actionKind → 실제 지원 액션 핸들러. onClick 없으면 미지원(reason). 단일 소스. */
function kindHandler(kind: ReadinessActionKind, onNavigate: (t: DetailTab) => void, actions?: EnterpriseDetailActions): { onClick?: () => void; reason?: string } {
  switch (kind) {
    case 'invite':
      return actions?.onManageInvite ? { onClick: actions.onManageInvite } : { reason: '초대·코드 관리 화면 연결이 없습니다' };
    case 'settlement':
      // 우선 검토 Dialog → 없으면 안전한 계약·정산 탭 이동(대체).
      return actions?.onReviewSettlement ? { onClick: actions.onReviewSettlement } : { onClick: () => onNavigate('billing') };
    case 'regions':
      return actions?.onManageRegions ? { onClick: actions.onManageRegions } : { reason: '지역 관리 화면 연결이 없습니다' };
    case 'tab:stores':
      return { onClick: () => onNavigate('stores') };
    case 'tab:billing':
      return { onClick: () => onNavigate('billing') };
  }
}

/** actionKind 기본 라벨(도메인 무관). */
function kindLabel(kind: ReadinessActionKind): string {
  switch (kind) {
    case 'invite': return '초대·코드 관리';
    case 'settlement': return '사업자·정산 검토';
    case 'regions': return '지역 관리';
    case 'tab:stores': return '매장 보기';
    case 'tab:billing': return '계약·정산';
  }
}

/**
 * 공용 액션 버튼 — actionKind 를 실제 지원 액션으로 매핑해 렌더.
 * 지원되면 버튼(또는 링크), 없으면 가짜 버튼 대신 명확한 Disabled + 설명.
 */
function ActionLink({ label, kind, onNavigate, actions, variant = 'link' }: {
  label: string; kind: ReadinessActionKind; onNavigate: (t: DetailTab) => void;
  actions?: EnterpriseDetailActions; variant?: 'link' | 'button';
}) {
  const h = kindHandler(kind, onNavigate, actions);
  if (!h.onClick) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-ink-dim" title={h.reason}>
        <MinusCircle size={10} /> {h.reason ?? '지원 액션 없음'}
      </span>
    );
  }
  if (variant === 'button') {
    return (
      <AdminButton size="sm" tone="primary" variant="subtle" onClick={h.onClick}>{label}</AdminButton>
    );
  }
  return (
    <button type="button" onClick={h.onClick}
      className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-accent transition hover:bg-accent/10">
      {label} <ChevronRight size={11} />
    </button>
  );
}

function ReadinessCard({ item, onNavigate, actions }: { item: ReadinessItem; onNavigate: (t: DetailTab) => void; actions?: EnterpriseDetailActions }) {
  const meta = READINESS_META[item.status];
  const Icon = meta.Icon;
  // 브랜드/사업자는 도메인 특화 라벨, 나머지는 기본 라벨.
  const label = item.domain === 'brand' ? '브랜드·코드 관리'
    : item.domain === 'business' ? '사업자·정산 검토'
    : kindLabel(item.actionKind);
  return (
    <div className="flex flex-col rounded-xl border border-line/15 bg-bg p-3">
      <div className="flex items-center justify-between gap-1">
        <span className="text-[11px] font-semibold text-ink-mute">{item.label}</span>
        <AdminBadge tone={meta.tone} icon={<Icon size={10} />}>{meta.label}</AdminBadge>
      </div>
      <div className="mt-1.5 text-sm font-bold text-ink">{item.headline}</div>
      <p className="mt-0.5 text-[11px] text-ink-dim">{item.detail}</p>
      <div className="mt-2 border-t border-line/10 pt-2">
        <ActionLink label={label} kind={item.actionKind} onNavigate={onNavigate} actions={actions} />
      </div>
    </div>
  );
}

// ── 공용 소형 UI 조각 ────────────────────────────────────────────────

// 큰 Placeholder 박스 대신 한 줄 empty 상태(항목명/상태/설명).
function CompactEmpty({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-dashed border-line/25 bg-bg px-3 py-2">
      <MinusCircle size={13} className="mt-0.5 text-ink-dim" />
      <div>
        <p className="text-xs font-semibold text-ink">{title}</p>
        <p className="text-[11px] text-ink-dim">{desc}</p>
      </div>
    </div>
  );
}

function ConnTile({ label, value, mono, children }: { label: string; value: string; mono?: boolean; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-line/15 bg-bg p-2.5">
      <p className="text-[10px] uppercase tracking-wider text-ink-dim">{label}</p>
      <p className={`mt-0.5 truncate text-sm font-bold text-ink ${mono ? 'font-mono' : ''}`} title={value}>{value}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

function CopyChip({ value }: { value: string }) {
  return (
    <button type="button" onClick={() => doCopy(value)} title="복사"
      className="inline-flex items-center gap-0.5 rounded-md bg-bg-card px-1.5 py-0.5 text-[11px] font-semibold text-ink-mute hover:bg-bg-hover">
      <Copy size={10} /> 복사
    </button>
  );
}

// 초대/코드 관리형 행: 값(또는 '현재 없음') + 복사 + 관리 이동.
function CodeManageRow({ label, value, onNavigate, actions }: { label: string; value: string | null; onNavigate: (t: DetailTab) => void; actions?: EnterpriseDetailActions }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line/15 bg-bg px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wider text-ink-dim">{label}</p>
        {value
          ? <code className="block truncate font-mono text-sm font-semibold text-ink" title={value}>{value}</code>
          : <span className="text-xs text-ink-dim">현재 없음</span>}
      </div>
      {value && <CopyChip value={value} />}
      <ActionLink label="초대·코드 관리" kind="invite" onNavigate={onNavigate} actions={actions} />
    </div>
  );
}

function RegionChip({ r }: { r: EntDetailRegion }) {
  return (
    <div className="rounded-lg border border-line/20 bg-bg px-3 py-1.5 text-xs">
      <span className="font-semibold text-ink">{r.region_name ?? '—'}</span>
      {r.region_code && <span className="ml-1 font-mono text-ink-dim">{r.region_code}</span>}
      <span className="ml-2 text-ink-mute">매장 {r.store_count ?? 0}</span>
    </div>
  );
}

// claim 이력 — 0건이면 한 줄, 있으면 접을 수 있는 표.
function ClaimHistory({ claims }: { claims: EntDetailInviteClaim[] }) {
  const [open, setOpen] = useState(false);
  if (claims.length === 0) {
    return <p className="mt-2 border-t border-line/10 pt-2 text-[11px] text-ink-dim">가입/초대 claim 이력 없음</p>;
  }
  return (
    <div className="mt-2 border-t border-line/10 pt-2">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="flex items-center gap-1 text-[11px] font-semibold text-ink-mute hover:text-ink">
        <ChevronDown size={12} className={`transition ${open ? 'rotate-180' : ''}`} />
        가입/초대 claim 이력 ({claims.length})
      </button>
      {open && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead><tr className="text-ink-dim"><th className="px-2 py-1 text-left">유형</th><th className="px-2 py-1 text-left">상태</th><th className="px-2 py-1 text-left">코드끝4</th><th className="px-2 py-1 text-left">입력값</th><th className="px-2 py-1 text-left">시각</th></tr></thead>
            <tbody>
              {claims.map((c, i) => (
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
    </div>
  );
}

/** role 코드 → 한국어 라벨(운영 표시용). 미매핑은 원문 유지. */
function roleLabel(role: string | null): string | null {
  if (!role) return role;
  const map: Record<string, string> = {
    owner: '본사 최고관리자', admin: '본사 관리자', enterprise_manager: '본사 담당자', viewer: '조회 전용',
  };
  return map[role] ?? role;
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
