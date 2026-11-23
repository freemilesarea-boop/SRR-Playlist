/**
 * EnterpriseGuidesPanel — 관리자: 엔터프라이즈 가이드 작성·수정·공개·순서·삭제 (0565).
 *
 * 공개 페이지: /enterprise-guide (목록), /enterprise-guide/:slug (글)
 * 본문은 마크다운 — 옆(작은 화면은 탭)에서 실제 모양을 미리 본다. 이미지는 본문 커서 위치에 바로 넣고,
 * PDF 등은 첨부로 붙인다. 삭제는 숨김이라 운영 로그로 되살릴 수 있다.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  BookOpen, Plus, Save, X, Eye, EyeOff, ArrowUp, ArrowDown, Trash2, Pencil, ExternalLink,
  ImagePlus, Loader2,
} from 'lucide-react';
import { MarkdownBodyEditor, AttachmentsEditor, postField, postTool } from '@/components/admin/posts/PostEditorParts';
import {
  adminListEnterpriseGuides,
  adminUpsertEnterpriseGuide,
  adminSetEnterpriseGuidePublished,
  adminReorderEnterpriseGuides,
  adminDeleteEnterpriseGuide,
  adminUploadEnterpriseGuideFile,
  type AdminEnterpriseGuide,
  type EnterpriseGuideInput,
} from '@/lib/enterpriseGuideApi';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';

const EMPTY: EnterpriseGuideInput = {
  id: null, slug: '', title: '', summary: '', category: '', cover_image_url: null,
  body_md: '', attachments: [], is_published: false,
};

function toInput(g: AdminEnterpriseGuide): EnterpriseGuideInput {
  return {
    id: g.id, slug: g.slug, title: g.title, summary: g.summary ?? '', category: g.category,
    cover_image_url: g.cover_image_url, body_md: g.body_md, attachments: g.attachments ?? [],
    is_published: g.is_published,
  };
}

export default function EnterpriseGuidesPanel() {
  const [list, setList] = useState<AdminEnterpriseGuide[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<EnterpriseGuideInput | null>(null);
  const [baseline, setBaseline] = useState<string>('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setList(await adminListEnterpriseGuides());
    } catch (e) {
      toast.error(friendlyError(e, '가이드 불러오기 실패'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    if (!confirmDeleteId) return;
    const t = window.setTimeout(() => setConfirmDeleteId(null), 4000);
    return () => window.clearTimeout(t);
  }, [confirmDeleteId]);

  const dirty = draft !== null && JSON.stringify(draft) !== baseline;

  function open(next: EnterpriseGuideInput) {
    if (dirty && !window.confirm('저장하지 않은 내용이 있어요. 버리고 다른 글을 열까요?')) return;
    setDraft(next);
    setBaseline(JSON.stringify(next));
  }
  function close() {
    if (dirty && !window.confirm('저장하지 않은 내용이 있어요. 닫을까요?')) return;
    setDraft(null);
  }

  async function togglePublished(g: AdminEnterpriseGuide) {
    setBusyId(g.id);
    try {
      await adminSetEnterpriseGuidePublished(g.id, !g.is_published);
      toast.success(g.is_published ? '비공개로 바꿨어요' : '공개했어요');
      await reload();
    } catch (e) {
      toast.error(friendlyError(e, '공개 전환 실패'));
    } finally { setBusyId(null); }
  }

  async function move(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[index], next[j]] = [next[j], next[index]];
    setList(next);
    setBusyId(next[j].id);
    try {
      await adminReorderEnterpriseGuides(next.map((g) => g.id));
    } catch (e) {
      toast.error(friendlyError(e, '순서 변경 실패'));
      await reload();
    } finally { setBusyId(null); }
  }

  async function remove(g: AdminEnterpriseGuide) {
    setBusyId(g.id);
    try {
      await adminDeleteEnterpriseGuide(g.id);
      toast.success(`'${g.title}' 을(를) 삭제했어요`);
      if (draft?.id === g.id) setDraft(null);
      await reload();
    } catch (e) {
      toast.error(friendlyError(e, '삭제 실패'));
    } finally { setBusyId(null); setConfirmDeleteId(null); }
  }

  return (
    <section className="space-y-4">
      <div className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BookOpen size={14} className="text-accent" />
            <h3 className="text-sm font-bold tracking-tight">엔터프라이즈 가이드</h3>
            <a href="/enterprise-guide" target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-[11px] text-ink-mute hover:text-ink">
              공개 페이지 <ExternalLink size={11} />
            </a>
          </div>
          <button type="button" onClick={() => open({ ...EMPTY })} className="btn-primary h-9">
            <Plus size={14} /> 새 가이드
          </button>
        </div>
        <p className="mt-1 text-[11px] text-ink-dim">
          공개한 글만 사이트(푸터 › 듣다 서비스 › 엔터프라이즈 가이드)에 보여요. 목록 순서가 사이트 순서예요.
        </p>
      </div>

      {draft && (
        <GuideEditor
          key={draft.id ?? 'new'}
          draft={draft}
          dirty={dirty}
          onChange={setDraft}
          onClose={close}
          onSaved={(saved) => {
            const next = toInput(saved);
            setDraft(next);
            setBaseline(JSON.stringify(next));
            void reload();
          }}
        />
      )}

      <div className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
        <h4 className="mb-3 text-sm font-bold tracking-tight">
          전체 가이드
          <span className="ml-2 text-xs font-normal text-ink-mute">
            {list.length}개 · 공개 {list.filter((g) => g.is_published).length}
          </span>
        </h4>
        {loading ? (
          <p className="py-8 text-center text-xs text-ink-mute">불러오는 중…</p>
        ) : list.length === 0 ? (
          <p className="py-8 text-center text-xs text-ink-dim">아직 가이드가 없어요. ‘새 가이드’로 첫 글을 써 보세요.</p>
        ) : (
          <ul className="space-y-2">
            {list.map((g, i) => (
              <li key={g.id} className={`flex flex-wrap items-center gap-2 rounded-xl bg-bg-soft p-3 ring-1 ${
                draft?.id === g.id ? 'ring-accent/60' : 'ring-line/10'}`}>
                <div className="flex flex-col">
                  <button type="button" onClick={() => void move(i, -1)} disabled={i === 0 || busyId !== null}
                    aria-label={`${g.title} 위로`} className="rounded p-0.5 text-ink-mute hover:text-ink disabled:opacity-30">
                    <ArrowUp size={12} />
                  </button>
                  <button type="button" onClick={() => void move(i, 1)} disabled={i === list.length - 1 || busyId !== null}
                    aria-label={`${g.title} 아래로`} className="rounded p-0.5 text-ink-mute hover:text-ink disabled:opacity-30">
                    <ArrowDown size={12} />
                  </button>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                    {g.is_published ? (
                      <span className="rounded-full bg-emerald-500/25 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">공개</span>
                    ) : (
                      <span className="rounded-full bg-bg-card px-1.5 py-0.5 text-[10px] font-bold text-ink-dim">비공개</span>
                    )}
                    <span className="truncate">{g.title}</span>
                  </p>
                  <p className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-ink-dim">
                    <span>{g.category}</span>
                    <span className="font-mono">/enterprise-guide/{g.slug}</span>
                    {g.attachments.length > 0 && <span>첨부 {g.attachments.length}</span>}
                    <span>수정 {new Date(g.updated_at).toLocaleString()}</span>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {g.is_published && (
                    <a href={`/enterprise-guide/${g.slug}`} target="_blank" rel="noopener noreferrer"
                      aria-label={`${g.title} 사이트에서 보기`} title="사이트에서 보기"
                      className="rounded-md px-2 py-1 text-ink-mute hover:bg-bg-hover hover:text-ink">
                      <ExternalLink size={12} />
                    </a>
                  )}
                  <button type="button" onClick={() => void togglePublished(g)} disabled={busyId === g.id}
                    title={g.is_published ? '비공개로' : '공개하기'} aria-label={g.is_published ? `${g.title} 비공개로` : `${g.title} 공개하기`}
                    className="rounded-md px-2 py-1 text-ink-mute hover:bg-bg-hover hover:text-ink disabled:opacity-40">
                    {g.is_published ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                  <button type="button" onClick={() => open(toInput(g))}
                    className="inline-flex items-center gap-1 rounded-md bg-bg-card px-2.5 py-1 text-[11px] text-ink-mute hover:bg-bg-hover hover:text-ink">
                    <Pencil size={11} /> 수정
                  </button>
                  {confirmDeleteId === g.id ? (
                    <button type="button" onClick={() => void remove(g)} disabled={busyId === g.id}
                      className="rounded-md bg-rose-500/25 px-2 py-1 text-[11px] font-bold text-rose-300 disabled:opacity-40">
                      삭제?
                    </button>
                  ) : (
                    <button type="button" onClick={() => setConfirmDeleteId(g.id)}
                      aria-label={`${g.title} 삭제`} title="삭제"
                      className="rounded-md px-2 py-1 text-rose-300 hover:bg-rose-500/20">
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function GuideEditor({ draft, dirty, onChange, onClose, onSaved }: {
  draft: EnterpriseGuideInput;
  dirty: boolean;
  onChange: (d: EnterpriseGuideInput) => void;
  onClose: () => void;
  onSaved: (g: AdminEnterpriseGuide) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);
  const [bodyBusy, setBodyBusy] = useState(false);
  const [attachBusy, setAttachBusy] = useState(false);
  const busy = coverUploading || bodyBusy || attachBusy;
  const set = <K extends keyof EnterpriseGuideInput>(k: K, v: EnterpriseGuideInput[K]) => onChange({ ...draft, [k]: v });

  async function uploadCover(files: FileList | null) {
    if (!files || files.length === 0) return;
    setCoverUploading(true);
    try {
      const f = await adminUploadEnterpriseGuideFile(files[0], 'cover');
      set('cover_image_url', f.url);
    } catch (e) {
      toast.error(friendlyError(e, '파일 올리기 실패'));
    } finally { setCoverUploading(false); }
  }

  async function save(publish: boolean) {
    if (!draft.title.trim()) { toast.error('제목을 입력해 주세요'); return; }
    setSaving(true);
    try {
      const saved = await adminUpsertEnterpriseGuide({ ...draft, is_published: publish });
      toast.success(publish ? '저장하고 공개했어요' : '비공개로 저장했어요');
      onSaved(saved);
    } catch (e) {
      toast.error(friendlyError(e, '저장 실패'));
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-4 rounded-2xl bg-bg-card p-4 ring-1 ring-accent/30">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-bold">
          {draft.id ? '가이드 수정' : '새 가이드'}
          {dirty && <span className="ml-2 text-[11px] font-normal text-ink-dim">· 저장 안 됨</span>}
        </h4>
        <button type="button" onClick={onClose} aria-label="편집 닫기" className="rounded p-1 text-ink-mute hover:text-ink">
          <X size={16} />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 sm:col-span-2">
          <span className="text-[11px] font-semibold text-ink-mute">제목 *</span>
          <input value={draft.title} onChange={(e) => set('title', e.target.value)} maxLength={200}
            placeholder="예: 듣다 도입 절차 한눈에 보기" className={postField} />
        </label>
        <label className="space-y-1 sm:col-span-2">
          <span className="text-[11px] font-semibold text-ink-mute">한 줄 요약 (목록에 보여요)</span>
          <input value={draft.summary} onChange={(e) => set('summary', e.target.value)} maxLength={300}
            placeholder="예: 계약부터 매장 연결까지 5단계로 정리했어요" className={postField} />
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-semibold text-ink-mute">카테고리 (같은 이름끼리 묶여요)</span>
          <input value={draft.category} onChange={(e) => set('category', e.target.value)} maxLength={40}
            placeholder="일반" className={postField} />
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-semibold text-ink-mute">주소 (영문 소문자·숫자·-, 비우면 자동)</span>
          <div className="flex items-center gap-1">
            <span className="shrink-0 text-[11px] text-ink-dim">/enterprise-guide/</span>
            <input value={draft.slug} onChange={(e) => set('slug', e.target.value.toLowerCase())} maxLength={80}
              placeholder="getting-started" className={`${postField} font-mono`} />
          </div>
        </label>
      </div>

      <div className="space-y-1">
        <span className="text-[11px] font-semibold text-ink-mute">대표 이미지 (목록 카드·글 맨 위)</span>
        <div className="flex flex-wrap items-center gap-2">
          {draft.cover_image_url && (
            <img src={draft.cover_image_url} alt="대표 이미지" className="h-16 w-28 rounded-lg bg-bg-soft object-cover ring-1 ring-line/10" />
          )}
          <label className={`${postTool} cursor-pointer bg-bg-soft`}>
            {coverUploading ? <Loader2 size={12} className="animate-spin" /> : <ImagePlus size={12} />}
            {draft.cover_image_url ? '바꾸기' : '이미지 올리기'}
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only"
              disabled={coverUploading} onChange={(e) => { void uploadCover(e.target.files); e.target.value = ''; }} />
          </label>
          {draft.cover_image_url && (
            <button type="button" onClick={() => set('cover_image_url', null)} className={postTool}>빼기</button>
          )}
        </div>
      </div>

      <MarkdownBodyEditor value={draft.body_md} onChange={(v) => set('body_md', v)}
        onUploadImage={(f) => adminUploadEnterpriseGuideFile(f, 'inline')} onBusyChange={setBodyBusy} />

      <AttachmentsEditor value={draft.attachments} onChange={(v) => set('attachments', v)}
        onUpload={(f) => adminUploadEnterpriseGuideFile(f, 'attachment')} onBusyChange={setAttachBusy} />

      <div className="flex flex-wrap justify-end gap-2 border-t border-line/10 pt-3">
        <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-xs text-ink-mute hover:bg-bg-hover">닫기</button>
        <button type="button" onClick={() => void save(false)} disabled={saving || busy}
          className="inline-flex items-center gap-1 rounded-lg bg-bg-soft px-3 py-2 text-xs font-semibold ring-1 ring-line/15 hover:bg-bg-hover disabled:opacity-50">
          <Save size={12} /> 비공개로 저장
        </button>
        <button type="button" onClick={() => void save(true)} disabled={saving || busy}
          className="btn-primary h-9 px-3 text-xs disabled:opacity-50">
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Eye size={12} />} 저장하고 공개
        </button>
      </div>
    </div>
  );
}
