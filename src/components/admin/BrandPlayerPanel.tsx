// Phase BRAND-1 — 관리자 "브랜드 플레이어" 패널.
// 브랜드 CRUD + 코드 발급/재발급 + 음악정책 + 이미지 사이니지 관리 + 미리보기.
// 서버 RPC(_is_super_admin) 가 최종 권한 판정. 이미지/삭제 실패 처리 포함.
import { useCallback, useEffect, useState } from 'react';
import { Plus, RefreshCw, KeyRound, Copy, Image as ImageIcon, Trash2, Power, Eye } from 'lucide-react';
import {
  AdminSection, AdminCard, AdminButton, AdminBadge, AdminAlert, AdminEmpty, AdminSkeleton, AdminModal, AdminStatCard,
} from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  adminListBrands, adminGetBrand, adminCreateBrand, adminUpdateBrand, adminSetBrandDeleted,
  adminRegenerateBrandCode, adminUpsertBrandMusicPolicy, adminAddBrandMedia, adminUpdateBrandMedia, adminDeleteBrandMedia,
} from '@/lib/api/brandPlayerApi';
import { uploadBrandMedia } from '@/lib/brandMediaUpload';
import BrandSignage from '@/components/brand/BrandSignage';
import type { BrandListItem, BrandDetail, BrandVocalPolicy } from '@/types/brand';

const VOCAL_LABELS: Record<BrandVocalPolicy, string> = {
  any: '제한 없음', vocal_ok: '보컬 허용', prefer_instrumental: '연주곡 선호', instrumental_only: '연주곡만',
};
const csv = (arr: string[] | null | undefined) => (arr ?? []).join(', ');
const parseCsv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

export default function BrandPlayerPanel() {
  const [rows, setRows] = useState<BrandListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [revealCode, setRevealCode] = useState<{ name: string; code: string } | null>(null);
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

  async function regenerate(b: BrandListItem) {
    if (!confirm(`${b.name} 브랜드 코드를 재발급할까요? 기존 코드와 접속 세션이 즉시 무효화됩니다.`)) return;
    setBusy(b.id);
    try {
      const r = await adminRegenerateBrandCode(b.id);
      setRevealCode({ name: b.name, code: r.code });
      await load();
    } catch (e) { toast.error(`재발급 실패: ${(e as Error).message}`); }
    finally { setBusy(null); }
  }

  async function remove(b: BrandListItem) {
    if (!confirm(`${b.name} 브랜드를 삭제할까요? (soft delete — 접속 불가 처리)`)) return;
    setBusy(b.id);
    try { await adminSetBrandDeleted(b.id, true); toast.success('삭제했어요'); await load(); }
    catch (e) { toast.error(`삭제 실패: ${(e as Error).message}`); }
    finally { setBusy(null); }
  }

  return (
    <AdminSection
      title="브랜드 플레이어"
      description="프랜차이즈/브랜드 전용 음악 + 이미지 사이니지 플레이어. 브랜드 생성 시 발급되는 코드를 매장에 전달하세요."
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
        <AdminStatCard label="비활성" value={String(rows.filter((r) => r.status !== 'active').length)} tone="neutral" />
        <AdminStatCard label="이미지 등록 브랜드" value={String(rows.filter((r) => (r.active_media_count ?? 0) > 0).length)} tone="info" />
      </div>

      {loading ? (
        <AdminSkeleton variant="card" />
      ) : err ? (
        <AdminAlert tone="danger" title="조회 실패" description={err} />
      ) : rows.length === 0 ? (
        <AdminEmpty icon={<ImageIcon size={26} />} title="등록된 브랜드가 없어요" description="새 브랜드를 생성하면 접속 코드가 발급됩니다." action={<AdminButton tone="primary" size="sm" leftIcon={<Plus size={14} />} onClick={() => setCreating(true)}>새 브랜드</AdminButton>} />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((b) => (
            <AdminCard key={b.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-ink">{b.name}</p>
                  <p className="mt-0.5 text-[11px] text-ink-mute">{b.industry_type || '업종 미지정'} · 코드 {b.code_hint || '—'}</p>
                </div>
                <AdminBadge tone={b.status === 'active' ? 'success' : 'neutral'}>{b.status === 'active' ? '활성' : '비활성'}</AdminBadge>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-ink-dim">
                <span className="rounded bg-bg-hover px-1.5 py-0.5">이미지 {b.active_media_count ?? 0}</span>
                <span className="rounded bg-bg-hover px-1.5 py-0.5">선호장르 {b.preferred_genre_count ?? 0}</span>
                <span className="rounded bg-bg-hover px-1.5 py-0.5">차단장르 {b.blocked_genre_count ?? 0}</span>
                {b.last_seen_at && <span className="rounded bg-bg-hover px-1.5 py-0.5">최근접속 {new Date(b.last_seen_at).toLocaleDateString('ko-KR')}</span>}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <AdminButton size="sm" variant="subtle" tone="primary" leftIcon={<Eye size={13} />} onClick={() => setDetailId(b.id)}>상세/편집</AdminButton>
                <AdminButton size="sm" variant="subtle" tone="warning" leftIcon={<KeyRound size={13} />} disabled={busy === b.id} onClick={() => void regenerate(b)}>코드 재발급</AdminButton>
                <AdminButton size="sm" variant="ghost" tone="neutral" leftIcon={<Power size={13} />} disabled={busy === b.id} onClick={() => void toggleStatus(b)}>{b.status === 'active' ? '비활성화' : '활성화'}</AdminButton>
                <AdminButton size="sm" variant="ghost" tone="danger" leftIcon={<Trash2 size={13} />} disabled={busy === b.id} onClick={() => void remove(b)}>삭제</AdminButton>
              </div>
            </AdminCard>
          ))}
        </div>
      )}

      {creating && (
        <CreateBrandModal
          onClose={() => setCreating(false)}
          onCreated={(name, code) => { setCreating(false); setRevealCode({ name, code }); void load(); }}
        />
      )}
      {detailId && (
        <BrandDetailModal brandId={detailId} onClose={() => setDetailId(null)} onChanged={() => void load()} />
      )}
      {revealCode && (
        <CodeRevealModal name={revealCode.name} code={revealCode.code} onClose={() => setRevealCode(null)} />
      )}
    </AdminSection>
  );
}

// ── 코드 노출 (1회) ──────────────────────────────────────────────────
function CodeRevealModal({ name, code, onClose }: { name: string; code: string; onClose: () => void }) {
  return (
    <AdminModal open onClose={onClose} title="브랜드 접속 코드" size="sm"
      footer={<AdminButton tone="primary" onClick={onClose}>확인</AdminButton>}>
      <div className="space-y-3 text-center">
        <p className="text-sm text-ink-mute">{name}</p>
        <div className="flex items-center justify-center gap-2 rounded-xl border border-line/30 bg-bg-hover px-4 py-4">
          <span className="text-2xl font-extrabold tracking-[0.2em] text-ink">{code}</span>
          <AdminButton size="sm" variant="subtle" tone="neutral" leftIcon={<Copy size={13} />}
            onClick={() => { void navigator.clipboard?.writeText(code); toast.success('복사했어요'); }}>복사</AdminButton>
        </div>
        <AdminAlert tone="warning" description="이 코드는 지금만 표시됩니다. 매장에 전달 후 안전하게 보관하세요. 분실 시 재발급이 필요합니다." />
      </div>
    </AdminModal>
  );
}

// ── 생성 ─────────────────────────────────────────────────────────────
function CreateBrandModal({ onClose, onCreated }: { onClose: () => void; onCreated: (name: string, code: string) => void }) {
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [desc, setDesc] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!name.trim()) { toast.error('브랜드명을 입력해주세요'); return; }
    setSaving(true);
    try {
      const r = await adminCreateBrand({ name: name.trim(), industryType: industry.trim() || null, description: desc.trim() || null });
      onCreated(name.trim(), r.code);
    } catch (e) { toast.error(`생성 실패: ${(e as Error).message}`); }
    finally { setSaving(false); }
  }

  return (
    <AdminModal open onClose={onClose} title="새 브랜드" size="md"
      footer={<><AdminButton tone="neutral" variant="subtle" onClick={onClose}>취소</AdminButton><AdminButton tone="primary" onClick={() => void submit()} disabled={saving}>{saving ? '생성 중…' : '생성'}</AdminButton></>}>
      <div className="space-y-3">
        <Field label="브랜드명 *"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 카페 드득" maxLength={80} /></Field>
        <Field label="업종"><input className={inputCls} value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="예: 카페 / 와인바 / 병원" maxLength={50} /></Field>
        <Field label="설명"><textarea className={inputCls} value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} maxLength={300} /></Field>
        <p className="text-[11px] text-ink-dim">생성 시 접속 코드가 자동 발급되며 1회만 표시됩니다.</p>
      </div>
    </AdminModal>
  );
}

// ── 상세/편집 (brand + policy + media) ───────────────────────────────
function BrandDetailModal({ brandId, onClose, onChanged }: { brandId: string; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<BrandDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [uploading, setUploading] = useState(false);

  // policy form
  const [pref, setPref] = useState(''); const [block, setBlock] = useState('');
  const [prefM, setPrefM] = useState(''); const [blockM, setBlockM] = useState('');
  const [eMin, setEMin] = useState(''); const [eMax, setEMax] = useState('');
  const [vocal, setVocal] = useState<BrandVocalPolicy>('any');
  const [autoGen, setAutoGen] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const d = await adminGetBrand(brandId);
      setDetail(d);
      const p = d.policy;
      setPref(csv(p?.preferred_genres)); setBlock(csv(p?.blocked_genres));
      setPrefM(csv(p?.preferred_moods)); setBlockM(csv(p?.blocked_moods));
      setEMin(p?.energy_min != null ? String(p.energy_min) : ''); setEMax(p?.energy_max != null ? String(p.energy_max) : '');
      setVocal((p?.vocal_policy as BrandVocalPolicy) ?? 'any');
      setAutoGen(p?.auto_generate_enabled ?? true);
    } catch (e) { setErr(e instanceof Error ? e.message : '조회 실패'); }
    finally { setLoading(false); }
  }, [brandId]);
  useEffect(() => { void reload(); }, [reload]);

  async function savePolicy() {
    setSavingPolicy(true);
    try {
      await adminUpsertBrandMusicPolicy({
        brandId,
        preferredGenres: parseCsv(pref), blockedGenres: parseCsv(block),
        preferredMoods: parseCsv(prefM), blockedMoods: parseCsv(blockM),
        energyMin: eMin.trim() === '' ? null : Number(eMin),
        energyMax: eMax.trim() === '' ? null : Number(eMax),
        vocalPolicy: vocal, autoGenerateEnabled: autoGen,
      });
      toast.success('음악 정책을 저장했어요'); onChanged();
    } catch (e) { toast.error(`저장 실패: ${(e as Error).message}`); }
    finally { setSavingPolicy(false); }
  }

  async function onPickImage(file: File) {
    setUploading(true);
    try {
      const up = await uploadBrandMedia(brandId, file);
      if (!up.ok || !up.url) { toast.error(up.error || '업로드 실패'); return; }
      await adminAddBrandMedia({ brandId, imageUrl: up.url, displayDurationSeconds: 10 });
      toast.success('이미지를 추가했어요'); await reload(); onChanged();
    } catch (e) { toast.error(`이미지 추가 실패: ${(e as Error).message}`); }
    finally { setUploading(false); }
  }

  async function updateMedia(assetId: string, patch: { title?: string; displayDurationSeconds?: number; sortOrder?: number; status?: 'active' | 'inactive' }) {
    try { await adminUpdateBrandMedia({ assetId, ...patch }); await reload(); onChanged(); }
    catch (e) { toast.error(`수정 실패: ${(e as Error).message}`); }
  }
  async function deleteMedia(assetId: string) {
    if (!confirm('이 이미지를 삭제할까요?')) return;
    try { await adminDeleteBrandMedia(assetId); toast.success('삭제했어요'); await reload(); onChanged(); }
    catch (e) { toast.error(`삭제 실패: ${(e as Error).message}`); }
  }

  const media = detail?.media ?? [];
  const previewItems = media.filter((m) => (m.status ?? 'active') === 'active')
    .map((m) => ({ id: m.id, title: m.title, image_url: m.image_url, display_duration_seconds: m.display_duration_seconds }));

  return (
    <AdminModal open onClose={onClose} title={detail?.brand.name ?? '브랜드 상세'} size="xl"
      footer={<AdminButton tone="neutral" variant="subtle" onClick={onClose}>닫기</AdminButton>}>
      {loading ? <AdminSkeleton variant="block" rows={6} />
        : err ? <AdminAlert tone="danger" title="조회 실패" description={err} />
        : detail && (
          <div className="space-y-5">
            {/* 음악 정책 */}
            <AdminCard title="음악 정책" subtitle="차단 장르/무드는 강하게 제외, 선호는 가중치. 곡 부족 시 안전 fallback.">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="선호 장르 (쉼표)"><input className={inputCls} value={pref} onChange={(e) => setPref(e.target.value)} placeholder="pop, jazz, lofi" /></Field>
                <Field label="차단 장르 (쉼표)"><input className={inputCls} value={block} onChange={(e) => setBlock(e.target.value)} placeholder="edm, metal, trap" /></Field>
                <Field label="선호 무드 (쉼표)"><input className={inputCls} value={prefM} onChange={(e) => setPrefM(e.target.value)} placeholder="calm, warm" /></Field>
                <Field label="차단 무드 (쉼표)"><input className={inputCls} value={blockM} onChange={(e) => setBlockM(e.target.value)} placeholder="energetic" /></Field>
                <Field label="에너지 최소 (0~1)"><input className={inputCls} value={eMin} onChange={(e) => setEMin(e.target.value)} placeholder="0.2" inputMode="decimal" /></Field>
                <Field label="에너지 최대 (0~1)"><input className={inputCls} value={eMax} onChange={(e) => setEMax(e.target.value)} placeholder="0.8" inputMode="decimal" /></Field>
                <Field label="보컬 정책">
                  <select className={inputCls} value={vocal} onChange={(e) => setVocal(e.target.value as BrandVocalPolicy)}>
                    {(Object.keys(VOCAL_LABELS) as BrandVocalPolicy[]).map((k) => <option key={k} value={k}>{VOCAL_LABELS[k]}</option>)}
                  </select>
                </Field>
                <Field label="자동 플리 생성">
                  <label className="flex items-center gap-2 py-2 text-sm text-ink-mute">
                    <input type="checkbox" checked={autoGen} onChange={(e) => setAutoGen(e.target.checked)} /> 사용
                  </label>
                </Field>
              </div>
              <div className="mt-3"><AdminButton tone="primary" size="sm" onClick={() => void savePolicy()} disabled={savingPolicy}>{savingPolicy ? '저장 중…' : '정책 저장'}</AdminButton></div>
            </AdminCard>

            {/* 이미지 사이니지 */}
            <AdminCard title="이미지 사이니지" subtitle="순서대로 노출 시간(초)만큼 표시 후 반복. jpg/png/webp, 10MB 이하."
              action={
                <label className="cursor-pointer">
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={uploading}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPickImage(f); e.currentTarget.value = ''; }} />
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-black">
                    <Plus size={13} /> {uploading ? '업로드 중…' : '이미지 추가'}
                  </span>
                </label>
              }>
              {media.length === 0 ? (
                <AdminEmpty icon={<ImageIcon size={22} />} title="이미지 없음" description="이미지를 추가하면 플레이어에서 순차 노출됩니다." />
              ) : (
                <div className="space-y-2">
                  {media.map((m) => (
                    <div key={m.id} className="flex items-center gap-3 rounded-lg border border-line/20 bg-bg p-2">
                      <img src={m.image_url} alt={m.title ?? ''} className="h-12 w-16 shrink-0 rounded object-cover" />
                      <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
                        <input className={inputSm} defaultValue={m.title ?? ''} placeholder="제목" onBlur={(e) => { if (e.target.value !== (m.title ?? '')) void updateMedia(m.id, { title: e.target.value }); }} />
                        <input className={inputSm} type="number" min={1} max={600} defaultValue={m.display_duration_seconds} title="노출 시간(초)" onBlur={(e) => { const v = Number(e.target.value); if (v && v !== m.display_duration_seconds) void updateMedia(m.id, { displayDurationSeconds: v }); }} />
                        <input className={inputSm} type="number" defaultValue={m.sort_order} title="순서" onBlur={(e) => { const v = Number(e.target.value); if (v !== m.sort_order) void updateMedia(m.id, { sortOrder: v }); }} />
                        <div className="flex items-center gap-1">
                          <AdminButton size="sm" variant="ghost" tone={m.status === 'active' ? 'neutral' : 'success'} onClick={() => void updateMedia(m.id, { status: m.status === 'active' ? 'inactive' : 'active' })}>{m.status === 'active' ? '숨김' : '표시'}</AdminButton>
                          <AdminButton size="sm" variant="ghost" tone="danger" onClick={() => void deleteMedia(m.id)}><Trash2 size={13} /></AdminButton>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 미리보기 */}
              {previewItems.length > 0 && (
                <div className="mt-3">
                  <p className="mb-1.5 text-[11px] font-semibold text-ink-dim">플레이어 미리보기</p>
                  <BrandSignage items={previewItems} brandName={detail.brand.name} className="h-48 w-full rounded-lg" />
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
