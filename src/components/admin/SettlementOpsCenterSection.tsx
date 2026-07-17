/**
 * SettlementOpsCenterSection — Artist Settlement Admin Readability &
 * Secure Payout Identity Center (Phase SETTLEMENT-UX-1).
 *
 * UUID 중심 개발자 화면 → 이름 중심 운영 화면. 조회 방식/표시만 개선 —
 * Settlement/Shadow/Payment/Version 계산·정산 데이터는 일절 변경하지 않는다.
 * 주민번호/계좌번호 기본 마스킹 · 원문 열람은 기존 RevealPiiButton(자동 Audit) 경유만 ·
 * 조회/복사/다운로드는 settlement_admin_access_logs 에 Audit 기록.
 * 운영 모드(기본): 이름/지급 정보 중심 · 개발자 모드: UUID/버전/내부 ID 추가 표시.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  ClipboardList, Copy, Download, Grid3x3, History, Layers, Lock, RefreshCw,
  Scale, Search, Wallet,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import RevealPiiButton from '@/components/admin/RevealPiiButton';
import {
  fetchReadableSettlements, fetchReadableSettlementDetail, fetchReadableShadowCompare,
  fetchReadableSettlementKpi, recordSettlementAccess, fetchSettlementAccessAudit,
  type ReadableSettlementListRow, type ReadableSettlementDetail, type ReadableShadowCompare,
  type ReadableSettlementKpi, type SettlementAccessLogRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  SETTLEMENT_STATUSES, ENTITY_TYPES, SETTLEMENT_STATUS_LABELS, ACCOUNT_STATUS_LABELS,
  ENTITY_TYPE_LABELS, formatKrw, translateSettlementStatus, classifyShadowDelta,
  buildDeltaExplanation, summarizePayoutHistory, SETTLEMENT_READABILITY_SUPPORT,
  type ShadowDeltaComponents,
} from '@/lib/settlementReadability';

type Tab = 'kpi' | 'list' | 'detail' | 'shadow' | 'audit' | 'security' | 'limitations';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'kpi', label: 'KPI', icon: Layers },
  { key: 'list', label: '정산 목록', icon: Wallet },
  { key: 'detail', label: '상세', icon: Search },
  { key: 'shadow', label: 'Shadow Compare', icon: Scale },
  { key: 'audit', label: '접근 Audit', icon: History },
  { key: 'security', label: '보안·마스킹 정책', icon: Lock },
  { key: 'limitations', label: 'Known Limitations', icon: ClipboardList },
];

const KNOWN_LIMITATIONS = [
  'Settlement/Shadow/Payment/Version 계산은 이 센터에서 일절 수행·변경하지 않습니다 — 저장 값 조회 전용',
  '차이 이유는 저장 성분(gross/수수료/세금/이월)의 분해 후보이며 확정 원인이 아닙니다(reason_is_candidate)',
  '재생정보(총/유효/제외)는 v2 shadow 실측이 있을 때만 표시 — v1 은 재생 상세를 저장하지 않습니다',
  '사업자/개인 구분은 tax_withholding_type 기반 proxy 입니다',
  '주민번호/계좌번호는 기본 마스킹 — 원문 열람은 기존 admin_reveal_payout_pii(자동 Audit·시간제한 표시)만',
  '주민번호 마스킹 값은 암호화본 복호화가 가능할 때만 표시(vault 키 미설정 시 미상 유지)',
  'Migration 0472~0541 production 미적용 — 운영 수치는 적용 후 표시됩니다',
  '브라우저 수동 검증 미수행 — UI 동작은 코드/타입/빌드 검증 기준',
];

function monthToDate(m: string): string | null {
  return /^\d{4}-\d{2}$/.test(m) ? `${m}-01` : null;
}

export default function SettlementOpsCenterSection() {
  const [tab, setTab] = useState<Tab>('kpi');
  const [devMode, setDevMode] = useState(false);
  const [month, setMonth] = useState('2026-07');
  const [rows, setRows] = useState<ReadableSettlementListRow[]>([]);
  const [kpi, setKpi] = useState<ReadableSettlementKpi>({});
  const [detail, setDetail] = useState<ReadableSettlementDetail | null>(null);
  const [shadow, setShadow] = useState<ReadableShadowCompare | null>(null);
  const [audit, setAudit] = useState<SettlementAccessLogRow[]>([]);
  const [selId, setSelId] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [entity, setEntity] = useState('');
  const [bank, setBank] = useState('');
  const [minAmt, setMinAmt] = useState('');
  const [maxAmt, setMaxAmt] = useState('');
  const [err, setErr] = useState<AdminError | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true); setErr(null);
    try { await fn(); } catch (e) { setErr(classifyAdminError(e)); } finally { setBusy(false); }
  }, []);

  const loadKpi = () => void run(async () => {
    const m = monthToDate(month);
    if (!m) { toast.error('정산월(YYYY-MM) 필요'); return; }
    const k = await fetchReadableSettlementKpi(m);
    setKpi(k);
    await recordSettlementAccess('kpi_view', 'kpi', `KPI 조회 ${month}`);
  });
  const loadList = () => void run(async () => {
    const r = await fetchReadableSettlements({
      month: monthToDate(month), status: status || null, search: search || null, bank: bank || null,
      entityType: entity || null,
      minAmount: minAmt ? Number(minAmt) : null, maxAmount: maxAmt ? Number(maxAmt) : null, limit: 200,
    });
    setRows(r.rows);
    await recordSettlementAccess(search ? 'search_query' : 'list_view', 'settlement', `목록 조회 ${month} (${r.rows.length}건, 마스킹 기본)`, { search: search || null, status: status || null });
  });
  const loadDetail = (id: string) => void run(async () => {
    const d = await fetchReadableSettlementDetail(id);
    setDetail(d); setSelId(id); setTab('detail');
    await recordSettlementAccess('detail_view', 'settlement', '상세 조회', {}, id);
  });
  const loadShadow = () => void run(async () => {
    const m = monthToDate(month);
    if (!m) { toast.error('정산월(YYYY-MM) 필요'); return; }
    const s = await fetchReadableShadowCompare(m, 200);
    setShadow(s);
    await recordSettlementAccess('shadow_view', 'shadow_compare', `Shadow 비교 조회 ${month}`);
  });
  const loadAudit = () => void run(async () => {
    setAudit(await fetchSettlementAccessAudit(200));
  });

  const copyMasked = (value: string | null, label: string, settlementId: string | null) => {
    if (!value) { toast.error('복사할 값 없음'); return; }
    void navigator.clipboard.writeText(value).then(async () => {
      toast.success(`${label} 복사됨(마스킹 값)`);
      await recordSettlementAccess('copy_masked_value', 'payout_account', `${label} 마스킹 값 복사`, {}, settlementId);
    });
  };
  const exportCsv = () => {
    if (!rows.length) { toast.error('내보낼 목록 없음'); return; }
    const header = ['아티스트명', '회원명', '닉네임', '이메일', '정산월', '정산상태', '지급예정금액', '은행', '예금주', '계좌(마스킹)', '계좌상태'];
    const body = rows.map((r) => [r.artist_name ?? '', r.real_name ?? '', r.nickname ?? '', r.email ?? '', r.settlement_month, translateSettlementStatus(r.status), String(r.final_payout_amount), r.bank_name ?? '', r.account_holder ?? '', r.masked_account_number ?? '', ACCOUNT_STATUS_LABELS[r.account_status] ?? r.account_status]);
    const csv = [header, ...body].map((line) => line.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `settlements_${month}_masked.csv`; a.click();
    URL.revokeObjectURL(url);
    void recordSettlementAccess('export_download', 'export', `CSV 다운로드 ${month} (${rows.length}건, 마스킹 값만 포함)`).then(() => toast.success('다운로드 Audit 기록됨'));
  };

  const shadowRows = useMemo(() => {
    const list = (shadow?.rows ?? []) as Array<Record<string, unknown>>;
    return list.map((r) => {
      const comps = (r.delta_components ?? null) as ShadowDeltaComponents extends never ? never : { gross_delta?: number; company_fee_delta?: number; agent_fee_delta?: number; tax_delta?: number; carryover_delta?: number } | null;
      const cls = classifyShadowDelta({
        v1Net: typeof r.v1_net === 'number' ? r.v1_net : null,
        v2Net: typeof r.v2_net === 'number' ? r.v2_net : null,
        components: comps ? { grossDelta: comps.gross_delta ?? null, companyFeeDelta: comps.company_fee_delta ?? null, agentFeeDelta: comps.agent_fee_delta ?? null, taxDelta: comps.tax_delta ?? null, carryoverDelta: comps.carryover_delta ?? null } : null,
        v1Missing: r.v1_missing === true, v2Missing: r.v2_missing === true,
      });
      return { raw: r, cls, explanation: buildDeltaExplanation({ primaryReasonCandidate: cls.primaryReasonCandidate, netDelta: cls.netDelta }) };
    });
  }, [shadow]);

  const kpiNum = (k: string): number | null => (typeof kpi[k] === 'number' ? kpi[k] as number : null);
  const kpiShadow = (k: string): number | null => {
    const s = kpi.shadow as Record<string, unknown> | undefined;
    return s && typeof s[k] === 'number' ? s[k] as number : null;
  };
  const btn = (label: string, onClick: () => void, primary = false) => (
    <button disabled={busy} onClick={onClick} className={primary ? 'rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50' : 'rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted disabled:opacity-50'}>{label}</button>
  );
  const tone = (s: string) => (s === 'paid' || s === 'verified' || s === 'signed' ? 'success' as const : s === 'held' || s === 'disputed' || s === 'verification_failed' || s === 'unregistered' ? 'danger' as const : 'warning' as const);
  const dev = (fields: Record<string, unknown> | undefined) => devMode && fields ? (
    <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">DEV: {JSON.stringify(fields)}</p>
  ) : null;

  return (
    <AdminCard
      title="Artist Settlement Ops Center"
      subtitle="이름 중심 정산 운영 화면 — 계산·지급·Shadow·Version 변경 없음(조회 전용)·개인정보 기본 마스킹·접근 Audit"
      action={
        <div className="flex items-center gap-2">
          <button onClick={() => setDevMode((v) => !v)} className={`rounded-md border border-border px-2 py-1 text-[11px] font-bold ${devMode ? 'bg-accent text-black' : 'hover:bg-muted'}`}>{devMode ? '개발자 모드 ON' : '운영 모드'}</button>
          <button onClick={() => { loadKpi(); loadList(); }} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>
        </div>
      }
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="이 센터는 조회 전용입니다 — Settlement 계산/Payment/지급 금액/Version/Shadow 계산/정산 데이터를 변경하지 않습니다. 주민번호·계좌번호는 기본 마스킹이며 원문 열람은 권한 확인 + 사유 입력 + 자동 Audit(payout_account_reveal_logs) 경유만 가능합니다. 목록/상세/Shadow/복사/다운로드도 전부 Audit 에 기록됩니다." />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
        {btn('KPI 조회', loadKpi, true)}
        {btn('목록 조회', loadList)}
        {btn('Shadow 조회', loadShadow)}
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => { setTab(t.key); if (t.key === 'audit') loadAudit(); }} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {err && <AdminAlert tone="danger" title="조회 실패" description={err.message} />}

      {tab === 'kpi' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="이번달 지급예정" value={formatKrw(kpiNum('month_payable_total'))} />
            <Box label="이번달 지급완료" value={formatKrw(kpiNum('month_paid_total'))} />
            <Box label="총 지급액(누적)" value={formatKrw(kpiNum('all_time_paid_total'))} />
            <Box label="보류" value={kpiNum('held_count') != null ? `${kpiNum('held_count')}건` : '—'} />
            <Box label="이월" value={kpiNum('carried_over_count') != null ? `${kpiNum('carried_over_count')}건` : '—'} />
            <Box label="미등록 계좌" value={kpiNum('unregistered_account_count') != null ? `${kpiNum('unregistered_account_count')}건` : '—'} />
            <Box label="계좌 검증 실패" value={kpiNum('verification_failed_count') != null ? `${kpiNum('verification_failed_count')}건` : '—'} />
            <Box label="Shadow v1=v2 / v1≠v2" value={kpiShadow('net_match_count') != null ? `${kpiShadow('net_match_count')} / ${kpiShadow('net_diff_count')}` : 'v2 run 없음'} />
          </div>
          <AdminAlert tone="info" description="전부 저장 값 집계입니다(재계산 없음 · settlement_values_recomputed:false). KPI 조회도 Audit 에 기록됩니다." />
        </div>
      )}

      {tab === 'list' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="아티스트명/회원명/닉네임/이메일/계좌 끝4자리" className="min-w-[220px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              <option value="">전체 상태</option>
              {SETTLEMENT_STATUSES.map((s) => <option key={s} value={s}>{SETTLEMENT_STATUS_LABELS[s]}</option>)}
            </select>
            <select value={entity} onChange={(e) => setEntity(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              <option value="">사업자/개인 전체</option>
              {ENTITY_TYPES.filter((t) => t === 'business' || t === 'individual_other_income').map((t) => <option key={t} value={t}>{ENTITY_TYPE_LABELS[t]}</option>)}
            </select>
            <input value={bank} onChange={(e) => setBank(e.target.value)} placeholder="은행" className="w-24 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
            <input value={minAmt} onChange={(e) => setMinAmt(e.target.value)} placeholder="최소 금액" className="w-24 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
            <input value={maxAmt} onChange={(e) => setMaxAmt(e.target.value)} placeholder="최대 금액" className="w-24 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
            {btn('검색', loadList, true)}
            <button disabled={busy || !rows.length} onClick={exportCsv} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted disabled:opacity-50"><Download size={12} /> CSV(마스킹)</button>
          </div>
          {!rows.length ? <AdminEmpty title="정산 목록 없음" description="정산월 선택 후 목록 조회 — production 미적용 상태에서는 0건입니다." /> : (
            <div className="space-y-1">
              {rows.map((r) => (
                <div key={r.settlement_id} className="rounded-lg border border-border p-2 text-[11px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <AdminBadge tone={tone(r.status)}>{translateSettlementStatus(r.status)}</AdminBadge>
                    <span className="font-bold">{r.artist_name ?? '(아티스트명 미등록)'}</span>
                    <span className="text-muted-foreground">{r.real_name ?? '—'} · {r.nickname ?? '—'} · {r.email ?? '—'}</span>
                    <span className="ml-auto font-black">{formatKrw(r.final_payout_amount)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-muted-foreground">
                    <span>{r.bank_name ?? '—'} · {r.account_holder ?? '—'} · <span className="font-mono">{r.masked_account_number ?? '—'}</span></span>
                    <button onClick={() => copyMasked(r.masked_account_number, '계좌번호', r.settlement_id)} className="inline-flex items-center gap-0.5 rounded border border-border px-1 text-[10px] hover:bg-muted"><Copy size={10} /> 복사</button>
                    <AdminBadge tone={tone(r.account_status)}>{ACCOUNT_STATUS_LABELS[r.account_status] ?? r.account_status}</AdminBadge>
                    <span>{ENTITY_TYPE_LABELS[r.entity_type] ?? r.entity_type}</span>
                    <span className="font-mono">{r.masked_resident_number ?? (r.rrn_registered ? '주민번호 마스킹 불가(키 확인 필요)' : '주민번호 미등록')}</span>
                    <button onClick={() => loadDetail(r.settlement_id)} className="ml-auto rounded border border-border px-1.5 text-[10px] font-bold hover:bg-muted">상세</button>
                  </div>
                  {dev(r.developer_fields)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'detail' && (
        !detail ? <AdminEmpty title="상세 미선택" description="정산 목록에서 상세를 선택하세요 — 상세 조회는 Audit 에 기록됩니다." /> : (
          <div className="space-y-2">
            {(() => {
              const basic = (detail.basic ?? {}) as Record<string, unknown>;
              const st = detail.settlement as Record<string, unknown>;
              const sh = detail.shadow as Record<string, unknown>;
              const sr = detail.streams as Record<string, unknown>;
              const hist = summarizePayoutHistory((detail.payout_history ?? []) as { settlement_month: string; final_payout: number | null; status: string }[]);
              const comps = (sh.delta_components ?? null) as { gross_delta?: number; company_fee_delta?: number; agent_fee_delta?: number; tax_delta?: number; carryover_delta?: number } | null;
              const cls = sh.has_v2 === true ? classifyShadowDelta({
                v1Net: typeof sh.v1_net === 'number' ? sh.v1_net as number : null,
                v2Net: typeof sh.v2_net === 'number' ? sh.v2_net as number : null,
                components: comps ? { grossDelta: comps.gross_delta ?? null, companyFeeDelta: comps.company_fee_delta ?? null, agentFeeDelta: comps.agent_fee_delta ?? null, taxDelta: comps.tax_delta ?? null, carryoverDelta: comps.carryover_delta ?? null } : null,
              }) : null;
              const num = (o: Record<string, unknown>, k: string) => (typeof o[k] === 'number' ? o[k] as number : null);
              const str = (o: Record<string, unknown>, k: string) => (typeof o[k] === 'string' ? o[k] as string : null);
              return (
                <>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    <Box label="아티스트명" value={str(basic, 'artist_name') ?? '—'} />
                    <Box label="회원명" value={str(basic, 'real_name') ?? '—'} />
                    <Box label="이메일" value={str(basic, 'email') ?? '—'} />
                    <Box label="계약상태" value={str(basic, 'contract_status') ?? '계약 없음'} />
                    <Box label="은행" value={str(basic, 'bank_name') ?? '—'} />
                    <Box label="예금주" value={str(basic, 'account_holder') ?? '—'} />
                    <Box label="계좌(마스킹)" value={str(basic, 'masked_account_number') ?? '—'} />
                    <Box label="유형" value={ENTITY_TYPE_LABELS[str(basic, 'entity_type') ?? ''] ?? '—'} />
                  </div>
                  {typeof basic.payout_account_id === 'string' && (
                    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-2 text-[11px]">
                      <span className="font-bold">원문 열람(권한+사유+자동 Audit):</span>
                      <RevealPiiButton accountId={basic.payout_account_id} maskedValue={str(basic, 'masked_account_number') ?? '—'} piiType="account_number" settlementId={selId} />
                      <RevealPiiButton accountId={basic.payout_account_id} maskedValue={str(basic, 'masked_resident_number') ?? '주민번호'} piiType="resident_number" settlementId={selId} />
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    <Box label="Gross" value={formatKrw(num(st, 'gross'))} />
                    <Box label="공제(회사+에이전트)" value={formatKrw((num(st, 'company_fee') ?? 0) + (num(st, 'agent_fee') ?? 0))} />
                    <Box label="세금(원천징수)" value={formatKrw(num(st, 'withholding_tax'))} />
                    <Box label="Net" value={formatKrw(num(st, 'net'))} />
                    <Box label="이월(이전)" value={formatKrw(num(st, 'previous_carried'))} />
                    <Box label="지급예정(실지급)" value={formatKrw(num(st, 'final_payout'))} />
                    <Box label="이월(다음)" value={formatKrw(num(st, 'carried_over'))} />
                    <Box label="지급일" value={str(st, 'paid_at') ? new Date(str(st, 'paid_at') as string).toLocaleDateString('ko-KR') : '—'} />
                  </div>
                  {sh.has_v2 === true && cls ? (
                    <AdminAlert tone={cls.netDelta === 0 ? 'success' : 'warning'}
                      description={`Shadow: v1 Net ${formatKrw(typeof sh.v1_net === 'number' ? sh.v1_net as number : null)} → v2 Net ${formatKrw(typeof sh.v2_net === 'number' ? sh.v2_net as number : null)} · ${buildDeltaExplanation({ primaryReasonCandidate: cls.primaryReasonCandidate, netDelta: cls.netDelta })} (이유는 성분 분해 후보 — 계산 변경 없음)`} />
                  ) : <AdminAlert tone="info" description="v2 Shadow 데이터 없음 — 비교 불가(정직 표기)." />}
                  {sr.available === true ? (
                    <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                      <Box label="유효 재생(v2 실측)" value={num(sr, 'eligible_streams') != null ? `${num(sr, 'eligible_streams')}` : '—'} />
                      <Box label="검증 재생(v2 실측)" value={num(sr, 'verified_streams') != null ? `${num(sr, 'verified_streams')}` : '—'} />
                      <Box label="Confidence 평균" value={num(sr, 'confidence_avg') != null ? `${num(sr, 'confidence_avg')}` : '—'} />
                    </div>
                  ) : <AdminAlert tone="info" description="재생정보 없음 — v1 은 재생 상세를 저장하지 않으며 v2 shadow 데이터가 있을 때만 표시합니다." />}
                  <div className="space-y-1">
                    <p className="text-[11px] font-bold">지급 이력(최근 12개월)</p>
                    {!hist.length ? <AdminEmpty title="지급 이력 없음" description="—" /> : hist.map((h) => (
                      <div key={h.month} className="rounded-lg border border-border p-2 text-[11px]">
                        <span className="font-bold">{h.label}</span>
                        <span className="ml-2">{h.amountLabel}</span>
                        <AdminBadge tone={h.statusLabel === '지급완료' ? 'success' : 'warning'}>{h.statusLabel}</AdminBadge>
                      </div>
                    ))}
                  </div>
                  {dev(detail.developer_fields)}
                </>
              );
            })()}
          </div>
        )
      )}

      {tab === 'shadow' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="숫자만이 아니라 왜 차이가 나는지(성분 분해 후보)를 표시합니다 — Shadow 계산은 변경/재계산하지 않습니다(shadow_recalculated:false)." />
          {!shadow ? <AdminEmpty title="Shadow 미조회" description="상단에서 정산월 선택 후 Shadow 조회를 누르세요." /> : shadow.has_v2_run !== true ? <AdminEmpty title="v2 Shadow run 없음" description="해당 월의 v2 shadow 생성 이력이 없습니다(정직 표기)." /> : !shadowRows.length ? <AdminEmpty title="비교 행 없음" description="—" /> : (
            <div className="space-y-1">
              {shadowRows.map((s, i) => (
                <div key={i} className="rounded-lg border border-border p-2 text-[11px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold">{String(s.raw.artist_name ?? '(이름 미등록)')}</span>
                    <span className="text-muted-foreground">{String(s.raw.real_name ?? '—')}</span>
                    <span>v1 {formatKrw(typeof s.raw.v1_net === 'number' ? s.raw.v1_net as number : null)}</span>
                    <span>v2 {formatKrw(typeof s.raw.v2_net === 'number' ? s.raw.v2_net as number : null)}</span>
                    <AdminBadge tone={s.cls.netDelta === 0 ? 'success' : 'warning'}>{s.cls.netDelta == null ? '판정 불가' : s.cls.netDelta === 0 ? 'v1=v2' : `${s.cls.netDelta > 0 ? '+' : ''}${s.cls.netDelta.toLocaleString('ko-KR')}원`}</AdminBadge>
                  </div>
                  <p className="mt-1 text-muted-foreground">{s.explanation}</p>
                  {dev(s.raw.developer_fields as Record<string, unknown> | undefined)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'audit' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="조회/검색/복사/다운로드 접근 기록(append-only). 원문 열람 Audit 는 payout_account_reveal_logs(기존 0061/0300)에 별도 기록됩니다." />
          {!audit.length ? <AdminEmpty title="접근 기록 없음" description="목록/상세/Shadow 조회 시 자동 기록됩니다." /> : (
            <div className="space-y-1">
              {audit.map((a) => (
                <div key={a.id} className="rounded-lg border border-border p-2 text-[11px]">
                  <AdminBadge tone={a.action.startsWith('copy') || a.action === 'export_download' ? 'warning' : 'neutral'}>{a.action}</AdminBadge>
                  <span className="ml-2">{a.detail}</span>
                  <span className="ml-2 text-muted-foreground">{new Date(a.viewed_at).toLocaleString('ko-KR')}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'security' && (
        <div className="space-y-1">
          <AdminAlert tone="info" icon={<Grid3x3 size={14} />} description="지원/미지원(변경 금지) 매트릭스 — unsupported 는 이 센터가 절대 수행하지 않는 것입니다." />
          {SETTLEMENT_READABILITY_SUPPORT.map((s) => (
            <div key={s.key} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={s.status === 'supported' ? 'success' : 'danger'}>{s.status}</AdminBadge>
              <span className="ml-2 font-bold">{s.key}</span>
              <span className="ml-2 text-muted-foreground">{s.note}</span>
            </div>
          ))}
        </div>
      )}

      {tab === 'limitations' && (
        <div className="space-y-1">
          {KNOWN_LIMITATIONS.map((l, i) => (
            <div key={i} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone="warning">limitation</AdminBadge>
              <span className="ml-2">{l}</span>
            </div>
          ))}
        </div>
      )}
    </AdminCard>
  );
}

function Box({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-2">
      <p className="text-[10px] font-bold text-muted-foreground">{label}</p>
      <p className="mt-0.5 break-words text-sm font-black">{value}</p>
    </div>
  );
}
