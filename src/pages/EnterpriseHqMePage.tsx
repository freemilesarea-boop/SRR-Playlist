/**
 * EnterpriseHqMePage — Phase 1-7
 *
 * Phase 1-6 invite-code 가입으로 HQ 가 된 사용자 셀프 대시보드.
 * 기존 /enterprise/hq (franchise_admins X6.90 용) 와 분리된 신규 라우트 /enterprise/me.
 *
 * 컨텐츠:
 *   - 본사 헤더 + 상태
 *   - KPI (매장 수 / 프랜차이즈 / 지역 / 온보딩)
 *   - 사업자 정보 등록/편집 (enterprise_business_profiles)
 *   - 초대코드 안내 (display only — rotate 는 admin)
 *   - 최근 연결 매장
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import {
  Building2, RefreshCw, AlertCircle, ArrowLeft, Store, MapPin, Save,
  Key, CheckCircle2, Sparkles, Banknote, FileText, Upload, AlertTriangle,
  Clock as ClockIcon, XCircle, Wallet, Copy, Link2, BarChart3, TrendingUp,
  PauseCircle, PowerOff,
} from 'lucide-react';
import {
  getMyEnterpriseDashboard, upsertMyEnterpriseBusinessProfileV2,
  getMyEnterpriseSettlement, upsertMyEnterpriseSettlement,
  uploadEnterpriseDocument,
  type EnterpriseHqDashboard,
  type EnterpriseBusinessProfileV2UpsertInput,
  type EnterpriseSettlementGetResult,
  type EnterpriseSettlementUpsertInput,
} from '@/lib/api/enterpriseHqApi';
import {
  ENTERPRISE_PLACEHOLDERS,
  ENTERPRISE_DOCUMENT_ACCEPT,
  ENTERPRISE_DOCUMENT_MAX_BYTES,
  SETTLEMENT_METHOD_LABEL,
  SETTLEMENT_STATUS_LABEL,
  type SettlementMethod,
} from '@/lib/enterprisePlaceholders';
import { toast } from '@/store/toastStore';
import Alert from '@/components/Alert';
import { useAuthStore } from '@/store/authStore';

export default function EnterpriseHqMePage() {
  const user = useAuthStore((s) => s.user);
  const isProfileReady = useAuthStore((s) => s.isProfileReady);

  const [dashboard, setDashboard] = useState<EnterpriseHqDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await getMyEnterpriseDashboard();
      setDashboard(d);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    void load();
  }, [user?.id, load]);

  if (isProfileReady && !user) return <Navigate to="/login" replace />;

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 pt-3 pb-12 sm:px-6">
      <div className="flex items-center gap-2">
        <Link to="/profile"
          className="inline-flex items-center gap-1 rounded bg-bg-deep px-2 py-1 text-xs hover:bg-bg-hover">
          <ArrowLeft size={11} /> 내 정보
        </Link>
        <h1 className="text-base font-extrabold flex items-center gap-1.5">
          <Building2 size={16} /> 내 엔터프라이즈
        </h1>
        <button onClick={() => void load()} disabled={loading}
          className="ml-auto inline-flex items-center gap-1 rounded bg-bg-deep px-2 py-1 text-xs hover:bg-bg-hover disabled:opacity-50">
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> 새로고침
        </button>
      </div>

      {error && (
        <Alert tone="error">
          <div className="flex items-center gap-2 text-xs">
            <AlertCircle size={12} /> {error}
            <button onClick={() => void load()} className="ml-auto rounded bg-rose-500/20 px-2 py-0.5 font-bold">재시도</button>
          </div>
        </Alert>
      )}

      {loading && !dashboard && (
        <div className="space-y-2">
          <div className="h-20 animate-pulse rounded-2xl bg-bg-card" />
          <div className="h-32 animate-pulse rounded-2xl bg-bg-card" />
          <div className="h-48 animate-pulse rounded-2xl bg-bg-card" />
        </div>
      )}

      {dashboard && <DashboardContent dashboard={dashboard} onSaved={() => void load()} />}
    </div>
  );
}

// =============================================================================
// Content
// =============================================================================

function DashboardContent({
  dashboard, onSaved,
}: { dashboard: EnterpriseHqDashboard; onSaved: () => void }) {
  const ea = dashboard.enterprise_account;
  const kpis = [
    { label: '연결 매장', value: dashboard.store_count, tone: 'text-emerald-300' },
    { label: '프랜차이즈', value: dashboard.franchises.length, tone: 'text-sky-300' },
    { label: '등록 지역', value: dashboard.regions.length, tone: 'text-amber-300' },
    { label: '온보딩', value: ea.onboarding_enabled ? 'ON' : 'OFF',
      tone: ea.onboarding_enabled ? 'text-emerald-300' : 'text-rose-300' },
  ];

  return (
    <>
      {/* 본사 헤더 */}
      <section className="rounded-2xl bg-gradient-to-br from-accent/10 to-accent-soft/5 p-4 ring-1 ring-accent/20">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold">{ea.enterprise_name}</h2>
            <p className="mt-0.5 text-[11px] text-ink-mute">
              {ea.manager_name} · {ea.manager_email}
              {ea.manager_phone && ` · ${ea.manager_phone}`}
            </p>
            {ea.brand_code && (
              <p className="mt-1 text-[11px] font-mono text-ink-dim">브랜드 코드: {ea.brand_code}</p>
            )}
          </div>
          {!dashboard.business_profile_present && (
            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300">
              사업자 정보 미등록
            </span>
          )}
        </div>
      </section>

      {/* KPI */}
      <section className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl bg-bg-card p-3 ring-1 ring-line/10">
            <p className="text-[10px] uppercase tracking-wider text-ink-dim">{k.label}</p>
            <p className={`mt-1 text-lg font-extrabold tabular-nums ${k.tone}`}>{k.value}</p>
          </div>
        ))}
      </section>

      {/* Phase 1-9 — 정산 가능 금액 (placeholder, Phase 1-10 enterprise_revenue 모델 별도) */}
      <SettlementPreviewCard />

      {/* Phase 1-9 — 매장 현황 카드 (전체/활성/정지/inactive/최근 7일) */}
      {dashboard.store_stats && <StoreStatsCard stats={dashboard.store_stats} />}

      {/* Phase 1-9 — 지역별 매장 분포 */}
      {dashboard.region_distribution && dashboard.region_distribution.length > 0 && (
        <RegionDistributionCard items={dashboard.region_distribution} />
      )}

      {/* 사업자 정보 (v2 — 정산 담당자 포함) */}
      <BusinessProfileEditor dashboard={dashboard} onSaved={onSaved} />

      {/* 정산 정보 + 증빙서류 + 지급 설정 (Phase 1-8) */}
      <SettlementSections enterpriseAccountId={dashboard.enterprise_account.id} />

      {/* 초대코드 안내 — Phase 1-9: 코드 복사 + 초대 링크 복사 */}
      <section className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
        <h3 className="text-sm font-bold flex items-center gap-1.5">
          <Key size={14} /> 초대코드 안내
        </h3>
        <p className="mt-1 text-[11px] text-ink-mute">
          매장과 본사 담당자 추가 가입에 사용되는 코드/링크입니다. 재발급은 관리자에게 요청하세요.
        </p>
        <div className="mt-3 space-y-2">
          <InviteCodeRow
            label="본사 담당자 가입"
            code={ea.hq_invite_code}
            inviteUrl={ea.hq_invite_code
              ? buildInviteUrl('enterprise-hq', ea.enterprise_name, ea.hq_invite_code)
              : null}
          />
          <InviteCodeRow
            label="매장 가입"
            code={ea.store_invite_code}
            inviteUrl={ea.store_invite_code
              ? buildInviteUrl('enterprise-store', ea.enterprise_name, ea.store_invite_code)
              : null}
          />
        </div>
        {ea.invite_code_rotated_at && (
          <p className="mt-2 text-[10px] text-ink-dim">
            마지막 재발급: {new Date(ea.invite_code_rotated_at).toLocaleString('ko-KR')}
          </p>
        )}
        <p className="mt-2 text-[10px] text-ink-dim">
          QR 코드 발급은 다음 단계에 제공됩니다.
        </p>
      </section>

      {/* 최근 매장 */}
      <section className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
        <h3 className="text-sm font-bold flex items-center gap-1.5">
          <Store size={14} /> 최근 연결 매장
        </h3>
        {dashboard.recent_stores.length === 0 ? (
          <p className="mt-2 text-[11px] text-ink-mute">아직 연결된 매장이 없습니다.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line/10">
            {dashboard.recent_stores.map((s) => (
              <li key={s.store_id} className="flex items-center gap-2 py-2 text-xs">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{s.store_name ?? '(매장명 없음)'}</p>
                  <p className="text-[10px] text-ink-mute truncate">
                    {s.franchise_name}
                    {s.region_name && (
                      <span className="ml-1"><MapPin size={9} className="inline" /> {s.region_name}</span>
                    )}
                  </p>
                </div>
                <span className="shrink-0 text-[10px] text-ink-dim tabular-nums">
                  {s.joined_at ? new Date(s.joined_at).toLocaleDateString('ko-KR') : '—'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 지역 / 프랜차이즈 요약 */}
      {dashboard.franchises.length > 0 && (
        <section className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
          <h3 className="text-sm font-bold flex items-center gap-1.5">
            <Sparkles size={14} /> 연결 브랜드 / 프랜차이즈
          </h3>
          <ul className="mt-3 space-y-1.5 text-xs">
            {dashboard.franchises.map((f) => (
              <li key={f.id} className="flex items-center gap-2 rounded bg-bg-deep px-3 py-2">
                <span className="font-semibold flex-1 truncate">{f.name}</span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                  f.role === 'primary' ? 'bg-accent/15 text-accent' : 'bg-ink/10 text-ink-mute'
                }`}>{f.role}</span>
                <span className="shrink-0 text-[10px] tabular-nums text-ink-mute">매장 {f.store_count}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

// =============================================================================
// Business profile editor
// =============================================================================

function BusinessProfileEditor({
  dashboard, onSaved,
}: { dashboard: EnterpriseHqDashboard; onSaved: () => void }) {
  // 0367 ALTER 로 추가된 settlement_contact_* 3 필드 — dashboard.business_profile 에
  // 함께 들어옴 (RPC get_my_enterprise_dashboard 의 to_jsonb 가 전체 row 반환).
  type ExistingV2 = (typeof dashboard.business_profile & {
    settlement_contact_name?: string | null;
    settlement_contact_phone?: string | null;
    settlement_contact_email?: string | null;
  }) | null;
  const existing = dashboard.business_profile as ExistingV2;

  const [companyName, setCompanyName] = useState(existing?.company_name ?? '');
  const [businessNumber, setBusinessNumber] = useState(existing?.business_number ?? '');
  const [representativeName, setRepresentativeName] = useState(existing?.representative_name ?? '');
  const [businessAddress, setBusinessAddress] = useState(existing?.business_address ?? '');
  const [contactPhone, setContactPhone] = useState(existing?.contact_phone ?? '');
  const [taxInvoiceEmail, setTaxInvoiceEmail] = useState(existing?.tax_invoice_email ?? '');
  const [settlementContactName, setSettlementContactName] = useState(existing?.settlement_contact_name ?? '');
  const [settlementContactPhone, setSettlementContactPhone] = useState(existing?.settlement_contact_phone ?? '');
  const [settlementContactEmail, setSettlementContactEmail] = useState(existing?.settlement_contact_email ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [saving, setSaving] = useState(false);

  // dashboard 가 새로 로드되면 form 도 reset
  useEffect(() => {
    setCompanyName(existing?.company_name ?? '');
    setBusinessNumber(existing?.business_number ?? '');
    setRepresentativeName(existing?.representative_name ?? '');
    setBusinessAddress(existing?.business_address ?? '');
    setContactPhone(existing?.contact_phone ?? '');
    setTaxInvoiceEmail(existing?.tax_invoice_email ?? '');
    setSettlementContactName(existing?.settlement_contact_name ?? '');
    setSettlementContactPhone(existing?.settlement_contact_phone ?? '');
    setSettlementContactEmail(existing?.settlement_contact_email ?? '');
    setNotes(existing?.notes ?? '');
  }, [existing]);

  const onSave = async () => {
    setSaving(true);
    try {
      const input: EnterpriseBusinessProfileV2UpsertInput = {
        companyName: companyName.trim() || null,
        businessNumber: businessNumber.trim() || null,
        representativeName: representativeName.trim() || null,
        businessAddress: businessAddress.trim() || null,
        contactPhone: contactPhone.trim() || null,
        taxInvoiceEmail: taxInvoiceEmail.trim() || null,
        notes: notes.trim() || null,
        settlementContactName: settlementContactName.trim() || null,
        settlementContactPhone: settlementContactPhone.trim() || null,
        settlementContactEmail: settlementContactEmail.trim() || null,
      };
      await upsertMyEnterpriseBusinessProfileV2(input);
      toast.success('사업자 정보가 저장되었습니다.');
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold flex items-center gap-1.5">
          <Building2 size={14} /> 본사 사업자 정보
        </h3>
        {dashboard.business_profile_present ? (
          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-300">
            <CheckCircle2 size={10} /> 등록됨
          </span>
        ) : (
          <span className="text-[10px] text-amber-300">미등록</span>
        )}
      </div>
      <p className="mt-1 text-[11px] text-ink-mute">
        세금계산서 발행 / 계약 / 정산 안내에 사용됩니다. 추후 admin 도 조회 가능.
      </p>
      <div className="mt-3 space-y-2 text-xs">
        <Field label="회사명 (정식 사명)">
          <input value={companyName} onChange={(e) => setCompanyName(e.target.value)}
            placeholder={ENTERPRISE_PLACEHOLDERS.companyName} className="input" />
        </Field>
        <Field label="사업자등록번호">
          <input value={businessNumber} onChange={(e) => setBusinessNumber(e.target.value)}
            placeholder={ENTERPRISE_PLACEHOLDERS.businessNumber} className="input" />
        </Field>
        <Field label="대표자명">
          <input value={representativeName} onChange={(e) => setRepresentativeName(e.target.value)}
            placeholder={ENTERPRISE_PLACEHOLDERS.representativeName} className="input" />
        </Field>
        <Field label="사업장 주소">
          <input value={businessAddress} onChange={(e) => setBusinessAddress(e.target.value)}
            placeholder={ENTERPRISE_PLACEHOLDERS.businessAddress}
            autoComplete="street-address" className="input" />
        </Field>
        <Field label="담당자 연락처">
          <input type="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)}
            placeholder={ENTERPRISE_PLACEHOLDERS.contactPhone} autoComplete="tel" className="input" />
        </Field>
        <Field label="세금계산서 이메일">
          <input type="email" value={taxInvoiceEmail} onChange={(e) => setTaxInvoiceEmail(e.target.value)}
            placeholder={ENTERPRISE_PLACEHOLDERS.taxInvoiceEmail} autoComplete="email" className="input" />
        </Field>

        {/* Phase 1-8 — 정산 담당자 */}
        <hr className="my-2 border-line/10" />
        <p className="text-[11px] font-bold uppercase tracking-wider text-accent">정산 담당자</p>
        <Field label="정산 담당자 이름">
          <input value={settlementContactName} onChange={(e) => setSettlementContactName(e.target.value)}
            placeholder={ENTERPRISE_PLACEHOLDERS.settlementContactName} className="input" />
        </Field>
        <Field label="정산 담당자 연락처">
          <input type="tel" value={settlementContactPhone} onChange={(e) => setSettlementContactPhone(e.target.value)}
            placeholder={ENTERPRISE_PLACEHOLDERS.settlementContactPhone} autoComplete="tel" className="input" />
        </Field>
        <Field label="정산 담당자 이메일">
          <input type="email" value={settlementContactEmail} onChange={(e) => setSettlementContactEmail(e.target.value)}
            placeholder={ENTERPRISE_PLACEHOLDERS.settlementContactEmail} autoComplete="email" className="input" />
        </Field>

        <hr className="my-2 border-line/10" />
        <Field label="메모">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder={ENTERPRISE_PLACEHOLDERS.notes}
            className="input min-h-[60px]" />
        </Field>
        <button onClick={() => void onSave()} disabled={saving}
          className="mt-2 flex w-full items-center justify-center gap-1 rounded-xl bg-accent py-2.5 text-sm font-bold text-bg hover:opacity-90 disabled:opacity-50">
          {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
          {saving ? '저장 중…' : '사업자 정보 저장'}
        </button>
      </div>
    </section>
  );
}


// =============================================================================
// Phase 1-8 — Settlement / Documents / Payment Settings
// =============================================================================

function SettlementSections({ enterpriseAccountId }: { enterpriseAccountId: string }) {
  const [data, setData] = useState<EnterpriseSettlementGetResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await getMyEnterpriseSettlement();
      setData(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (loading && !data) {
    return <div className="h-40 animate-pulse rounded-2xl bg-bg-card" />;
  }
  if (error) {
    return (
      <Alert tone="error">
        <div className="flex items-center gap-2 text-xs">
          <AlertCircle size={12} /> {error}
          <button onClick={() => void load()} className="ml-auto rounded bg-rose-500/20 px-2 py-0.5 font-bold">재시도</button>
        </div>
      </Alert>
    );
  }

  return (
    <>
      <SettlementProfileCard data={data} onSaved={() => void load()} />
      <DocumentsCard
        data={data}
        enterpriseAccountId={enterpriseAccountId}
        onSaved={() => void load()}
      />
      <PaymentSettingsCard data={data} />
    </>
  );
}


// ----- 정산 정보 card -----
function SettlementProfileCard({
  data, onSaved,
}: { data: EnterpriseSettlementGetResult | null; onSaved: () => void }) {
  const existing = data?.settlement ?? null;
  const [bankName, setBankName] = useState(existing?.bank_name ?? '');
  // 마스킹된 값을 placeholder 로만 보여주고, 사용자가 새로 입력해야 변경 가능
  const [accountNumber, setAccountNumber] = useState('');
  const [accountHolder, setAccountHolder] = useState(existing?.account_holder ?? '');
  const [saving, setSaving] = useState(false);
  const maskedExisting = existing?.account_number_masked ?? '';

  useEffect(() => {
    setBankName(existing?.bank_name ?? '');
    setAccountNumber('');
    setAccountHolder(existing?.account_holder ?? '');
  }, [existing]);

  const onSave = async () => {
    setSaving(true);
    try {
      const input: EnterpriseSettlementUpsertInput = {
        bankName: bankName.trim() || null,
        // 신규 입력값이 있을 때만 전달 (기존값 유지)
        accountNumber: accountNumber.trim() || null,
        accountHolder: accountHolder.trim() || null,
      };
      await upsertMyEnterpriseSettlement(input);
      toast.success('정산 정보가 저장되었습니다.');
      setAccountNumber('');
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold flex items-center gap-1.5">
          <Banknote size={14} /> 정산 정보
        </h3>
        <StatusBadge status={existing?.settlement_status ?? 'unregistered'} />
      </div>
      <p className="mt-1 text-[11px] text-ink-mute">
        정산금 입금 계좌입니다. 계좌번호는 보안상 마스킹되어 표시됩니다.
      </p>

      {existing?.settlement_status === 'rejected' && existing?.rejection_reason && (
        <div className="mt-2 rounded bg-rose-500/15 px-3 py-2 text-xs text-rose-300">
          <XCircle size={11} className="inline mr-1" />
          반려 사유: {existing.rejection_reason}
        </div>
      )}

      <div className="mt-3 space-y-2 text-xs">
        <Field label="은행명">
          <input value={bankName} onChange={(e) => setBankName(e.target.value)}
            placeholder={ENTERPRISE_PLACEHOLDERS.bankName} className="input" />
        </Field>
        <Field label="계좌번호">
          <input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)}
            placeholder={maskedExisting || ENTERPRISE_PLACEHOLDERS.accountNumber}
            className="input font-mono" />
          {maskedExisting && (
            <span className="block mt-1 text-[10px] text-ink-dim">
              현재 등록: <span className="font-mono">{maskedExisting}</span> · 새 계좌 입력 시 덮어쓰기
            </span>
          )}
        </Field>
        <Field label="예금주">
          <input value={accountHolder} onChange={(e) => setAccountHolder(e.target.value)}
            placeholder={ENTERPRISE_PLACEHOLDERS.accountHolder} className="input" />
        </Field>
        <button onClick={() => void onSave()} disabled={saving}
          className="mt-2 flex w-full items-center justify-center gap-1 rounded-xl bg-accent py-2.5 text-sm font-bold text-bg hover:opacity-90 disabled:opacity-50">
          {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
          {saving ? '저장 중…' : '정산 정보 저장'}
        </button>
      </div>
    </section>
  );
}


// ----- 증빙서류 card -----
function DocumentsCard({
  data, enterpriseAccountId, onSaved,
}: {
  data: EnterpriseSettlementGetResult | null;
  enterpriseAccountId: string;
  onSaved: () => void;
}) {
  return (
    <section className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
      <h3 className="text-sm font-bold flex items-center gap-1.5">
        <FileText size={14} /> 증빙서류
      </h3>
      <p className="mt-1 text-[11px] text-ink-mute">
        사업자등록증 / 통장사본. PDF · JPG · PNG · WEBP, 최대 20MB. private 보관.
      </p>
      <div className="mt-3 space-y-3">
        <DocumentUpload
          label="사업자등록증"
          docType="business-license"
          enterpriseAccountId={enterpriseAccountId}
          isUploaded={data?.has_business_license ?? false}
          onSaved={onSaved}
        />
        <DocumentUpload
          label="통장사본"
          docType="bankbook"
          enterpriseAccountId={enterpriseAccountId}
          isUploaded={data?.has_bankbook ?? false}
          onSaved={onSaved}
        />
      </div>
    </section>
  );
}

function DocumentUpload({
  label, docType, enterpriseAccountId, isUploaded, onSaved,
}: {
  label: string;
  docType: 'business-license' | 'bankbook';
  enterpriseAccountId: string;
  isUploaded: boolean;
  onSaved: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > ENTERPRISE_DOCUMENT_MAX_BYTES) {
      toast.error(`파일이 20MB 를 초과합니다 (${(file.size / 1024 / 1024).toFixed(1)}MB)`);
      return;
    }
    setUploading(true);
    try {
      const path = await uploadEnterpriseDocument({
        enterpriseAccountId,
        docType,
        file,
      });
      // DB 에 경로 기록 — upsert RPC 가 status 도 'reviewing' 으로 갱신
      await upsertMyEnterpriseSettlement(
        docType === 'business-license'
          ? { businessLicensePath: path }
          : { bankbookPath: path },
      );
      toast.success(`${label} 등록 완료`);
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-bg-deep px-3 py-2 text-xs">
      <div className="flex items-center gap-2 min-w-0">
        <FileText size={12} className="shrink-0 text-ink-mute" />
        <span className="truncate">{label}</span>
        {isUploaded ? (
          <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300">
            <CheckCircle2 size={10} /> 등록됨
          </span>
        ) : (
          <span className="shrink-0 text-[10px] text-amber-300">미등록</span>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ENTERPRISE_DOCUMENT_ACCEPT}
        onChange={(e) => void onChange(e)}
        disabled={uploading}
        className="hidden"
        id={`doc-input-${docType}`}
      />
      <label
        htmlFor={`doc-input-${docType}`}
        className={`inline-flex items-center gap-1 rounded bg-accent px-2 py-1 text-[11px] font-bold text-bg ${
          uploading ? 'opacity-50 cursor-wait' : 'hover:opacity-90 cursor-pointer'
        }`}
      >
        {uploading ? <RefreshCw size={11} className="animate-spin" /> : <Upload size={11} />}
        {uploading ? '업로드 중…' : isUploaded ? '교체' : '업로드'}
      </label>
    </div>
  );
}


// ----- 지급 설정 card (Phase 1-9 §3 — read-only, 계약 조건) -----
//
// settlement_method / minimum_payout 은 계약 조건이므로 관리자만 변경 가능.
// HQ 화면에서는 현재 값만 표시한다 (RPC 호출 없음).
function PaymentSettingsCard({
  data,
}: { data: EnterpriseSettlementGetResult | null }) {
  const existing = data?.settlement ?? null;
  const method: SettlementMethod = existing?.settlement_method ?? 'monthly';
  const minimumPayout: number =
    existing?.minimum_payout !== undefined && existing?.minimum_payout !== null
      ? existing.minimum_payout
      : 0;

  return (
    <section className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold flex items-center gap-1.5">
          <Wallet size={14} /> 지급 설정
        </h3>
        <span className="text-[10px] text-ink-mute">관리자 전용</span>
      </div>
      <p className="mt-1 text-[11px] text-ink-mute">
        지급 설정은 계약 조건에 따라 관리자만 변경할 수 있습니다.
      </p>
      <div className="mt-3 space-y-2 text-xs">
        <Field label="정산 방식">
          <select value={method} disabled aria-readonly="true"
            className="input opacity-70 cursor-not-allowed">
            <option value="monthly">{SETTLEMENT_METHOD_LABEL.monthly}</option>
            <option value="weekly">{SETTLEMENT_METHOD_LABEL.weekly}</option>
            <option value="manual">{SETTLEMENT_METHOD_LABEL.manual}</option>
          </select>
        </Field>
        <Field label="최소 지급금액 (원)">
          <input
            type="text" readOnly
            value={minimumPayout.toLocaleString('ko-KR')}
            className="input tabular-nums opacity-70 cursor-not-allowed" />
        </Field>
      </div>
    </section>
  );
}


function StatusBadge({ status }: { status: 'unregistered' | 'reviewing' | 'approved' | 'rejected' }) {
  const map = {
    unregistered: { label: SETTLEMENT_STATUS_LABEL.unregistered, tone: 'bg-ink/10 text-ink-mute', icon: <AlertTriangle size={10} /> },
    reviewing:    { label: SETTLEMENT_STATUS_LABEL.reviewing,    tone: 'bg-amber-500/15 text-amber-300', icon: <ClockIcon size={10} /> },
    approved:     { label: SETTLEMENT_STATUS_LABEL.approved,     tone: 'bg-emerald-500/15 text-emerald-300', icon: <CheckCircle2 size={10} /> },
    rejected:     { label: SETTLEMENT_STATUS_LABEL.rejected,     tone: 'bg-rose-500/15 text-rose-300', icon: <XCircle size={10} /> },
  } as const;
  const v = map[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${v.tone}`}>
      {v.icon} {v.label}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-[11px] font-semibold uppercase tracking-wider text-ink-mute">{label}</span>
      {children}
    </label>
  );
}

// =============================================================================
// Phase 1-9 — invite link builder + new cards
// =============================================================================

/**
 * 가입 초대 링크 빌더.
 * /login?signup=enterprise-hq|store&brand=<encoded>&code=<encoded>
 * LoginPage URLSearchParams 파서가 이 형식을 인식하여 가입 모드 자동 전환 + prefill.
 */
function buildInviteUrl(
  kind: 'enterprise-hq' | 'enterprise-store',
  brandName: string,
  inviteCode: string,
): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const brand = encodeURIComponent(brandName);
  const code = encodeURIComponent(inviteCode);
  return `${origin}/login?signup=${kind}&brand=${brand}&code=${code}`;
}

function copyToClipboard(value: string, successMsg = '복사됨') {
  void navigator.clipboard.writeText(value)
    .then(() => toast.success(successMsg))
    .catch(() => toast.error('복사 실패'));
}

function InviteCodeRow({
  label, code, inviteUrl,
}: { label: string; code: string | null; inviteUrl: string | null }) {
  if (!code) {
    return (
      <div className="rounded-lg bg-bg-deep px-3 py-2">
        <p className="text-[10px] uppercase tracking-wider text-ink-dim">{label}</p>
        <p className="mt-0.5 text-[11px] text-ink-mute">발급되지 않음</p>
      </div>
    );
  }
  return (
    <div className="rounded-lg bg-bg-deep px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-ink-dim">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <code className="flex-1 truncate rounded bg-bg-card px-2 py-1 font-mono text-sm font-semibold">
          {code}
        </code>
        <button
          type="button"
          onClick={() => copyToClipboard(code, '초대코드 복사됨')}
          className="inline-flex items-center gap-1 rounded bg-bg-card px-2 py-1 text-[11px] font-semibold hover:bg-bg-hover"
          title="초대코드 복사"
        >
          <Copy size={11} /> 코드
        </button>
        {inviteUrl && (
          <button
            type="button"
            onClick={() => copyToClipboard(inviteUrl, '초대 링크 복사됨')}
            className="inline-flex items-center gap-1 rounded bg-accent/15 px-2 py-1 text-[11px] font-semibold text-accent ring-1 ring-accent/30 hover:bg-accent/20"
            title="초대 링크 복사 (브랜드/코드 prefill)"
          >
            <Link2 size={11} /> 링크
          </button>
        )}
      </div>
      {inviteUrl && (
        <p className="mt-1 break-all text-[10px] text-ink-dim">
          {inviteUrl}
        </p>
      )}
    </div>
  );
}

/**
 * 정산 가능 금액 placeholder — Phase 1-10 enterprise_revenue 모델 별도 진행.
 * Phase 1-9 는 UI 자리만 잡고 계산 X (Q1=B).
 */
function SettlementPreviewCard() {
  return (
    <section className="rounded-2xl bg-gradient-to-br from-emerald-500/5 to-emerald-500/0 p-4 ring-1 ring-emerald-500/15">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold flex items-center gap-1.5">
          <Wallet size={14} className="text-emerald-300" /> 정산 가능 금액
        </h3>
        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
          준비중
        </span>
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-2xl font-extrabold text-ink-dim tabular-nums">—</span>
        <span className="text-xs text-ink-mute">원</span>
      </div>
      <p className="mt-2 text-[11px] text-ink-mute">
        실 정산금 계산은 다음 단계에서 제공됩니다. (매장 사용량 · 정책 단가 집계)
      </p>
    </section>
  );
}

/**
 * 매장 현황 카드 — 전체 / 활성 / inactive / suspended / 최근 7일 가입.
 */
function StoreStatsCard({ stats }: { stats: import('@/lib/api/enterpriseHqApi').EnterpriseHqStoreStats }) {
  const items = [
    { label: '전체',       value: stats.total,      icon: <Store size={11} />,        tone: 'text-ink' },
    { label: '활성',       value: stats.active,     icon: <CheckCircle2 size={11} />, tone: 'text-emerald-300' },
    { label: '비활성',     value: stats.inactive,   icon: <PowerOff size={11} />,     tone: 'text-ink-mute' },
    { label: '정지',       value: stats.suspended,  icon: <PauseCircle size={11} />,  tone: 'text-rose-300' },
    { label: '최근 7일 +', value: stats.joined_7d,  icon: <TrendingUp size={11} />,   tone: 'text-sky-300' },
  ];
  return (
    <section className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
      <h3 className="text-sm font-bold flex items-center gap-1.5">
        <Store size={14} /> 매장 현황
      </h3>
      <div className="mt-3 grid grid-cols-5 gap-2">
        {items.map((it) => (
          <div key={it.label} className="rounded-lg bg-bg-deep p-2 text-center">
            <div className={`flex items-center justify-center gap-1 text-[10px] ${it.tone}`}>
              {it.icon}
            </div>
            <p className={`mt-0.5 text-lg font-extrabold tabular-nums ${it.tone}`}>{it.value}</p>
            <p className="mt-0.5 text-[9px] text-ink-dim truncate">{it.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * 지역별 매장 분포 — active_count 기준 정렬, 막대 비율 표시.
 */
function RegionDistributionCard({
  items,
}: { items: import('@/lib/api/enterpriseHqApi').EnterpriseHqRegionDistributionItem[] }) {
  const max = items.reduce((m, it) => Math.max(m, it.total_count), 0) || 1;
  return (
    <section className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
      <h3 className="text-sm font-bold flex items-center gap-1.5">
        <BarChart3 size={14} /> 지역별 매장 분포
      </h3>
      <ul className="mt-3 space-y-2">
        {items.map((it) => {
          const widthPct = Math.round((it.total_count / max) * 100);
          const key = it.region_id ?? '__unassigned__';
          return (
            <li key={key} className="text-xs">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-semibold">
                  <MapPin size={10} className="inline mr-1 text-ink-mute" />
                  {it.region_name}
                  {it.region_code && (
                    <span className="ml-1 text-[10px] font-mono text-ink-dim">{it.region_code}</span>
                  )}
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-ink-mute">
                  <span className="font-bold text-emerald-300">{it.active_count}</span>
                  <span className="mx-0.5 text-ink-dim">/</span>
                  {it.total_count}
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-bg-deep">
                <div
                  className="h-full rounded-full bg-accent/60 transition-all"
                  style={{ width: `${widthPct}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
