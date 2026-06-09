import { useCallback, useEffect, useMemo, useState } from 'react';
import { Sparkles, Plus, Pencil, ToggleLeft, ToggleRight, Trash2, X, Check } from 'lucide-react';
import {
  TAXONOMY_KIND_LABEL,
  type TaxonomyItem,
  type TaxonomyKind,
  deleteTaxonomy,
  listAdminTaxonomy,
  toggleTaxonomy,
  upsertTaxonomy,
} from '@/lib/taxonomyApi';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';

/**
 * Phase X1.0 — DEUDDA DSP 분류 체계 관리.
 * 4 카테고리(장르/무드/매장 유형/시간대)를 admin 이 추가/수정/숨김/삭제.
 * slug 는 DB 와 Modal CLAP 분류 프롬프트의 공통 식별자 → 변경 시 추론 결과와 정합성 확인 필요.
 */

const KINDS: TaxonomyKind[] = ['genre', 'mood', 'store_type', 'daypart'];

interface EditDraft {
  mode: 'create' | 'edit';
  slug: string;
  name_ko: string;
  name_en: string;
  description: string;
  is_active: boolean;
  sort_order: number;
  originalSlug?: string;
}

export default function TaxonomyManagerPanel() {
  const [kind, setKind] = useState<TaxonomyKind>('genre');
  const [items, setItems] = useState<TaxonomyItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listAdminTaxonomy(kind);
      setItems(data);
    } catch (err) {
      toast.error(friendlyError(err, '분류 목록 조회 실패'));
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => { void refresh(); }, [refresh]);

  const counts = useMemo(() => ({
    total: items.length,
    active: items.filter((i) => i.is_active).length,
    inactive: items.filter((i) => !i.is_active).length,
  }), [items]);

  function startCreate() {
    const nextOrder = items.length > 0 ? Math.max(...items.map((i) => i.sort_order)) + 10 : 10;
    setDraft({
      mode: 'create',
      slug: '',
      name_ko: '',
      name_en: '',
      description: '',
      is_active: true,
      sort_order: nextOrder,
    });
  }

  function startEdit(item: TaxonomyItem) {
    setDraft({
      mode: 'edit',
      slug: item.slug,
      originalSlug: item.slug,
      name_ko: item.name_ko,
      name_en: item.name_en,
      description: item.description ?? '',
      is_active: item.is_active,
      sort_order: item.sort_order,
    });
  }

  async function onSave() {
    if (!draft) return;
    const slug = draft.slug.trim().toLowerCase();
    if (!slug) { toast.error('slug 를 입력해주세요'); return; }
    if (!/^[a-z0-9_]+$/.test(slug)) { toast.error('slug 는 소문자/숫자/언더스코어만 허용'); return; }
    if (!draft.name_ko.trim() || !draft.name_en.trim()) { toast.error('한글명 / 영문명 필수'); return; }
    setSaving(true);
    try {
      // edit 모드에서 slug 가 바뀌었으면 기존 행 삭제 후 새로 upsert (slug 가 sole identifier)
      if (draft.mode === 'edit' && draft.originalSlug && draft.originalSlug !== slug) {
        await deleteTaxonomy(kind, draft.originalSlug);
      }
      await upsertTaxonomy({
        kind,
        slug,
        name_ko: draft.name_ko,
        name_en: draft.name_en,
        description: draft.description.trim() || null,
        is_active: draft.is_active,
        sort_order: draft.sort_order,
      });
      toast.success(draft.mode === 'create' ? '항목을 추가했어요.' : '항목을 수정했어요.');
      setDraft(null);
      await refresh();
    } catch (err) {
      toast.error(friendlyError(err, '저장 실패'));
    } finally {
      setSaving(false);
    }
  }

  async function onToggle(item: TaxonomyItem) {
    try {
      await toggleTaxonomy(kind, item.slug, !item.is_active);
      toast.success(item.is_active ? '비활성화했어요.' : '활성화했어요.');
      await refresh();
    } catch (err) {
      toast.error(friendlyError(err, '상태 변경 실패'));
    }
  }

  async function onDelete(item: TaxonomyItem) {
    if (!confirm(`'${item.name_ko}' 항목을 삭제할까요?\n\n관련 AI 예측 결과(track_ai_predictions) 의 slug 는 그대로 남으며, 단지 본 목록에서만 사라집니다.`)) return;
    try {
      await deleteTaxonomy(kind, item.slug);
      toast.success('삭제했어요.');
      await refresh();
    } catch (err) {
      toast.error(friendlyError(err, '삭제 실패'));
    }
  }

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h2 className="flex items-center gap-1.5 text-lg font-bold tracking-tight">
          <Sparkles size={16} className="text-accent" /> AI 분류 체계
        </h2>
        <p className="text-xs text-ink-mute">
          AI 메타 추론 엔진이 트랙에 매기는 4 카테고리(장르 / 무드 / 매장 유형 / 시간대) 의 공통 분류 정의.
          slug 는 Modal CLAP 분류 프롬프트의 공통 식별자라 신중하게 다뤄주세요.
        </p>
      </header>

      {/* Kind 탭 */}
      <div className="flex flex-wrap items-center gap-2">
        {KINDS.map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={
              'rounded-full px-4 py-1.5 text-xs font-semibold transition ' +
              (kind === k
                ? 'bg-accent text-white'
                : 'bg-bg-soft text-ink-mute ring-1 ring-line/10 hover:text-ink')
            }
          >
            {TAXONOMY_KIND_LABEL[k]}
          </button>
        ))}
      </div>

      {/* 통계 + 추가 버튼 */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-bg-card p-3 ring-1 ring-line/10">
        <Stat label="전체" value={counts.total} />
        <Stat label="활성" value={counts.active} tone="success" />
        <Stat label="비활성" value={counts.inactive} tone="warn" />
        <div className="ml-auto">
          <button
            onClick={startCreate}
            className="inline-flex items-center gap-1 rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-accent-soft"
          >
            <Plus size={14} /> 새 항목 추가
          </button>
        </div>
      </div>

      {/* 편집 폼 */}
      {draft && (
        <DraftForm
          kind={kind}
          draft={draft}
          saving={saving}
          onChange={setDraft}
          onCancel={() => setDraft(null)}
          onSave={onSave}
        />
      )}

      {/* 목록 */}
      <div className="overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-bg-soft text-left font-mono text-[10px] uppercase tracking-[0.12em] text-ink-dim">
              <th className="px-3 py-2 w-16">순서</th>
              <th className="px-3 py-2 w-40">slug</th>
              <th className="px-3 py-2">이름 (KO / EN)</th>
              <th className="px-3 py-2">설명</th>
              <th className="px-3 py-2 w-20 text-center">상태</th>
              <th className="px-3 py-2 w-32 text-right">관리</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-10 text-center text-ink-mute">불러오는 중…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-10 text-center text-ink-mute">항목이 없습니다.</td></tr>
            ) : (
              items.map((item) => (
                <tr key={item.id} className="border-t border-line/10">
                  <td className="px-3 py-2 font-mono text-[11px] text-ink-dim">{item.sort_order}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-ink">{item.slug}</td>
                  <td className="px-3 py-2">
                    <div className="font-semibold">{item.name_ko}</div>
                    <div className="text-[11px] text-ink-mute">{item.name_en}</div>
                  </td>
                  <td className="px-3 py-2 text-[11px] text-ink-mute">{item.description ?? '—'}</td>
                  <td className="px-3 py-2 text-center">
                    {item.is_active ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-400">활성</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-400">숨김</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <IconButton title="수정" onClick={() => startEdit(item)}>
                        <Pencil size={14} />
                      </IconButton>
                      <IconButton title={item.is_active ? '비활성화' : '활성화'} onClick={() => void onToggle(item)}>
                        {item.is_active ? <ToggleRight size={16} className="text-emerald-400" /> : <ToggleLeft size={16} className="text-amber-400" />}
                      </IconButton>
                      <IconButton title="삭제" onClick={() => void onDelete(item)}>
                        <Trash2 size={14} className="text-rose-400" />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] leading-relaxed text-ink-dim">
        • slug 변경은 곧 새 행을 만드는 것과 같습니다 (기존 행은 삭제). 이미 추론된 트랙 결과는 옛 slug 그대로 남기 때문에 주의해주세요.<br />
        • 비활성화(숨김) 항목은 공개 list_taxonomy_* RPC 에서 빠지지만, 기존 트랙 예측 데이터는 보존됩니다.<br />
        • Phase X1.1 (CLAP zero-shot 추론) 가동 시점에 활성 항목만 분류 후보로 사용됩니다.
      </p>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'success' | 'warn' }) {
  const toneClass =
    tone === 'success' ? 'text-emerald-400'
    : tone === 'warn' ? 'text-amber-400'
    : 'text-ink';
  return (
    <div className="flex items-baseline gap-1.5 rounded-full bg-bg-soft px-3 py-1 ring-1 ring-line/10">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-dim">{label}</span>
      <span className={`text-sm font-bold ${toneClass}`}>{value}</span>
    </div>
  );
}

function IconButton({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: () => void }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-bg-soft text-ink-mute ring-1 ring-line/10 transition hover:text-ink"
    >
      {children}
    </button>
  );
}

function DraftForm({
  kind, draft, saving, onChange, onCancel, onSave,
}: {
  kind: TaxonomyKind;
  draft: EditDraft;
  saving: boolean;
  onChange: (d: EditDraft) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const isCreate = draft.mode === 'create';
  return (
    <div className="space-y-3 rounded-2xl border border-accent/30 bg-bg-card p-4 ring-1 ring-accent/30">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold">
          {isCreate ? '새 항목 추가' : '항목 수정'} · {TAXONOMY_KIND_LABEL[kind]}
        </h3>
        <button onClick={onCancel} className="text-ink-mute hover:text-ink"><X size={16} /></button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="slug (영문 식별자) *">
          <input
            value={draft.slug}
            onChange={(e) => onChange({ ...draft, slug: e.target.value })}
            placeholder="예: cafe / kpop / chill"
            className="w-full rounded-lg bg-bg-soft px-3 py-2 font-mono text-sm ring-1 ring-line/10 focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </Field>
        <Field label="정렬 순서">
          <input
            type="number"
            value={draft.sort_order}
            onChange={(e) => onChange({ ...draft, sort_order: parseInt(e.target.value || '0', 10) })}
            className="w-full rounded-lg bg-bg-soft px-3 py-2 text-sm ring-1 ring-line/10 focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </Field>
        <Field label="이름 (한국어) *">
          <input
            value={draft.name_ko}
            onChange={(e) => onChange({ ...draft, name_ko: e.target.value })}
            placeholder="예: 카페"
            className="w-full rounded-lg bg-bg-soft px-3 py-2 text-sm ring-1 ring-line/10 focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </Field>
        <Field label="이름 (영문) *">
          <input
            value={draft.name_en}
            onChange={(e) => onChange({ ...draft, name_en: e.target.value })}
            placeholder="예: Cafe"
            className="w-full rounded-lg bg-bg-soft px-3 py-2 text-sm ring-1 ring-line/10 focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </Field>
      </div>

      <Field label="설명">
        <textarea
          value={draft.description}
          onChange={(e) => onChange({ ...draft, description: e.target.value })}
          rows={2}
          placeholder="이 카테고리에 대한 짧은 설명"
          className="w-full rounded-lg bg-bg-soft px-3 py-2 text-sm ring-1 ring-line/10 focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </Field>

      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={draft.is_active}
          onChange={(e) => onChange({ ...draft, is_active: e.target.checked })}
          className="h-4 w-4 accent-accent"
        />
        활성 (공개 list 에 노출 + AI 분류 후보로 사용)
      </label>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          onClick={onSave}
          disabled={saving}
          className="inline-flex items-center gap-1 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-soft disabled:opacity-50"
        >
          <Check size={14} /> {saving ? '저장 중…' : isCreate ? '추가' : '저장'}
        </button>
        <button
          onClick={onCancel}
          className="inline-flex items-center gap-1 rounded-full bg-bg-soft px-4 py-2 text-sm font-semibold text-ink-mute ring-1 ring-line/10 transition hover:text-ink"
        >
          취소
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-dim">{label}</span>
      {children}
    </label>
  );
}
