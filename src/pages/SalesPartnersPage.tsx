import { useState } from 'react';
import { Handshake, MapPin, Coins, ClipboardList, CheckCircle2, Loader2 } from 'lucide-react';
import { submitSalesPartnerApplication } from '@/lib/salesPartnerApi';
import { toast } from '@/store/toastStore';

const BUSINESS_TYPES = ['카페', '음식점', '병원/클리닉', '헬스장/필라테스', '미용실/네일샵', '술집/이자카야', '기타'];

const FITS = [
  '오프라인 매장 네트워크가 있는 분',
  '자영업자/프랜차이즈 관계자가 많은 분',
  'B2B 영업 경험이 있는 분',
  '부업 또는 제휴 영업을 찾는 분',
  '지역 기반 영업이 가능한 분',
];
const DUTIES = [
  '매장에 듣다 서비스 소개',
  '사업자 가입 안내',
  '무료 체험 / 영업 코드 안내',
  '도입 후 초기 사용 지원',
  '본인이 유치한 매장의 이용 현황 확인',
];
const STEPS = ['지원서 제출', '담당자 검토', '파트너 승인', '영업 코드 발급', '매장 유치 및 수수료 정산'];

export default function SalesPartnersPage() {
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [form, setForm] = useState({
    name: '', phone: '', email: '', region: '',
    target_business_types: [] as string[],
    has_sales_experience: '' as '' | 'yes' | 'no',
    expected_store_count: '',
    motivation: '', company_name: '', network_description: '', message: '',
  });

  function toggleType(t: string) {
    setForm((f) => ({
      ...f,
      target_business_types: f.target_business_types.includes(t)
        ? f.target_business_types.filter((x) => x !== t)
        : [...f.target_business_types, t],
    }));
  }

  function validate(): string | null {
    if (!form.name.trim()) return '이름을 입력해주세요';
    if (!form.phone.trim()) return '연락처를 입력해주세요';
    if (!form.email.trim() || !form.email.includes('@')) return '이메일을 정확히 입력해주세요';
    if (!form.region.trim()) return '활동 지역을 입력해주세요';
    if (form.target_business_types.length === 0) return '영업 가능 업종을 1개 이상 선택해주세요';
    if (!form.has_sales_experience) return '영업 경험 여부를 선택해주세요';
    if (!form.motivation.trim()) return '지원 동기를 입력해주세요';
    return null;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validate();
    if (err) { toast.error(err); return; }
    setSubmitting(true);
    try {
      await submitSalesPartnerApplication({
        name: form.name, phone: form.phone, email: form.email, region: form.region,
        target_business_types: form.target_business_types,
        has_sales_experience: form.has_sales_experience === 'yes',
        expected_store_count: form.expected_store_count ? Number(form.expected_store_count) : null,
        motivation: form.motivation,
        company_name: form.company_name || null,
        network_description: form.network_description || null,
        message: form.message || null,
      });
      setDone(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e2) {
      toast.error(e2 instanceof Error ? e2.message : '제출에 실패했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-xl px-5 py-24 text-center">
        <CheckCircle2 size={56} className="mx-auto text-violet-500" />
        <h1 className="mt-5 text-xl font-extrabold">지원이 완료되었습니다.</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-mute">검토 후 담당자가 연락드릴 예정입니다.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-5 pb-24 pt-10 sm:pt-14">
      {/* Hero */}
      <header className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-violet-600/15 via-violet-500/5 to-transparent p-7 ring-1 ring-violet-400/20 sm:p-10">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-500/15 px-3 py-1 text-xs font-semibold text-violet-600 dark:text-violet-300">
          <Handshake size={13} /> 영업 파트너스 지원
        </span>
        <h1 className="mt-4 text-2xl font-extrabold leading-snug sm:text-3xl">
          듣다와 함께 매장 음악 시장을<br className="hidden sm:block" /> 넓혀갈 영업 파트너를 모집합니다.
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-mute">
          카페, 음식점, 병원, 헬스장, 미용실 등 매장을 대상으로 듣다를 소개하고,
          가입 및 이용 전환에 따라 수수료를 받을 수 있는 파트너 프로그램입니다.
        </p>
        <a href="#apply" className="mt-6 inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-5 py-3 text-sm font-bold text-white hover:bg-violet-700">
          영업 파트너 지원하기
        </a>
      </header>

      {/* 섹션들 */}
      <Section icon={<MapPin size={16} />} title="이런 분께 적합합니다">
        <ul className="grid gap-2 sm:grid-cols-2">
          {FITS.map((f) => <Bullet key={f}>{f}</Bullet>)}
        </ul>
      </Section>

      <Section icon={<ClipboardList size={16} />} title="어떤 일을 하나요?">
        <ul className="grid gap-2 sm:grid-cols-2">
          {DUTIES.map((d) => <Bullet key={d}>{d}</Bullet>)}
        </ul>
      </Section>

      <Section icon={<Coins size={16} />} title="수익 구조">
        <ul className="space-y-2">
          <Bullet>영업 코드 기반 매장 추적</Bullet>
          <Bullet>유료 결제 전환 시 수수료 정산</Bullet>
          <Bullet>기본 수수료율은 관리자 승인 후 개별 안내</Bullet>
          <Bullet>실제 지급은 관리자 검수 및 정산 확정 후 진행</Bullet>
        </ul>
        <p className="mt-3 rounded-xl bg-amber-500/10 p-3 text-[12px] leading-relaxed text-amber-700 ring-1 ring-amber-400/20 dark:text-amber-200">
          ※ 수수료율과 정산 조건은 파트너 승인 후 개별 계약/안내에 따라 달라질 수 있습니다.
        </p>
      </Section>

      <Section icon={<ClipboardList size={16} />} title="지원 절차">
        <ol className="flex flex-wrap gap-2 text-[12px]">
          {STEPS.map((s, i) => (
            <li key={s} className="inline-flex items-center gap-1.5 rounded-full bg-bg-soft px-3 py-1.5 ring-1 ring-line/10">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-600 text-[10px] font-bold text-white">{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
      </Section>

      {/* 지원 폼 */}
      <form id="apply" onSubmit={onSubmit} className="mt-10 space-y-5 rounded-2xl bg-bg-card p-5 ring-1 ring-line/10 sm:p-7">
        <h2 className="text-lg font-extrabold">영업 파트너 지원서</h2>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="이름 *"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="연락처 *"><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="010-0000-0000" /></Field>
          <Field label="이메일 *"><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="활동 지역 *"><input className="input" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} placeholder="예: 서울 성동구" /></Field>
        </div>

        <Field label="영업 가능 업종 * (복수 선택)">
          <div className="flex flex-wrap gap-1.5">
            {BUSINESS_TYPES.map((t) => {
              const on = form.target_business_types.includes(t);
              return (
                <button key={t} type="button" onClick={() => toggleType(t)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition ${on ? 'bg-violet-600 text-white ring-violet-600' : 'bg-bg-soft text-ink-mute ring-line/10 hover:text-ink'}`}>
                  {t}
                </button>
              );
            })}
          </div>
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="영업 경험 여부 *">
            <div className="flex gap-2">
              {(['yes', 'no'] as const).map((v) => (
                <button key={v} type="button" onClick={() => setForm({ ...form, has_sales_experience: v })}
                  className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold ring-1 ${form.has_sales_experience === v ? 'bg-violet-600 text-white ring-violet-600' : 'bg-bg-soft text-ink-mute ring-line/10'}`}>
                  {v === 'yes' ? '있음' : '없음'}
                </button>
              ))}
            </div>
          </Field>
          <Field label="예상 소개 가능 매장 수">
            <input className="input" type="number" min={0} value={form.expected_store_count} onChange={(e) => setForm({ ...form, expected_store_count: e.target.value })} placeholder="예: 20" />
          </Field>
        </div>

        <Field label="지원 동기 *">
          <textarea className="input" rows={3} value={form.motivation} onChange={(e) => setForm({ ...form, motivation: e.target.value })} />
        </Field>

        <details className="rounded-xl bg-bg-soft/50 p-3 ring-1 ring-line/10">
          <summary className="cursor-pointer text-xs font-semibold text-ink-mute">선택 입력 (회사/네트워크/문의)</summary>
          <div className="mt-3 space-y-3">
            <Field label="회사 / 사업자명"><input className="input" value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} /></Field>
            <Field label="보유 네트워크 설명"><textarea className="input" rows={2} value={form.network_description} onChange={(e) => setForm({ ...form, network_description: e.target.value })} /></Field>
            <Field label="기타 문의사항"><textarea className="input" rows={2} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></Field>
          </div>
        </details>

        <button type="submit" disabled={submitting} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 py-3.5 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-50">
          {submitting && <Loader2 size={15} className="animate-spin" />} 지원서 제출하기
        </button>
        <p className="text-center text-[11px] text-ink-dim">제출 시 입력하신 정보는 파트너 검토 목적에 한해 사용됩니다.</p>
      </form>
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 flex items-center gap-1.5 text-base font-extrabold"><span className="text-violet-500">{icon}</span> {title}</h2>
      {children}
    </section>
  );
}
function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 rounded-lg bg-bg-soft/50 p-2.5 text-[13px] leading-relaxed ring-1 ring-line/10">
      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500" />{children}
    </li>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-semibold text-ink-mute">{label}</span>
      {children}
    </label>
  );
}
