/**
 * NoticePostsPanel — 관리자: 공지사항 게시판 글 작성·수정·공개·상단 고정·삭제 (0566).
 *
 * 공개 페이지: /notice (목록, 고정 글 먼저 · 최신순), /notice/:no (글 · 이전/다음 글)
 * 화면 위에 띄우는 '공지/팝업'(site_notices)과는 별개 — 이건 지난 공지가 쌓이는 게시판.
 */
import { useCallback, useEffect, useState } from 'react';
import { Megaphone, Plus, Save, X, Eye, EyeOff, Pin, PinOff, Trash2, Pencil, ExternalLink, Loader2 } from 'lucide-react';
import { MarkdownBodyEditor, AttachmentsEditor, postField } from '@/components/admin/posts/PostEditorParts';
import {
  adminListNoticePosts,
  adminUpsertNoticePost,
  adminSetNoticePostFlags,
  adminDeleteNoticePost,
  adminUploadNoticePostFile,
  formatNoticeDate,
  NOTICE_CATEGORIES,
  type AdminNoticePost,
  type NoticePostInput,
  type NoticeCategory,
} from '@/lib/noticePostsApi';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';

const EMPTY: NoticePostInput = {
  id: null, title: '', category: '공지', is_pinned: false, body_md: '', attachments: [], is_published: false,
};

function toInput(n: AdminNoticePost): NoticePostInput {
  return {
    id: n.id, title: n.title, category: n.category, is_pinned: n.is_pinned,
    body_md: n.body_md, attachments: n.attachments ?? [], is_published: n.is_published,
  };
}

export default function NoticePostsPanel() {
  const [list, setList] = useState<AdminNoticePost[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<NoticePostInput | null>(null);
  const [baseline, setBaseline] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setList(await adminListNoticePosts());
    } catch (e) {
      toast.error(friendlyError(e, '공지사항 불러오기 실패'));
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

  function open(next: NoticePostInput) {
    if (dirty && !window.confirm('저장하지 않은 내용이 있어요. 버리고 다른 글을 열까요?')) return;
    setDraft(next);
    setBaseline(JSON.stringify(next));
  }
  function close() {
    if (dirty && !window.confirm('저장하지 않은 내용이 있어요. 닫을까요?')) return;
    setDraft(null);
  }

  async function setFlags(n: AdminNoticePost, flags: { is_published?: boolean; is_pinned?: boolean }, done: string) {
    setBusyId(n.id);
    try {
      await adminSetNoticePostFlags(n.id, flags);
      toast.success(done);
      await reload();
    } catch (e) {
      toast.error(friendlyError(e, '바꾸기 실패'));
    } finally { setBusyId(null); }
  }

  async function remove(n: AdminNoticePost) {
    setBusyId(n.id);
    try {
      await adminDeleteNoticePost(n.id);
      toast.success(`'${n.title}' 을(를) 삭제했어요`);
      if (draft?.id === n.id) setDraft(null);
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
            <Megaphone size={14} className="text-accent" />
            <h3 className="text-sm font-bold tracking-tight">공지사항</h3>
            <a href="/notice" target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-[11px] text-ink-mute hover:text-ink">
              공개 페이지 <ExternalLink size={11} />
            </a>
          </div>
          <button type="button" onClick={() => open({ ...EMPTY })} className="btn-primary h-9">
            <Plus size={14} /> 새 공지
          </button>
        </div>
        <p className="mt-1 text-[11px] text-ink-dim">
          공개한 글만 사이트(푸터 › 지원 › 공지사항)에 보여요. 상단 고정 글이 맨 위, 나머지는 최신순이에요.
          화면 위에 잠깐 띄우는 안내는 ‘공지/팝업’ 탭에서 따로 관리해요.
        </p>
      </div>

      {draft && (
        <NoticeEditor
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
          전체 공지
          <span className="ml-2 text-xs font-normal text-ink-mute">
            {list.length}개 · 공개 {list.filter((n) => n.is_published).length} · 고정 {list.filter((n) => n.is_pinned).length}
          </span>
        </h4>
        {loading ? (
          <p className="py-8 text-center text-xs text-ink-mute">불러오는 중…</p>
        ) : list.length === 0 ? (
          <p className="py-8 text-center text-xs text-ink-dim">아직 공지가 없어요. ‘새 공지’로 첫 글을 써 보세요.</p>
        ) : (
          <ul className="space-y-2">
            {list.map((n) => (
              <li key={n.id} className={`flex flex-wrap items-center gap-2 rounded-xl bg-bg-soft p-3 ring-1 ${
                draft?.id === n.id ? 'ring-accent/60' : 'ring-line/10'}`}>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                    {n.is_published ? (
                      <span className="rounded-full bg-emerald-500/25 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">공개</span>
                    ) : (
                      <span className="rounded-full bg-bg-card px-1.5 py-0.5 text-[10px] font-bold text-ink-dim">비공개</span>
                    )}
                    {n.is_pinned && <span className="inline-flex items-center gap-0.5 rounded-full bg-accent/20 px-1.5 py-0.5 text-[10px] font-bold text-accent"><Pin size={9} /> 고정</span>}
                    <span className="rounded bg-bg-card px-1.5 py-0.5 text-[10px] text-ink-mute">{n.category}</span>
                    <span className="truncate">{n.title}</span>
                  </p>
                  <p className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-ink-dim">
                    <span className="font-mono">/notice/{n.no}</span>
                    {n.published_at && <span>게시 {formatNoticeDate(n.published_at)}</span>}
                    {n.attachments.length > 0 && <span>첨부 {n.attachments.length}</span>}
                    <span>수정 {new Date(n.updated_at).toLocaleString()}</span>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {n.is_published && (
                    <a href={`/notice/${n.no}`} target="_blank" rel="noopener noreferrer"
                      aria-label={`${n.title} 사이트에서 보기`} title="사이트에서 보기"
                      className="rounded-md px-2 py-1 text-ink-mute hover:bg-bg-hover hover:text-ink">
                      <ExternalLink size={12} />
                    </a>
                  )}
                  <button type="button" disabled={busyId === n.id}
                    onClick={() => void setFlags(n, { is_pinned: !n.is_pinned }, n.is_pinned ? '고정을 풀었어요' : '맨 위에 고정했어요')}
                    title={n.is_pinned ? '고정 해제' : '상단 고정'} aria-label={n.is_pinned ? `${n.title} 고정 해제` : `${n.title} 상단 고정`}
                    className="rounded-md px-2 py-1 text-ink-mute hover:bg-bg-hover hover:text-ink disabled:opacity-40">
                    {n.is_pinned ? <PinOff size={12} /> : <Pin size={12} />}
                  </button>
                  <button type="button" disabled={busyId === n.id}
                    onClick={() => void setFlags(n, { is_published: !n.is_published }, n.is_published ? '비공개로 바꿨어요' : '공개했어요')}
                    title={n.is_published ? '비공개로' : '공개하기'} aria-label={n.is_published ? `${n.title} 비공개로` : `${n.title} 공개하기`}
                    className="rounded-md px-2 py-1 text-ink-mute hover:bg-bg-hover hover:text-ink disabled:opacity-40">
                    {n.is_published ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                  <button type="button" onClick={() => open(toInput(n))}
                    className="inline-flex items-center gap-1 rounded-md bg-bg-card px-2.5 py-1 text-[11px] text-ink-mute hover:bg-bg-hover hover:text-ink">
                    <Pencil size={11} /> 수정
                  </button>
                  {confirmDeleteId === n.id ? (
                    <button type="button" onClick={() => void remove(n)} disabled={busyId === n.id}
                      className="rounded-md bg-rose-500/25 px-2 py-1 text-[11px] font-bold text-rose-300 disabled:opacity-40">
                      삭제?
                    </button>
                  ) : (
                    <button type="button" onClick={() => setConfirmDeleteId(n.id)}
                      aria-label={`${n.title} 삭제`} title="삭제"
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

function NoticeEditor({ draft, dirty, onChange, onClose, onSaved }: {
  draft: NoticePostInput;
  dirty: boolean;
  onChange: (d: NoticePostInput) => void;
  onClose: () => void;
  onSaved: (n: AdminNoticePost) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [bodyBusy, setBodyBusy] = useState(false);
  const [attachBusy, setAttachBusy] = useState(false);
  const busy = bodyBusy || attachBusy;
  const set = <K extends keyof NoticePostInput>(k: K, v: NoticePostInput[K]) => onChange({ ...draft, [k]: v });

  async function save(publish: boolean) {
    if (!draft.title.trim()) { toast.error('제목을 입력해 주세요'); return; }
    setSaving(true);
    try {
      const saved = await adminUpsertNoticePost({ ...draft, is_published: publish });
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
          {draft.id ? '공지 수정' : '새 공지'}
          {dirty && <span className="ml-2 text-[11px] font-normal text-ink-dim">· 저장 안 됨</span>}
        </h4>
        <button type="button" onClick={onClose} aria-label="편집 닫기" className="rounded p-1 text-ink-mute hover:text-ink">
          <X size={16} />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
        <label className="space-y-1">
          <span className="text-[11px] font-semibold text-ink-mute">분류</span>
          <select value={draft.category} onChange={(e) => set('category', e.target.value as NoticeCategory)} className={postField}>
            {NOTICE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-semibold text-ink-mute">제목 *</span>
          <input value={draft.title} onChange={(e) => set('title', e.target.value)} maxLength={200}
            placeholder="예: 11월 30일 새벽 서버 점검 안내" className={postField} />
        </label>
      </div>
      <label className="inline-flex cursor-pointer items-center gap-2 text-xs">
        <input type="checkbox" checked={draft.is_pinned} onChange={(e) => set('is_pinned', e.target.checked)} />
        <span>목록 맨 위에 고정</span>
      </label>

      <MarkdownBodyEditor value={draft.body_md} onChange={(v) => set('body_md', v)} previewVariant="paper"
        onUploadImage={(f) => adminUploadNoticePostFile(f, 'inline')} onBusyChange={setBodyBusy}
        placeholder={'안녕하세요, 듣다입니다.\n\n## 점검 일시\n- 11월 30일(토) 02:00 ~ 04:00\n\n점검 중에는 **재생이 잠시 멈출 수 있어요.**'} />

      <AttachmentsEditor value={draft.attachments} onChange={(v) => set('attachments', v)}
        onUpload={(f) => adminUploadNoticePostFile(f, 'attachment')} onBusyChange={setAttachBusy} />

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
