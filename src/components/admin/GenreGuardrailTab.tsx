import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Plus, Trash2, Shield, Ban, AlertTriangle, Sparkles, Power } from 'lucide-react';
import {
  adminListGenreGuardrails,
  adminGenreGuardrailSummary,
  adminUpsertGenreGuardrail,
  adminToggleGenreGuardrail,
  adminDeleteGenreGuardrail,
  listTaxonomyStoreTypes,
  type GenreGuardrailRow,
  type GenreGuardrailSummary,
  type GenreGuardrailRuleType,
  type StoreTypeOption,
} from '@/lib/aiCuration';
import { toast } from '@/store/toastStore';

const RULE_LABELS: Record<GenreGuardrailRuleType, { label: string; tone: string; icon: typeof Shield }> = {
  hard_block:   { label: 'HARD BLOCK',   tone: 'bg-rose-500/20 text-rose-500',       icon: Ban },
  soft_penalty: { label: 'SOFT PENALTY', tone: 'bg-amber-500/20 text-amber-500',     icon: AlertTriangle },
  bonus:        { label: 'BONUS',        tone: 'bg-emerald-500/20 text-emerald-500', icon: Sparkles },
};

const RULE_DEFAULT_DELTA: Record<GenreGuardrailRuleType, number> = {
  hard_block: 0, soft_penalty: -20, bonus: 10,
};

interface EditForm {
  id: string | null;
  genre_pattern: string;
  store_slug: string;
  rule_type: GenreGuardrailRuleType;
  score_delta: number;
  description: string;
}

const EMPTY_FORM: EditForm = {
  id: null, genre_pattern: '', store_slug: '', rule_type: 'hard_block',
  score_delta: 0, description: '',
};

export default function GenreGuardrailTab() {
  const [rows, setRows] = useState<GenreGuardrailRow[]>([]);
  const [summary, setSummary] = useState<GenreGuardrailSummary | null>(null);
  const [storeTypes, setStoreTypes] = useState<StoreTypeOption[]>([]);
  const [storeFilter, setStoreFilter] = useState<string>('');
  const [ruleFilter, setRuleFilter] = useState<GenreGuardrailRuleType | ''>('');
  const [loading, setLoading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<EditForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, sum] = await Promise.all([
        adminListGenreGuardrails(storeFilter || null),
        adminGenreGuardrailSummary(),
      ]);
      setRows(list);
      setSummary(sum);
    } catch (e) {
      toast.error(`로딩 실패: ${(e as Error).message}`);
    } finally { setLoading(false); }
  }, [storeFilter]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    listTaxonomyStoreTypes().then(setStoreTypes).catch((e) => toast.error(`store 로딩 실패: ${e.message}`));
  }, []);

  const filteredRows = useMemo(() => {
    if (!ruleFilter) return rows;
    return rows.filter((r) => r.rule_type === ruleFilter);
  }, [rows, ruleFilter]);

  const openCreate = () => {
    setForm({ ...EMPTY_FORM, store_slug: storeFilter || '' });
    setEditOpen(true);
  };

  const openEdit = (r: GenreGuardrailRow) => {
    setForm({
      id: r.id,
      genre_pattern: r.genre_pattern,
      store_slug: r.store_slug,
      rule_type: r.rule_type,
      score_delta: Number(r.score_delta),
      description: r.description ?? '',
    });
    setEditOpen(true);
  };

  const submit = async () => {
    if (!form.genre_pattern.trim() || !form.store_slug.trim()) {
      toast.error('genre_pattern 과 store_slug 는 필수입니다');
      return;
    }
    setSaving(true);
    try {
      await adminUpsertGenreGuardrail({
        id: form.id,
        genre_pattern: form.genre_pattern.trim(),
        store_slug: form.store_slug.trim(),
        rule_type: form.rule_type,
        score_delta: form.score_delta,
        description: form.description.trim() || null,
      });
      toast.success(form.id ? '수정 완료' : '추가 완료');
      setEditOpen(false);
      await load();
    } catch (e) {
      toast.error(`저장 실패: ${(e as Error).message}`);
    } finally { setSaving(false); }
  };

  const toggle = async (r: GenreGuardrailRow) => {
    try {
      const next = await adminToggleGenreGuardrail(r.id);
      toast.success(next ? '활성화' : '비활성화');
      await load();
    } catch (e) {
      toast.error(`토글 실패: ${(e as Error).message}`);
    }
  };

  const remove = async (r: GenreGuardrailRow) => {
    if (!confirm(`정말 삭제하시겠습니까?\n\n${r.genre_pattern} × ${r.store_slug} (${r.rule_type})`)) return;
    try {
      await adminDeleteGenreGuardrail(r.id);
      toast.success('삭제 완료');
      await load();
    } catch (e) {
      toast.error(`삭제 실패: ${(e as Error).message}`);
    }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-1 text-sm font-bold">
            <Shield size={14} /> 장르 × 매장 Guardrail (X5.0)
          </h3>
          <div className="flex items-center gap-2 text-xs">
            <button onClick={() => void load()} disabled={loading}
              className="inline-flex items-center gap-1 rounded bg-bg-deep px-2 py-1 hover:bg-bg-hover disabled:opacity-50">
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> 새로고침
            </button>
            <button onClick={openCreate}
              className="inline-flex items-center gap-1 rounded bg-accent px-2 py-1 font-bold text-black">
              <Plus size={11} /> 규칙 추가
            </button>
          </div>
        </div>
        <p className="mt-1 text-[11px] text-ink-dim">
          장르 패턴 (substring) × 매장 slug 매칭. <b>hard_block</b> = fit_score 0 강제, <b>soft_penalty</b> = 감산, <b>bonus</b> = 가산.
          매칭은 tracks.main_genre, sub_genre, genre_tags[] 모두 lowercase substring 으로 검사.
        </p>
      </div>

      {summary && (
        <div className="rounded-xl bg-bg-card p-3">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span><b>총</b> {summary.total} 규칙</span>
            <span className="text-ink-mute">·</span>
            <span><b>활성</b> {summary.active}</span>
            <span className="text-ink-mute">·</span>
            {(Object.entries(summary.by_rule_type ?? {}) as [GenreGuardrailRuleType, number][]).map(([rt, n]) => {
              const cfg = RULE_LABELS[rt];
              return (
                <span key={rt} className={`rounded px-1.5 py-0.5 font-bold ${cfg.tone}`}>
                  {cfg.label} {n}
                </span>
              );
            })}
          </div>
          {summary.by_store && Object.keys(summary.by_store).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
              <span className="text-ink-mute">매장:</span>
              {Object.entries(summary.by_store)
                .sort((a, b) => b[1] - a[1])
                .map(([slug, n]) => (
                  <button key={slug} onClick={() => setStoreFilter(storeFilter === slug ? '' : slug)}
                    className={`rounded px-1.5 py-0.5 ${storeFilter === slug ? 'bg-accent/20 ring-1 ring-accent' : 'bg-bg-deep hover:bg-bg-hover'}`}>
                    {slug} <b>{n}</b>
                  </button>
                ))}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-bg-card p-3 text-xs">
        <span className="font-bold">매장:</span>
        <select value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)}
          className="rounded bg-bg-deep px-2 py-1">
          <option value="">전체</option>
          {storeTypes.map((s) => <option key={s.slug} value={s.slug}>{s.name_ko} ({s.slug})</option>)}
        </select>
        <span className="font-bold">규칙:</span>
        <select value={ruleFilter} onChange={(e) => setRuleFilter(e.target.value as GenreGuardrailRuleType | '')}
          className="rounded bg-bg-deep px-2 py-1">
          <option value="">전체</option>
          <option value="hard_block">hard_block</option>
          <option value="soft_penalty">soft_penalty</option>
          <option value="bonus">bonus</option>
        </select>
        <span className="text-ink-dim">{filteredRows.length} 행</span>
      </div>

      {filteredRows.length === 0 ? (
        <p className="rounded-xl bg-bg-card px-4 py-8 text-center text-sm text-ink-dim">
          {loading ? '로딩 중…' : '규칙 없음. "규칙 추가" 로 생성하세요.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-bg-card">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line/10 text-[11px] uppercase text-ink-dim">
                <th className="px-2 py-2">규칙</th>
                <th className="px-2 py-2">장르 패턴</th>
                <th className="px-2 py-2">매장</th>
                <th className="px-2 py-2 text-right">delta</th>
                <th className="px-2 py-2">설명</th>
                <th className="px-2 py-2">생성</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => {
                const cfg = RULE_LABELS[r.rule_type];
                const Icon = cfg.icon;
                return (
                  <tr key={r.id} className={`border-b border-line/10 ${!r.is_active ? 'opacity-40' : ''}`}>
                    <td className="px-2 py-1.5">
                      <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold ${cfg.tone}`}>
                        <Icon size={10} /> {cfg.label}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 font-bold">{r.genre_pattern}</td>
                    <td className="px-2 py-1.5">
                      <div className="font-semibold">{r.store_slug}</div>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {r.score_delta > 0 ? `+${r.score_delta}` : r.score_delta}
                    </td>
                    <td className="px-2 py-1.5 text-ink-dim">{r.description ?? '—'}</td>
                    <td className="px-2 py-1.5 text-ink-dim text-[10px]">
                      {r.created_by_name ?? 'system'}
                      <br />{new Date(r.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex gap-1">
                        <button onClick={() => openEdit(r)}
                          className="rounded bg-bg-deep px-2 py-1 text-[10px] hover:bg-bg-hover">
                          수정
                        </button>
                        <button onClick={() => void toggle(r)}
                          title={r.is_active ? '비활성화' : '활성화'}
                          className="rounded bg-bg-deep px-2 py-1 hover:bg-bg-hover">
                          <Power size={10} className={r.is_active ? 'text-emerald-500' : 'text-ink-dim'} />
                        </button>
                        <button onClick={() => void remove(r)}
                          className="rounded bg-rose-500/15 px-2 py-1 text-rose-500 hover:bg-rose-500/25">
                          <Trash2 size={10} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="rounded bg-bg-card px-3 py-2 text-[11px] text-ink-dim">
        ⚠️ hard_block 규칙은 fit_score = 0, status = excluded 강제. soft_penalty / bonus 는 fit_score 가감.
        규칙 변경 후 재배치는 "전체 재검수" 또는 "자동 재배치" 탭에서 실행.
      </p>

      {editOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-bg-deep p-4 shadow-2xl">
            <h3 className="mb-3 text-sm font-bold">{form.id ? '규칙 수정' : '규칙 추가'}</h3>
            <div className="space-y-2 text-xs">
              <label className="block">
                <span className="font-semibold">규칙 유형</span>
                <select value={form.rule_type}
                  onChange={(e) => {
                    const rt = e.target.value as GenreGuardrailRuleType;
                    setForm((f) => ({ ...f, rule_type: rt, score_delta: form.id ? f.score_delta : RULE_DEFAULT_DELTA[rt] }));
                  }}
                  className="mt-1 w-full rounded bg-bg-card px-2 py-1">
                  <option value="hard_block">hard_block (fit=0 강제)</option>
                  <option value="soft_penalty">soft_penalty (fit 감산)</option>
                  <option value="bonus">bonus (fit 가산)</option>
                </select>
              </label>
              <label className="block">
                <span className="font-semibold">장르 패턴 (substring)</span>
                <input value={form.genre_pattern}
                  onChange={(e) => setForm((f) => ({ ...f, genre_pattern: e.target.value }))}
                  placeholder="예: Metal, Hard Rock, JPOP"
                  className="mt-1 w-full rounded bg-bg-card px-2 py-1" />
              </label>
              <label className="block">
                <span className="font-semibold">매장 slug</span>
                <select value={form.store_slug}
                  onChange={(e) => setForm((f) => ({ ...f, store_slug: e.target.value }))}
                  className="mt-1 w-full rounded bg-bg-card px-2 py-1">
                  <option value="">선택…</option>
                  {storeTypes.map((s) => <option key={s.slug} value={s.slug}>{s.name_ko} ({s.slug})</option>)}
                </select>
              </label>
              <label className="block">
                <span className="font-semibold">score delta</span>
                <input type="number" value={form.score_delta}
                  onChange={(e) => setForm((f) => ({ ...f, score_delta: Number(e.target.value) }))}
                  disabled={form.rule_type === 'hard_block'}
                  className="mt-1 w-full rounded bg-bg-card px-2 py-1 disabled:opacity-50" />
                <span className="text-[10px] text-ink-dim">
                  {form.rule_type === 'hard_block' ? '(hard_block 은 항상 0)' : 'soft_penalty 는 음수, bonus 는 양수'}
                </span>
              </label>
              <label className="block">
                <span className="font-semibold">설명 (선택)</span>
                <input value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  className="mt-1 w-full rounded bg-bg-card px-2 py-1" />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setEditOpen(false)} disabled={saving}
                className="rounded bg-bg-card px-3 py-1.5 text-xs">
                취소
              </button>
              <button onClick={() => void submit()} disabled={saving}
                className="rounded bg-accent px-3 py-1.5 text-xs font-bold text-black disabled:opacity-50">
                {saving ? '저장 중…' : (form.id ? '수정' : '추가')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
