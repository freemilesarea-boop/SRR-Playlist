// 관리자 "브랜드 플레이어" 패널.
// 브랜드는 관리자 내부 객체 — 사용자 코드 없음. 본사(Enterprise)에 1:1 연결.
// 매장은 본사 Store Invite Code 로 진입 → 연결 브랜드 로드.
// CRUD + 본사 연결 + 음악정책 + 이미지 사이니지 + 미리보기.
import { useCallback, useEffect, useState } from 'react';
import { Plus, RefreshCw, Building2, Image as ImageIcon, Trash2, Power, Eye, Link2, Monitor } from 'lucide-react';
import {
  AdminSection, AdminCard, AdminButton, AdminBadge, AdminAlert, AdminEmpty, AdminSkeleton, AdminModal, AdminStatCard,
} from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  adminListBrands, adminGetBrand, adminCreateBrand, adminUpdateBrand, adminSetBrandDeleted,
  adminSetBrandEnterprise, adminUpsertBrandMusicPolicy, adminPreviewBrandMusicPolicy, adminAddBrandMedia, adminUpdateBrandMedia, adminDeleteBrandMedia,
  adminUpsertBrandSignageSettings,
} from '@/lib/api/brandPlayerApi';
import { adminListEnterpriseAccounts, type EnterpriseAccount } from '@/lib/api/enterpriseAccountsApi';
import { uploadBrandMedia } from '@/lib/brandMediaUpload';
import { isVideoAsset, formatMediaDuration, formatBytes, IMAGE_MIME_TYPES, VIDEO_MIME_TYPES } from '@/lib/brandMediaType';
import BrandSignage from '@/components/brand/BrandSignage';
import BrandPresentationOverlays from '@/components/brand/BrandPresentationOverlays';
import {
  normalizeSignageSettings, normalizeTransitionMs, MIN_TRANSITION_MS, MAX_TRANSITION_MS,
} from '@/lib/brandSignageSettings';
import type { BrandListItem, BrandDetail, BrandVocalPolicy, SignageTransitionEffect, BrandPolicyMode, BrandPolicyPreview } from '@/types/brand';
import { BUSINESS_TAG_LABELS } from '@/lib/recommendationTaxonomy';
import { isStudyCafeStoreType, STUDY_CAFE_POLICY_DESCRIPTOR } from '@/lib/studyCafePolicy';
import {
  BRAND_POLICY_GENRES, BRAND_POLICY_MOODS, POLICY_MODE_LABELS, WARNING_LABELS,
  STUDY_CAFE_HARD, STUDY_CAFE_POLICY_GENRES,
  validateCustomPolicy, clampStudyCafeBrandPolicy, genreLabel,
  type BrandPolicyWarning, type TaxonomyOption, type BrandVocalPolicyLite,
} from '@/lib/brandMusicPolicy';

/** 업종 자유입력 + 선택 목록(datalist) 공용 id. 스터디카페 포함. */
const STORE_TYPE_DATALIST_ID = 'brand-store-type-options';
/** 등록/수정 업종 입력에 붙는 선택 가능한 업종 목록 (스터디카페 포함). */
function StoreTypeOptions() {
  return (
    <datalist id={STORE_TYPE_DATALIST_ID}>
      {Object.values(BUSINESS_TAG_LABELS).map((label) => (
        <option key={label} value={label} />
      ))}
    </datalist>
  );
}

/** 스터디카페 업종 선택 시 노출되는 정책 안내 카드 (§11 최소 표시). */
function StudyCafePolicyNotice({ industry }: { industry: string }) {
  if (!isStudyCafeStoreType(industry)) return null;
  const d = STUDY_CAFE_POLICY_DESCRIPTOR;
  return (
    <div className="rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-[11px] leading-relaxed text-ink-dim">
      <p className="font-semibold text-ink">스터디카페 전용 정책 (Strict)</p>
      <p>허용 장르: {d.allowedGenres.join(' / ')}</p>
      <p>Vocal Policy: {d.vocalPolicy} · Music Intensity: {d.musicIntensity}</p>
      <p>허용 조건 미달 음원은 후보 풀·큐·fallback 에서 원천 차단됩니다.</p>
    </div>
  );
}

const VOCAL_LABELS: Record<BrandVocalPolicy, string> = {
  any: '제한 없음', vocal_ok: '보컬 허용', prefer_instrumental: '연주곡 선호', instrumental_only: '연주곡만',
};
/** taxonomy 슬러그 다중선택 칩. 값이 하나도 없으면 "제한 없음" 의미. */
function ChipMulti({ options, selected, onToggle, tone = 'accent' }: {
  options: readonly TaxonomyOption[]; selected: string[]; onToggle: (slug: string) => void;
  tone?: 'accent' | 'danger';
}) {
  const onCls = tone === 'danger'
    ? 'border-red-400/60 bg-red-500/15 text-red-200'
    : 'border-accent/60 bg-accent/15 text-accent';
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = selected.includes(o.slug);
        return (
          <button key={o.slug} type="button" onClick={() => onToggle(o.slug)}
            className={`rounded-full border px-2.5 py-1 text-[12px] transition ${on ? onCls : 'border-line/25 bg-bg text-ink-mute hover:border-line/50'}`}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export default function BrandPlayerPanel() {
  const [rows, setRows] = useState<BrandListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setRows(await adminListBrands(false)); }
    catch (e) { setErr(e instanceof Error ? e.message : '조회 실패'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function toggleStatus(b: BrandListItem) {
    setBusy(b.id);
    try {
      await adminUpdateBrand({ id: b.id, status: b.status === 'active' ? 'inactive' : 'active' });
      toast.success(b.status === 'active' ? '비활성화했어요' : '활성화했어요');
      await load();
    } catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusy(null); }
  }

  async function remove(b: BrandListItem) {
    if (!confirm(`${b.name} 브랜드를 삭제할까요? (soft delete — 매장 진입 불가 처리)`)) return;
    setBusy(b.id);
    try { await adminSetBrandDeleted(b.id, true); toast.success('삭제했어요'); await load(); }
    catch (e) { toast.error(`삭제 실패: ${(e as Error).message}`); }
    finally { setBusy(null); }
  }

  return (
    <AdminSection
      title="브랜드 플레이어"
      description="브랜드는 관리자 내부 객체입니다. 각 브랜드를 본사(Enterprise)에 연결하면, 그 본사의 매장 코드로 매장이 진입해 브랜드 음악·사이니지를 재생합니다."
      action={
        <div className="flex gap-2">
          <AdminButton tone="neutral" variant="subtle" size="sm" leftIcon={<RefreshCw size={14} />} onClick={() => void load()}>새로고침</AdminButton>
          <AdminButton tone="primary" size="sm" leftIcon={<Plus size={14} />} onClick={() => setCreating(true)}>새 브랜드</AdminButton>
        </div>
      }
    >
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <AdminStatCard label="전체 브랜드" value={String(rows.length)} />
        <AdminStatCard label="활성" value={String(rows.filter((r) => r.status === 'active').length)} tone="success" />
        <AdminStatCard label="본사 연결됨" value={String(rows.filter((r) => r.enterprise_account_id).length)} tone="info" />
        <AdminStatCard label="이미지 등록" value={String(rows.filter((r) => (r.active_media_count ?? 0) > 0).length)} tone="neutral" />
      </div>

      {loading ? (
        <AdminSkeleton variant="card" />
      ) : err ? (
        <AdminAlert tone="danger" title="조회 실패" description={err} />
      ) : rows.length === 0 ? (
        <AdminEmpty icon={<ImageIcon size={26} />} title="등록된 브랜드가 없어요" description="새 브랜드를 생성하고 본사에 연결하세요." action={<AdminButton tone="primary" size="sm" leftIcon={<Plus size={14} />} onClick={() => setCreating(true)}>새 브랜드</AdminButton>} />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((b) => (
            <AdminCard key={b.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-ink">{b.name}</p>
                  <p className="mt-0.5 text-[11px] text-ink-mute">{b.industry_type || '업종 미지정'}</p>
                </div>
                <AdminBadge tone={b.status === 'active' ? 'success' : 'neutral'}>{b.status === 'active' ? '활성' : '비활성'}</AdminBadge>
              </div>
              <div className="mt-2">
                {b.enterprise_account_id
                  ? <AdminBadge tone="info"><Building2 size={10} /> {b.enterprise_name ?? '본사'}</AdminBadge>
                  : <AdminBadge tone="warning">본사 미연결</AdminBadge>}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-ink-dim">
                <span className="rounded bg-bg-hover px-1.5 py-0.5">이미지 {b.active_media_count ?? 0}</span>
                <span className="rounded bg-bg-hover px-1.5 py-0.5">선호장르 {b.preferred_genre_count ?? 0}</span>
                <span className="rounded bg-bg-hover px-1.5 py-0.5">차단장르 {b.blocked_genre_count ?? 0}</span>
                {b.last_seen_at && <span className="rounded bg-bg-hover px-1.5 py-0.5">최근접속 {new Date(b.last_seen_at).toLocaleDateString('ko-KR')}</span>}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <AdminButton size="sm" variant="subtle" tone="primary" leftIcon={<Eye size={13} />} onClick={() => setDetailId(b.id)}>상세/편집</AdminButton>
                <AdminButton size="sm" variant="ghost" tone="neutral" leftIcon={<Power size={13} />} disabled={busy === b.id} onClick={() => void toggleStatus(b)}>{b.status === 'active' ? '비활성화' : '활성화'}</AdminButton>
                <AdminButton size="sm" variant="ghost" tone="danger" leftIcon={<Trash2 size={13} />} disabled={busy === b.id} onClick={() => void remove(b)}>삭제</AdminButton>
              </div>
            </AdminCard>
          ))}
        </div>
      )}

      {creating && (
        <CreateBrandModal onClose={() => setCreating(false)} onCreated={() => { setCreating(false); void load(); }} />
      )}
      {detailId && (
        <BrandDetailModal brandId={detailId} onClose={() => setDetailId(null)} onChanged={() => void load()} />
      )}
    </AdminSection>
  );
}

// ── 본사 선택 (연결) ─────────────────────────────────────────────────
function useEnterpriseOptions() {
  const [opts, setOpts] = useState<EnterpriseAccount[]>([]);
  useEffect(() => {
    let alive = true;
    void adminListEnterpriseAccounts({ limit: 200, offset: 0 })
      .then((r) => { if (alive) setOpts(r.data); })
      .catch(() => { /* silent — 선택 안 함 유지 */ });
    return () => { alive = false; };
  }, []);
  return opts;
}

function EnterpriseSelect({ value, onChange, disabled }: { value: string | null; onChange: (v: string | null) => void; disabled?: boolean }) {
  const opts = useEnterpriseOptions();
  return (
    <select className={inputCls} value={value ?? ''} disabled={disabled}
      onChange={(e) => onChange(e.target.value || null)}>
      <option value="">— 연결 안 함 —</option>
      {opts.map((o) => <option key={o.id} value={o.id}>{o.enterprise_name}</option>)}
    </select>
  );
}

// ── 생성 ─────────────────────────────────────────────────────────────
function CreateBrandModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [desc, setDesc] = useState('');
  const [enterpriseId, setEnterpriseId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!name.trim()) { toast.error('브랜드명을 입력해주세요'); return; }
    setSaving(true);
    try {
      await adminCreateBrand({ name: name.trim(), industryType: industry.trim() || null, description: desc.trim() || null, enterpriseAccountId: enterpriseId });
      toast.success('브랜드를 생성했어요');
      onCreated();
    } catch (e) { toast.error(`생성 실패: ${(e as Error).message}`); }
    finally { setSaving(false); }
  }

  return (
    <AdminModal open onClose={onClose} title="새 브랜드" size="md"
      footer={<><AdminButton tone="neutral" variant="subtle" onClick={onClose}>취소</AdminButton><AdminButton tone="primary" onClick={() => void submit()} disabled={saving}>{saving ? '생성 중…' : '생성'}</AdminButton></>}>
      <div className="space-y-3">
        <Field label="브랜드명 *"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 루베르 브랜드 플레이어" maxLength={80} /></Field>
        <Field label="업종">
          <input className={inputCls} value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="예: 카페 / 와인바 / 스터디카페" maxLength={50} list={STORE_TYPE_DATALIST_ID} />
          <StoreTypeOptions />
        </Field>
        <StudyCafePolicyNotice industry={industry} />
        <Field label="설명"><textarea className={inputCls} value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} maxLength={300} /></Field>
        <Field label="연결 본사 (Enterprise)"><EnterpriseSelect value={enterpriseId} onChange={setEnterpriseId} /></Field>
        <p className="text-[11px] text-ink-dim">본사에 연결하면 그 본사의 매장 코드로 매장이 이 브랜드 플레이어에 진입합니다. 본사당 브랜드 1개.</p>
      </div>
    </AdminModal>
  );
}

// ── 음악 정책 폼 직렬화(미저장 변경 감지용) ────────────────────────────
interface PolicyFormState {
  policyMode: BrandPolicyMode; allowed: string[]; pref: string[]; block: string[];
  prefM: string[]; blockM: string[]; eMin: string; eMax: string; bMin: string; bMax: string;
  vocal: BrandVocalPolicy; autoGen: boolean;
}
/** 정규화된 안정 문자열 — 폼 baseline 과 현재 상태를 비교해 "저장 안 한 변경" 을 판별. */
function serializePolicyForm(f: PolicyFormState): string {
  const s = (a: string[]) => [...a].map((x) => x.trim().toLowerCase()).filter(Boolean).sort();
  if (f.policyMode === 'inherit') return JSON.stringify(['inherit', f.autoGen]);
  return JSON.stringify([
    'custom', s(f.allowed), s(f.block), s(f.pref), s(f.blockM), s(f.prefM),
    f.eMin.trim(), f.eMax.trim(), f.bMin.trim(), f.bMax.trim(), f.vocal, f.autoGen,
  ]);
}

/** 값 없음 표기. */
const DASH = '—';
function genresLabel(slugs: string[]): string {
  return slugs.length ? slugs.map(genreLabel).join(', ') : DASH;
}
function rangeLabel(min: number | null, max: number | null): string {
  if (min == null && max == null) return DASH;
  return `${min ?? '·'} ~ ${max ?? '·'}`;
}

/**
 * 최종 적용 정책(effective) 3계층 표시: 업종 강제값 / 브랜드 설정값 / 최종 적용값.
 * 최종값은 서버와 동일한 study-cafe 클램프(clampStudyCafeBrandPolicy)로 계산 —
 * 저장 전에 "실제로 무엇이 적용되는가" 를 관리자에게 그대로 보여준다.
 */
function EffectivePolicyView({ isStudy, form, num }: {
  isStudy: boolean; form: PolicyFormState; num: (s: string) => number | null;
}) {
  const brandAllowed = form.policyMode === 'custom' ? form.allowed : [];
  const brandVocal: BrandVocalPolicyLite = form.policyMode === 'custom' ? form.vocal : 'any';
  const brandEMin = form.policyMode === 'custom' ? num(form.eMin) : null;
  const brandEMax = form.policyMode === 'custom' ? num(form.eMax) : null;
  const brandBMin = form.policyMode === 'custom' ? num(form.bMin) : null;
  const brandBMax = form.policyMode === 'custom' ? num(form.bMax) : null;

  const { values: fin } = clampStudyCafeBrandPolicy(
    { allowedGenres: brandAllowed, vocalPolicy: brandVocal, energyMin: brandEMin, energyMax: brandEMax, bpmMin: brandBMin, bpmMax: brandBMax },
    isStudy,
  );

  const VOCAL_SHORT: Record<BrandVocalPolicyLite, string> = {
    any: '제한 없음', vocal_ok: '보컬 허용', prefer_instrumental: '연주곡 선호', instrumental_only: '연주곡만',
  };
  // 업종 강제값(하드 정책). 스터디카페만 강제, 그 외 업종은 강제 없음.
  const industry = isStudy
    ? {
        allowed: `${STUDY_CAFE_POLICY_GENRES.map(genreLabel).join(', ')} (이 집합으로 제한)`,
        vocal: VOCAL_SHORT.instrumental_only,
        energy: `≤ ${STUDY_CAFE_HARD.energyMax}`,
        bpm: `≤ ${STUDY_CAFE_HARD.bpmMax}`,
      }
    : { allowed: '제한 없음', vocal: '제한 없음', energy: '제한 없음', bpm: '제한 없음' };
  const brand = form.policyMode === 'inherit'
    ? { allowed: '업종 상속', vocal: '업종 상속', energy: '업종 상속', bpm: '업종 상속' }
    : {
        allowed: genresLabel(brandAllowed) + (brandAllowed.length ? '' : ' (전체 허용)'),
        vocal: VOCAL_SHORT[brandVocal],
        energy: rangeLabel(brandEMin, brandEMax),
        bpm: rangeLabel(brandBMin, brandBMax),
      };
  const final = {
    allowed: form.policyMode === 'inherit'
      ? (isStudy ? industry.allowed : '전체 허용')
      : genresLabel(fin.allowedGenres) + (fin.allowedGenres.length ? '' : ' (전체 허용)'),
    vocal: VOCAL_SHORT[fin.vocalPolicy],
    energy: rangeLabel(fin.energyMin, fin.energyMax),
    bpm: rangeLabel(fin.bpmMin, fin.bpmMax),
  };

  const rows: [string, string, string, string][] = [
    ['허용 장르', industry.allowed, brand.allowed, final.allowed],
    ['보컬', industry.vocal, brand.vocal, final.vocal],
    ['에너지', industry.energy, brand.energy, final.energy],
    ['BPM', industry.bpm, brand.bpm, final.bpm],
  ];
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-line/20 bg-bg-hover">
      <table className="w-full min-w-[420px] text-left text-[11px]">
        <thead>
          <tr className="text-ink-dim">
            <th className="px-2.5 py-1.5 font-semibold">항목</th>
            <th className="px-2.5 py-1.5 font-semibold">업종 강제값</th>
            <th className="px-2.5 py-1.5 font-semibold">브랜드 설정값</th>
            <th className="px-2.5 py-1.5 font-semibold text-accent">최종 적용값</th>
          </tr>
        </thead>
        <tbody className="text-ink-mute">
          {rows.map(([k, i, b, fv]) => (
            <tr key={k} className="border-t border-line/10">
              <td className="px-2.5 py-1.5 font-medium text-ink-dim">{k}</td>
              <td className="px-2.5 py-1.5">{i}</td>
              <td className="px-2.5 py-1.5">{b}</td>
              <td className="px-2.5 py-1.5 font-semibold text-ink">{fv}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── 상세/편집 ────────────────────────────────────────────────────────
function BrandDetailModal({ brandId, onClose, onChanged }: { brandId: string; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<BrandDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [savingLink, setSavingLink] = useState(false);
  const [uploading, setUploading] = useState(false);

  // 음악 정책 "스튜디오" 폼 상태 (0464). 장르/무드는 taxonomy 슬러그 배열(칩).
  const [policyMode, setPolicyMode] = useState<BrandPolicyMode>('inherit');
  const [allowed, setAllowed] = useState<string[]>([]);
  const [pref, setPref] = useState<string[]>([]); const [block, setBlock] = useState<string[]>([]);
  const [prefM, setPrefM] = useState<string[]>([]); const [blockM, setBlockM] = useState<string[]>([]);
  const [eMin, setEMin] = useState(''); const [eMax, setEMax] = useState('');
  const [bMin, setBMin] = useState(''); const [bMax, setBMax] = useState('');
  const [vocal, setVocal] = useState<BrandVocalPolicy>('any');
  const [autoGen, setAutoGen] = useState(true);
  const [preview, setPreview] = useState<BrandPolicyPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [enterpriseId, setEnterpriseId] = useState<string | null>(null);
  // 저장 시점 baseline(직렬화 문자열) — 현재 폼과 비교해 "저장 안 한 변경" 을 감지.
  const [policyBaseline, setPolicyBaseline] = useState<string>('');

  // 사이니지 표시 설정(전환효과/시간 + presentation 표시옵션) — 폼 상태.
  const [sigEffect, setSigEffect] = useState<SignageTransitionEffect>('fade');
  const [sigDur, setSigDur] = useState('500');
  const [sigBrandName, setSigBrandName] = useState(false);
  const [sigNowPlaying, setSigNowPlaying] = useState(false);
  const [sigClock, setSigClock] = useState(false);
  const [sigDots, setSigDots] = useState(false);
  const [savingSignage, setSavingSignage] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const d = await adminGetBrand(brandId);
      setDetail(d);
      const p = d.policy;
      const loaded: PolicyFormState = {
        policyMode: (p?.policy_mode as BrandPolicyMode) ?? 'inherit',
        allowed: p?.allowed_genres ?? [],
        pref: p?.preferred_genres ?? [], block: p?.blocked_genres ?? [],
        prefM: p?.preferred_moods ?? [], blockM: p?.blocked_moods ?? [],
        eMin: p?.energy_min != null ? String(p.energy_min) : '', eMax: p?.energy_max != null ? String(p.energy_max) : '',
        bMin: p?.bpm_min != null ? String(p.bpm_min) : '', bMax: p?.bpm_max != null ? String(p.bpm_max) : '',
        vocal: (p?.vocal_policy as BrandVocalPolicy) ?? 'any',
        autoGen: p?.auto_generate_enabled ?? true,
      };
      setPolicyMode(loaded.policyMode);
      setAllowed(loaded.allowed);
      setPref(loaded.pref); setBlock(loaded.block);
      setPrefM(loaded.prefM); setBlockM(loaded.blockM);
      setEMin(loaded.eMin); setEMax(loaded.eMax);
      setBMin(loaded.bMin); setBMax(loaded.bMax);
      setVocal(loaded.vocal);
      setAutoGen(loaded.autoGen);
      setPolicyBaseline(serializePolicyForm(loaded));
      setPreview(null);
      setEnterpriseId(d.brand.enterprise_account_id);
      // signage: 레거시/null 은 default 로 정규화하여 로드.
      const s = normalizeSignageSettings(d.signage);
      setSigEffect(s.transition_effect);
      setSigDur(String(s.transition_duration_ms));
      setSigBrandName(s.show_brand_name); setSigNowPlaying(s.show_now_playing);
      setSigClock(s.show_clock); setSigDots(s.show_slide_dots);
    } catch (e) { setErr(e instanceof Error ? e.message : '조회 실패'); }
    finally { setLoading(false); }
  }, [brandId]);
  useEffect(() => { void reload(); }, [reload]);

  async function saveLink() {
    setSavingLink(true);
    try {
      await adminSetBrandEnterprise(brandId, enterpriseId);
      toast.success('본사 연결을 저장했어요'); await reload(); onChanged();
    } catch (e) { toast.error(`연결 실패: ${(e as Error).message}`); }
    finally { setSavingLink(false); }
  }

  const isStudy = isStudyCafeStoreType(detail?.brand.industry_type);
  const num = (s: string) => (s.trim() === '' ? null : Number(s));

  const currentForm: PolicyFormState = { policyMode, allowed, pref, block, prefM, blockM, eMin, eMax, bMin, bMax, vocal, autoGen };
  const policyDirty = policyBaseline !== '' && serializePolicyForm(currentForm) !== policyBaseline;

  /** "업종 기본으로 초기화" — 상속 모드로 되돌리고 커스텀 필드를 비운다(저장 시 반영). */
  function resetToInherit() {
    setPolicyMode('inherit');
    setAllowed([]); setPref([]); setBlock([]); setPrefM([]); setBlockM([]);
    setEMin(''); setEMax(''); setBMin(''); setBMax(''); setVocal('any');
    setPreview(null);
  }
  /** 미저장 변경이 있으면 닫기 전 확인. */
  function handleClose() {
    if (policyDirty && !confirm('저장하지 않은 음악 정책 변경이 있습니다. 닫을까요?')) return;
    onClose();
  }

  /** 현재 폼값을 preview override(jsonb) 로 직렬화 (inherit 이면 커스텀 필드 무시). */
  function overridesFromForm(): Record<string, unknown> {
    if (policyMode === 'inherit') return { policy_mode: 'inherit' };
    return {
      policy_mode: 'custom',
      allowed_genres: allowed, blocked_genres: block, preferred_genres: pref,
      blocked_moods: blockM, preferred_moods: prefM,
      vocal_policy: vocal,
      energy_min: num(eMin), energy_max: num(eMax),
      bpm_min: num(bMin), bpm_max: num(bMax),
    };
  }

  async function doPreview() {
    setPreviewing(true);
    try {
      setPreview(await adminPreviewBrandMusicPolicy(brandId, overridesFromForm()));
    } catch (e) { toast.error(`미리보기 실패: ${(e as Error).message}`); }
    finally { setPreviewing(false); }
  }

  async function savePolicy() {
    // custom 모드는 서버 왕복 전에 로컬 선검증(장르/무드 슬러그·범위·겹침).
    if (policyMode === 'custom') {
      const v = validateCustomPolicy({
        allowedGenres: allowed, blockedGenres: block, preferredGenres: pref,
        blockedMoods: blockM, preferredMoods: prefM,
        energyMin: num(eMin), energyMax: num(eMax), bpmMin: num(bMin), bpmMax: num(bMax),
      });
      if (!v.ok) { toast.error(v.error ?? '정책 값이 올바르지 않아요'); return; }
    }
    setSavingPolicy(true);
    try {
      const res = await adminUpsertBrandMusicPolicy({
        brandId,
        policyMode,
        allowedGenres: policyMode === 'custom' ? allowed : [],
        preferredGenres: policyMode === 'custom' ? pref : [],
        blockedGenres: policyMode === 'custom' ? block : [],
        preferredMoods: policyMode === 'custom' ? prefM : [],
        blockedMoods: policyMode === 'custom' ? blockM : [],
        energyMin: policyMode === 'custom' ? num(eMin) : null,
        energyMax: policyMode === 'custom' ? num(eMax) : null,
        bpmMin: policyMode === 'custom' ? num(bMin) : null,
        bpmMax: policyMode === 'custom' ? num(bMax) : null,
        vocalPolicy: policyMode === 'custom' ? vocal : null,
        autoGenerateEnabled: autoGen,
      });
      const warns = (res.warnings ?? []) as BrandPolicyWarning[];
      if (warns.length > 0) {
        toast.success('저장했어요 — 스터디카페 하드 정책이 적용되었습니다');
        for (const w of warns) toast.info(WARNING_LABELS[w] ?? w);
      } else {
        toast.success('음악 정책을 저장했어요');
      }
      await reload(); onChanged();
    } catch (e) { toast.error(`저장 실패: ${(e as Error).message}`); }
    finally { setSavingPolicy(false); }
  }

  async function saveSignage() {
    if (savingSignage) return; // 중복 저장 방지(버튼 disabled 와 이중 가드)
    setSavingSignage(true);
    try {
      await adminUpsertBrandSignageSettings({
        brandId,
        transitionEffect: sigEffect,
        transitionDurationMs: normalizeTransitionMs(sigDur),
        showBrandName: sigBrandName, showNowPlaying: sigNowPlaying,
        showClock: sigClock, showSlideDots: sigDots,
      });
      toast.success('사이니지 설정을 저장했어요'); await reload(); onChanged();
    } catch (e) { toast.error(`저장 실패: ${(e as Error).message}`); }
    finally { setSavingSignage(false); }
  }

  async function onPickMedia(file: File) {
    setUploading(true);
    try {
      const up = await uploadBrandMedia(brandId, file);
      if (!up.ok || !up.url) { toast.error(up.error || '업로드 실패'); return; }
      const isVideo = up.assetType === 'video';
      await adminAddBrandMedia({
        brandId, imageUrl: up.url, displayDurationSeconds: 10,
        assetType: up.assetType ?? 'image', mimeType: up.mimeType ?? null,
        mediaDurationSeconds: up.durationSeconds ?? null,
      });
      // 파일명/용량은 업로드 시점에만 확인 가능 → 토스트로 안내(재생시간/종류는 목록에 표시).
      const sizeLabel = formatBytes(up.sizeBytes);
      toast.success(isVideo
        ? `동영상을 추가했어요 (${file.name} · ${sizeLabel}${up.durationSeconds ? ` · ${formatMediaDuration(up.durationSeconds)}` : ''})`
        : `이미지를 추가했어요 (${file.name} · ${sizeLabel})`);
      await reload(); onChanged();
    } catch (e) { toast.error(`미디어 추가 실패: ${(e as Error).message}`); }
    finally { setUploading(false); }
  }

  async function updateMedia(assetId: string, patch: { title?: string; displayDurationSeconds?: number; sortOrder?: number; status?: 'active' | 'inactive' }) {
    try { await adminUpdateBrandMedia({ assetId, ...patch }); await reload(); onChanged(); }
    catch (e) { toast.error(`수정 실패: ${(e as Error).message}`); }
  }
  async function deleteMedia(assetId: string) {
    if (!confirm('이 미디어를 삭제할까요?')) return;
    try { await adminDeleteBrandMedia(assetId); toast.success('삭제했어요'); await reload(); onChanged(); }
    catch (e) { toast.error(`삭제 실패: ${(e as Error).message}`); }
  }

  const media = detail?.media ?? [];
  const previewItems = media.filter((m) => (m.status ?? 'active') === 'active')
    .map((m) => ({
      id: m.id, title: m.title, image_url: m.image_url, display_duration_seconds: m.display_duration_seconds,
      asset_type: m.asset_type, mime_type: m.mime_type,
    }));

  return (
    <AdminModal open onClose={handleClose} title={detail?.brand.name ?? '브랜드 상세'} size="xl"
      footer={<AdminButton tone="neutral" variant="subtle" onClick={handleClose}>닫기</AdminButton>}>
      {loading ? <AdminSkeleton variant="block" rows={6} />
        : err ? <AdminAlert tone="danger" title="조회 실패" description={err} />
        : detail && (
          <div className="space-y-5">
            {/* 본사 연결 */}
            <AdminCard title="연결 본사 (Enterprise)" subtitle="매장은 이 본사의 매장 코드(Store Invite Code)로 진입합니다.">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="연결 본사"><EnterpriseSelect value={enterpriseId} onChange={setEnterpriseId} disabled={savingLink} /></Field>
                <Field label="매장 코드 (본사 · 참고)">
                  <div className={`${inputCls} flex items-center justify-between`}>
                    <span className="font-mono">{detail.brand.store_invite_code ?? '— 본사 미연결 —'}</span>
                    {detail.brand.store_invite_code && (
                      <button type="button" className="text-ink-dim hover:text-ink"
                        onClick={() => { void navigator.clipboard?.writeText(detail.brand.store_invite_code!).then(() => toast.success('복사됨')); }}>복사</button>
                    )}
                  </div>
                </Field>
              </div>
              <div className="mt-3"><AdminButton tone="primary" size="sm" leftIcon={<Link2 size={13} />} onClick={() => void saveLink()} disabled={savingLink}>{savingLink ? '저장 중…' : '연결 저장'}</AdminButton></div>
            </AdminCard>

            {/* 음악 정책 스튜디오 (0464) */}
            <AdminCard title="음악 정책 스튜디오" subtitle="업종 기본을 상속하거나 브랜드 커스텀 정책을 구성합니다. 업종 하드 정책(스터디카페)은 브랜드가 완화할 수 없습니다.">
              {isStudy && (
                <div className="mb-3"><StudyCafePolicyNotice industry={detail.brand.industry_type ?? ''} /></div>
              )}

              {/* 정책 모드 토글 */}
              <div className="mb-3 flex gap-2">
                {(['inherit', 'custom'] as BrandPolicyMode[]).map((m) => (
                  <button key={m} type="button" onClick={() => { setPolicyMode(m); setPreview(null); }}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm transition ${policyMode === m ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line/25 bg-bg text-ink-mute hover:border-line/50'}`}>
                    <span className="font-semibold">{POLICY_MODE_LABELS[m]}</span>
                    <span className="block text-[11px] text-ink-dim">
                      {m === 'inherit' ? '업종 기본 정책만 적용' : '허용 장르·차단·범위 직접 설정'}
                    </span>
                  </button>
                ))}
              </div>

              {policyMode === 'inherit' ? (
                <p className="rounded-lg border border-line/20 bg-bg-hover px-3 py-2 text-[12px] leading-relaxed text-ink-dim">
                  이 브랜드는 업종 기본 정책만 적용합니다. 브랜드 커스텀 필터(허용/차단 장르·무드, 에너지/BPM, 보컬)는 저장 시 모두 비워집니다.
                  {isStudy && ' 스터디카페 strict 하드 정책은 그대로 유지됩니다.'}
                </p>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="허용 장르 (비우면 전체 허용)">
                      <ChipMulti options={BRAND_POLICY_GENRES} selected={allowed}
                        onToggle={(s) => setAllowed(allowed.includes(s) ? allowed.filter((x) => x !== s) : [...allowed, s])} />
                    </Field>
                    <Field label="차단 장르">
                      <ChipMulti options={BRAND_POLICY_GENRES} selected={block} tone="danger"
                        onToggle={(s) => setBlock(block.includes(s) ? block.filter((x) => x !== s) : [...block, s])} />
                    </Field>
                    <Field label="선호 장르 (가중치)">
                      <ChipMulti options={BRAND_POLICY_GENRES} selected={pref}
                        onToggle={(s) => setPref(pref.includes(s) ? pref.filter((x) => x !== s) : [...pref, s])} />
                    </Field>
                    <Field label="차단 무드">
                      <ChipMulti options={BRAND_POLICY_MOODS} selected={blockM} tone="danger"
                        onToggle={(s) => setBlockM(blockM.includes(s) ? blockM.filter((x) => x !== s) : [...blockM, s])} />
                    </Field>
                    <Field label="선호 무드 (가중치)">
                      <ChipMulti options={BRAND_POLICY_MOODS} selected={prefM}
                        onToggle={(s) => setPrefM(prefM.includes(s) ? prefM.filter((x) => x !== s) : [...prefM, s])} />
                    </Field>
                    <Field label="보컬 정책">
                      <select className={inputCls} value={vocal} onChange={(e) => setVocal(e.target.value as BrandVocalPolicy)}>
                        {(Object.keys(VOCAL_LABELS) as BrandVocalPolicy[]).map((k) => <option key={k} value={k}>{VOCAL_LABELS[k]}</option>)}
                      </select>
                    </Field>
                    <Field label="에너지 최소 (0~1)"><input className={inputCls} value={eMin} onChange={(e) => setEMin(e.target.value)} placeholder="0.2" inputMode="decimal" /></Field>
                    <Field label="에너지 최대 (0~1)"><input className={inputCls} value={eMax} onChange={(e) => setEMax(e.target.value)} placeholder="0.8" inputMode="decimal" /></Field>
                    <Field label="BPM 최소 (0~300)"><input className={inputCls} value={bMin} onChange={(e) => setBMin(e.target.value)} placeholder="60" inputMode="numeric" /></Field>
                    <Field label="BPM 최대 (0~300)"><input className={inputCls} value={bMax} onChange={(e) => setBMax(e.target.value)} placeholder="120" inputMode="numeric" /></Field>
                  </div>

                  {/* 스터디카페 하드 클램프 라이브 안내 — 저장 전에 실제 적용될 값을 알려줌 */}
                  {isStudy && (() => {
                    const { warnings } = clampStudyCafeBrandPolicy(
                      { allowedGenres: allowed, vocalPolicy: vocal, energyMin: num(eMin), energyMax: num(eMax), bpmMin: num(bMin), bpmMax: num(bMax) },
                      true,
                    );
                    if (warnings.length === 0) return null;
                    return (
                      <div className="mt-3 rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
                        <p className="font-semibold">저장 시 스터디카페 하드 정책으로 다음이 강제 적용됩니다:</p>
                        <ul className="mt-1 list-disc pl-4">
                          {warnings.map((w: BrandPolicyWarning) => <li key={w}>{WARNING_LABELS[w]}</li>)}
                        </ul>
                      </div>
                    );
                  })()}
                </>
              )}

              {/* 최종 적용 정책(effective) — 업종 강제값 / 브랜드 설정값 / 최종 적용값 */}
              <div className="mt-4">
                <p className="text-[11px] font-semibold text-ink-mute">최종 적용 정책 (effective)</p>
                <p className="text-[11px] text-ink-dim">업종 하드 정책이 브랜드 설정보다 항상 우선합니다. 아래 “최종 적용값”이 실제 재생에 사용됩니다.</p>
                <EffectivePolicyView isStudy={isStudy} form={currentForm} num={num} />
              </div>

              <div className="mt-3 flex items-center gap-2">
                <label className="flex items-center gap-2 text-[12px] text-ink-mute">
                  <input type="checkbox" checked={autoGen} onChange={(e) => setAutoGen(e.target.checked)} /> AI 자동 큐레이션(플레이리스트 자동 생성)
                </label>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <AdminButton tone="primary" size="sm" onClick={() => void savePolicy()} disabled={savingPolicy}>{savingPolicy ? '저장 중…' : '정책 저장'}</AdminButton>
                <AdminButton tone="neutral" variant="outline" size="sm" leftIcon={<Eye size={13} />} onClick={() => void doPreview()} disabled={previewing}>{previewing ? '계산 중…' : '후보 미리보기'}</AdminButton>
                <AdminButton tone="neutral" variant="ghost" size="sm" leftIcon={<RefreshCw size={13} />} onClick={resetToInherit} disabled={policyMode === 'inherit'}>업종 기본으로 초기화</AdminButton>
                {policyDirty && (
                  <span className="rounded-full border border-amber-400/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-300">● 저장되지 않은 변경</span>
                )}
              </div>

              {/* 마지막 수정 시각/관리자(감사) */}
              {(detail.policy?.updated_at || detail.policy?.updated_by_email) && (
                <p className="mt-2 text-[11px] text-ink-dim">
                  마지막 수정: {detail.policy?.updated_at ? new Date(detail.policy.updated_at).toLocaleString('ko-KR') : '—'}
                  {(detail.policy?.updated_by_email || detail.policy?.updated_by) && (
                    <> · {detail.policy?.updated_by_email ?? `관리자 ${String(detail.policy?.updated_by).slice(0, 8)}`}</>
                  )}
                </p>
              )}

              {/* 미리보기 결과 — 저장 안 해도 "이 설정이면 몇 곡 남는가" */}
              {preview && (
                <div className="mt-3 rounded-lg border border-line/20 bg-bg-hover px-3 py-2.5 text-[12px] text-ink-mute">
                  <div className="flex items-baseline gap-3">
                    <span className="text-lg font-semibold text-ink">{preview.eligible.toLocaleString()}</span>
                    <span className="text-ink-dim">곡 재생 가능 · 전체 {preview.total.toLocaleString()}곡{preview.is_study ? ` · 업종통과 ${preview.industry_pass.toLocaleString()}` : ''}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] text-ink-dim">
                    {([
                      ['업종', preview.blocked_by.industry], ['장르차단', preview.blocked_by.genre_block],
                      ['비허용장르', preview.blocked_by.genre_not_allowed], ['무드차단', preview.blocked_by.mood_block],
                      ['보컬', preview.blocked_by.vocal], ['에너지', preview.blocked_by.energy], ['BPM', preview.blocked_by.bpm],
                    ] as [string, number][]).filter(([, n]) => n > 0).map(([label, n]) => (
                      <span key={label} className="rounded bg-bg px-1.5 py-0.5">{label} −{n.toLocaleString()}</span>
                    ))}
                  </div>
                  {preview.eligible === 0 && (
                    <p className="mt-1.5 text-[11px] text-red-300">⚠ 이 설정으로는 재생 가능한 곡이 없습니다. 필터를 완화하세요.</p>
                  )}
                </div>
              )}
            </AdminCard>

            {/* 이미지/동영상 사이니지 */}
            <AdminCard title="사이니지 미디어 (이미지 · 동영상)" subtitle="순서대로 재생 후 반복. 이미지는 노출 시간(초)만큼, 동영상은 영상 종료까지. jpg/png/webp/gif(10MB), mp4/webm/mov(50MB)."
              action={
                <label className="cursor-pointer">
                  <input type="file" accept={[...IMAGE_MIME_TYPES, ...VIDEO_MIME_TYPES].join(',')} className="hidden" disabled={uploading}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPickMedia(f); e.currentTarget.value = ''; }} />
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-black">
                    <Plus size={13} /> {uploading ? '업로드 중…' : '미디어 추가'}
                  </span>
                </label>
              }>
              {media.length === 0 ? (
                <AdminEmpty icon={<ImageIcon size={22} />} title="미디어 없음" description="이미지 또는 동영상을 추가하면 플레이어에서 순차 재생됩니다." />
              ) : (
                <div className="space-y-2">
                  {media.map((m) => {
                    const isVideo = isVideoAsset(m.asset_type, m.mime_type);
                    return (
                    <div key={m.id} className="flex items-center gap-3 rounded-lg border border-line/20 bg-bg p-2">
                      <div className="relative h-12 w-16 shrink-0 overflow-hidden rounded bg-black">
                        {isVideo
                          ? <video src={m.image_url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                          : <img src={m.image_url} alt={m.title ?? ''} className="h-full w-full object-cover" />}
                        <span className={`absolute left-0.5 top-0.5 rounded px-1 text-[9px] font-bold leading-tight ${isVideo ? 'bg-violet-600 text-white' : 'bg-white/85 text-black'}`}>
                          {isVideo ? 'VIDEO' : 'IMAGE'}
                        </span>
                        {isVideo && m.media_duration_seconds != null && (
                          <span className="absolute bottom-0.5 right-0.5 rounded bg-black/70 px-1 text-[9px] font-semibold tabular-nums text-white">
                            {formatMediaDuration(m.media_duration_seconds)}
                          </span>
                        )}
                      </div>
                      <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
                        <input className={inputSm} defaultValue={m.title ?? ''} placeholder="제목" onBlur={(e) => { if (e.target.value !== (m.title ?? '')) void updateMedia(m.id, { title: e.target.value }); }} />
                        <input className={inputSm} type="number" min={1} max={600} defaultValue={m.display_duration_seconds}
                          title={isVideo ? '동영상은 영상 종료까지 재생(이 값 미사용)' : '노출 시간(초)'}
                          disabled={isVideo}
                          onBlur={(e) => { const v = Number(e.target.value); if (v && v !== m.display_duration_seconds) void updateMedia(m.id, { displayDurationSeconds: v }); }} />
                        <input className={inputSm} type="number" defaultValue={m.sort_order} title="순서" onBlur={(e) => { const v = Number(e.target.value); if (v !== m.sort_order) void updateMedia(m.id, { sortOrder: v }); }} />
                        <div className="flex items-center gap-1">
                          <AdminButton size="sm" variant="ghost" tone={m.status === 'active' ? 'neutral' : 'success'} onClick={() => void updateMedia(m.id, { status: m.status === 'active' ? 'inactive' : 'active' })}>{m.status === 'active' ? '숨김' : '표시'}</AdminButton>
                          <AdminButton size="sm" variant="ghost" tone="danger" onClick={() => void deleteMedia(m.id)}><Trash2 size={13} /></AdminButton>
                        </div>
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}

            </AdminCard>

            {/* 사이니지 표시 설정 + 매장 화면 미리보기 */}
            <AdminCard title="디지털 사이니지 표시 설정" subtitle="이미지 전환 효과/시간과 전체화면(매장 화면) 표시 옵션. 표시 옵션은 기본 꺼짐이며 켠 항목만 전체화면에 나타납니다.">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="전환 효과">
                  <select className={inputCls} value={sigEffect} onChange={(e) => setSigEffect(e.target.value as SignageTransitionEffect)}>
                    <option value="fade">부드러운 전환 (fade)</option>
                    <option value="none">전환 없음 (즉시)</option>
                  </select>
                </Field>
                <Field label={`전환 시간 (ms, ${MIN_TRANSITION_MS}~${MAX_TRANSITION_MS})`}>
                  <input className={inputCls} type="number" min={MIN_TRANSITION_MS} max={MAX_TRANSITION_MS} step={50}
                    value={sigDur} onChange={(e) => setSigDur(e.target.value)}
                    disabled={sigEffect === 'none'} title="이미지 전환 애니메이션 시간(이미지 유지 시간과 별개)" />
                </Field>
              </div>
              <p className="mt-1 text-[11px] text-ink-dim">전환 시간은 애니메이션 길이입니다 — 각 이미지의 노출(유지) 시간은 위 이미지 목록의 “노출 시간(초)”로 설정합니다.</p>

              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <ToggleChip label="브랜드명 표시" checked={sigBrandName} onChange={setSigBrandName} />
                <ToggleChip label="현재 곡 표시" checked={sigNowPlaying} onChange={setSigNowPlaying} />
                <ToggleChip label="시계 표시 (HH:mm)" checked={sigClock} onChange={setSigClock} />
                <ToggleChip label="슬라이드 진행표시" checked={sigDots} onChange={setSigDots} />
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <AdminButton tone="primary" size="sm" onClick={() => void saveSignage()} disabled={savingSignage}>
                  {savingSignage ? '저장 중…' : '표시 설정 저장'}
                </AdminButton>
                <AdminButton tone="neutral" variant="subtle" size="sm" leftIcon={<Monitor size={13} />} onClick={() => setShowPreview((v) => !v)}>
                  {showPreview ? '미리보기 닫기' : '매장 화면 미리보기'}
                </AdminButton>
              </div>

              {showPreview && (
                <div className="mt-3">
                  <p className="mb-1.5 text-[11px] font-semibold text-ink-dim">
                    매장 화면 미리보기 (전체화면과 동일한 렌더러 · 현재 설정 반영 · 음악/기록 없음)
                  </p>
                  {previewItems.length === 0 ? (
                    <AdminEmpty icon={<Monitor size={22} />} title="표시할 이미지 없음" description="활성 이미지를 추가하면 매장 화면을 미리 볼 수 있어요." />
                  ) : (
                    <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
                      <BrandSignage
                        items={previewItems}
                        brandName={detail.brand.name}
                        className="absolute inset-0 h-full w-full"
                        chromeHidden
                        transition={{ effect: sigEffect, durationMs: normalizeTransitionMs(sigDur) }}
                        showSlideDots={sigDots}
                      />
                      <BrandPresentationOverlays
                        show={{ brandName: sigBrandName, nowPlaying: sigNowPlaying, clock: sigClock }}
                        brandName={detail.brand.name}
                        nowPlaying={{ title: '재생 중인 곡 (미리보기)', artist: '아티스트' }}
                      />
                    </div>
                  )}
                </div>
              )}
            </AdminCard>
          </div>
        )}
    </AdminModal>
  );
}

// ── shared ───────────────────────────────────────────────────────────
const inputCls = 'w-full rounded-lg border border-line/25 bg-bg px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent/50';
const inputSm = 'w-full rounded border border-line/25 bg-bg px-2 py-1 text-xs text-ink outline-none focus:border-accent/50';
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (<label className="block space-y-1"><span className="text-[11px] font-semibold text-ink-mute">{label}</span>{children}</label>);
}
function ToggleChip({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-xs font-semibold transition-colors ${checked ? 'border-accent/50 bg-accent/10 text-ink' : 'border-line/25 bg-bg text-ink-mute'}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="truncate">{label}</span>
    </label>
  );
}
