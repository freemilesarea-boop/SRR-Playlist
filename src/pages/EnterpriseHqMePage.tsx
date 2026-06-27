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
import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import {
  Building2, RefreshCw, AlertCircle, ArrowLeft, Store, MapPin, Save,
  Key, CheckCircle2, Sparkles,
} from 'lucide-react';
import {
  getMyEnterpriseDashboard, upsertMyEnterpriseBusinessProfile,
  type EnterpriseHqDashboard, type EnterpriseBusinessProfileUpsertInput,
} from '@/lib/api/enterpriseHqApi';
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

      {/* 사업자 정보 */}
      <BusinessProfileEditor dashboard={dashboard} onSaved={onSaved} />

      {/* 초대코드 안내 (display only) */}
      <section className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
        <h3 className="text-sm font-bold flex items-center gap-1.5">
          <Key size={14} /> 초대코드 안내
        </h3>
        <p className="mt-1 text-[11px] text-ink-mute">
          매장과 본사 담당자 추가 가입에 사용되는 코드입니다. 재발급은 관리자에게 요청하세요.
        </p>
        <div className="mt-3 space-y-2">
          <CodeRow label="본사 담당자 가입" value={ea.hq_invite_code} />
          <CodeRow label="매장 가입" value={ea.store_invite_code} />
        </div>
        {ea.invite_code_rotated_at && (
          <p className="mt-2 text-[10px] text-ink-dim">
            마지막 재발급: {new Date(ea.invite_code_rotated_at).toLocaleString('ko-KR')}
          </p>
        )}
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
  const existing = dashboard.business_profile;
  const [companyName, setCompanyName] = useState(existing?.company_name ?? '');
  const [businessNumber, setBusinessNumber] = useState(existing?.business_number ?? '');
  const [representativeName, setRepresentativeName] = useState(existing?.representative_name ?? '');
  const [businessAddress, setBusinessAddress] = useState(existing?.business_address ?? '');
  const [contactPhone, setContactPhone] = useState(existing?.contact_phone ?? '');
  const [taxInvoiceEmail, setTaxInvoiceEmail] = useState(existing?.tax_invoice_email ?? '');
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
    setNotes(existing?.notes ?? '');
  }, [existing]);

  const onSave = async () => {
    setSaving(true);
    try {
      const input: EnterpriseBusinessProfileUpsertInput = {
        companyName: companyName.trim() || null,
        businessNumber: businessNumber.trim() || null,
        representativeName: representativeName.trim() || null,
        businessAddress: businessAddress.trim() || null,
        contactPhone: contactPhone.trim() || null,
        taxInvoiceEmail: taxInvoiceEmail.trim() || null,
        notes: notes.trim() || null,
      };
      await upsertMyEnterpriseBusinessProfile(input);
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
            placeholder="예: 쿠우쿠우(주)" className="input" />
        </Field>
        <Field label="사업자등록번호">
          <input value={businessNumber} onChange={(e) => setBusinessNumber(e.target.value)}
            placeholder="000-00-00000" className="input" />
        </Field>
        <Field label="대표자명">
          <input value={representativeName} onChange={(e) => setRepresentativeName(e.target.value)}
            className="input" />
        </Field>
        <Field label="사업장 주소">
          <input value={businessAddress} onChange={(e) => setBusinessAddress(e.target.value)}
            autoComplete="street-address" className="input" />
        </Field>
        <Field label="담당자 연락처">
          <input type="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)}
            placeholder="02-0000-0000" autoComplete="tel" className="input" />
        </Field>
        <Field label="세금계산서 이메일">
          <input type="email" value={taxInvoiceEmail} onChange={(e) => setTaxInvoiceEmail(e.target.value)}
            placeholder="invoice@kuukuu.com" autoComplete="email" className="input" />
        </Field>
        <Field label="메모">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-[11px] font-semibold uppercase tracking-wider text-ink-mute">{label}</span>
      {children}
    </label>
  );
}

function CodeRow({ label, value }: { label: string; value: string | null }) {
  if (!value) {
    return (
      <div>
        <p className="text-[10px] uppercase tracking-wider text-ink-dim">{label}</p>
        <p className="mt-0.5 text-[11px] text-ink-mute">발급되지 않음</p>
      </div>
    );
  }
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-ink-dim">{label}</p>
      <div className="mt-0.5 flex items-center gap-2">
        <code className="flex-1 truncate rounded bg-bg-deep px-2 py-1 font-mono text-sm font-semibold">{value}</code>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(value)
              .then(() => toast.success('복사됨'))
              .catch(() => toast.error('복사 실패'));
          }}
          className="rounded bg-bg-deep p-1.5 text-xs font-semibold hover:bg-bg-hover"
        >
          복사
        </button>
      </div>
    </div>
  );
}
