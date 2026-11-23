/**
 * PostEditorParts — 관리자 공개 글 편집 공용 조각 (엔터프라이즈 가이드 · 공지사항).
 *
 * MarkdownBodyEditor: 소제목·굵게·목록·링크·본문 이미지 넣기 + 쓰기/미리보기(넓은 화면은 나란히)
 * AttachmentsEditor: PDF·이미지 첨부 올리기·이름 고치기·빼기
 */
import { useEffect, useRef, useState } from 'react';
import { Heading2, Bold, List, Link2, ImagePlus, Paperclip, FileText, X, Loader2 } from 'lucide-react';
import GuideMarkdown, { type GuideMarkdownVariant } from '@/components/common/GuideMarkdown';
import { applyMarkdown } from '@/lib/guideMarkdown';
import { formatFileSize, type PostAttachment } from '@/lib/postFiles';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';

export const postField = 'w-full rounded-lg bg-bg-soft px-3 py-2 text-sm ring-1 ring-line/10 focus:outline-none focus:ring-accent/50';
export const postTool = 'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-ink-mute hover:bg-bg-hover hover:text-ink disabled:opacity-40';

export function MarkdownBodyEditor({ value, onChange, onUploadImage, previewVariant = 'app', onBusyChange, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  onUploadImage: (file: File) => Promise<PostAttachment>;
  previewVariant?: GuideMarkdownVariant;
  onBusyChange?: (busy: boolean) => void;
  placeholder?: string;
}) {
  const [view, setView] = useState<'write' | 'preview'>('write');
  const [uploading, setUploading] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { onBusyChange?.(uploading); }, [uploading, onBusyChange]);

  function edit(kind: 'h2' | 'bold' | 'list' | 'link' | 'insert', insert = '', base = value) {
    const el = bodyRef.current;
    const start = el?.selectionStart ?? base.length;
    const end = el?.selectionEnd ?? base.length;
    const r = applyMarkdown(base, start, end, kind, insert);
    onChange(r.text);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(r.cursor, r.cursor);
    });
  }

  async function uploadInline(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const f = await onUploadImage(files[0]);
      const alt = f.name.replace(/\.[^.]+$/, '').replace(/[[\]]/g, '');
      edit('insert', `![${alt}](${f.url})`);
    } catch (e) {
      toast.error(friendlyError(e, '이미지 올리기 실패'));
    } finally { setUploading(false); }
  }

  const previewBox = previewVariant === 'paper'
    ? 'bg-[#f5f1ea] ring-stone-200'
    : 'bg-bg-soft/50 ring-line/10';

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-ink-mute">본문</span>
        <div className="flex rounded-lg bg-bg-soft p-0.5 lg:hidden" role="tablist">
          {(['write', 'preview'] as const).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
              className={`rounded-md px-2.5 py-1 text-[11px] font-semibold ${view === v ? 'bg-bg-card text-ink' : 'text-ink-mute'}`}>
              {v === 'write' ? '쓰기' : '미리보기'}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className={`${view === 'preview' ? 'hidden lg:block' : ''} space-y-1`}>
          <div className="flex flex-wrap gap-0.5 rounded-lg bg-bg-soft p-1">
            <button type="button" onClick={() => edit('h2')} className={postTool} title="소제목"><Heading2 size={12} /> 소제목</button>
            <button type="button" onClick={() => edit('bold')} className={postTool} title="굵게"><Bold size={12} /> 굵게</button>
            <button type="button" onClick={() => edit('list')} className={postTool} title="목록"><List size={12} /> 목록</button>
            <button type="button" onClick={() => edit('link')} className={postTool} title="링크"><Link2 size={12} /> 링크</button>
            <label className={`${postTool} cursor-pointer`} title="본문에 이미지 넣기">
              {uploading ? <Loader2 size={12} className="animate-spin" /> : <ImagePlus size={12} />} 이미지
              <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only"
                disabled={uploading} onChange={(e) => { void uploadInline(e.target.files); e.target.value = ''; }} />
            </label>
          </div>
          <textarea ref={bodyRef} value={value} onChange={(e) => onChange(e.target.value)}
            aria-label="본문"
            placeholder={placeholder ?? '## 소제목\n\n내용을 쓰세요. 빈 줄로 문단을 나눠요.\n\n- 목록은 줄 앞에 -\n- **굵게** 는 별표 두 개'}
            className={`${postField} min-h-[420px] font-mono text-[13px] leading-6`} />
        </div>
        <div className={`${view === 'write' ? 'hidden lg:block' : ''} min-h-[420px] overflow-y-auto rounded-lg p-4 ring-1 ${previewBox}`}>
          {value.trim()
            ? <GuideMarkdown source={value} variant={previewVariant} />
            : <p className={`text-xs ${previewVariant === 'paper' ? 'text-stone-500' : 'text-ink-dim'}`}>본문을 쓰면 여기에 사이트에서 보일 모습이 나와요.</p>}
        </div>
      </div>
    </div>
  );
}

export function AttachmentsEditor({ value, onChange, onUpload, onBusyChange }: {
  value: PostAttachment[];
  onChange: (v: PostAttachment[]) => void;
  onUpload: (file: File) => Promise<PostAttachment>;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [uploading, setUploading] = useState(false);
  useEffect(() => { onBusyChange?.(uploading); }, [uploading, onBusyChange]);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    const added: PostAttachment[] = [];
    try {
      for (const file of Array.from(files).slice(0, Math.max(0, 20 - value.length))) added.push(await onUpload(file));
    } catch (e) {
      toast.error(friendlyError(e, '파일 올리기 실패'));
    } finally {
      // 일부만 올라가도 올라간 것은 붙인다
      if (added.length > 0) onChange([...value, ...added]);
      setUploading(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <span className="text-[11px] font-semibold text-ink-mute">첨부 (PDF·이미지, 20MB 이하 · 최대 20개)</span>
      {value.length > 0 && (
        <ul className="space-y-1">
          {value.map((a, i) => (
            <li key={a.url} className="flex items-center gap-2 rounded-lg bg-bg-soft px-3 py-1.5 text-xs">
              <FileText size={12} className="shrink-0 text-accent" />
              <input value={a.name} aria-label="첨부 이름"
                onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                className="min-w-0 flex-1 bg-transparent focus:outline-none" />
              <span className="shrink-0 text-ink-dim">{formatFileSize(a.size)}</span>
              <button type="button" aria-label={`${a.name} 첨부 빼기`}
                onClick={() => onChange(value.filter((_, j) => j !== i))}
                className="shrink-0 rounded p-0.5 text-ink-mute hover:text-rose-300">
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className={`${postTool} cursor-pointer bg-bg-soft`}>
        {uploading ? <Loader2 size={12} className="animate-spin" /> : <Paperclip size={12} />} 파일 첨부
        <input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp,image/gif" className="sr-only"
          disabled={uploading || value.length >= 20}
          onChange={(e) => { void upload(e.target.files); e.target.value = ''; }} />
      </label>
    </div>
  );
}
