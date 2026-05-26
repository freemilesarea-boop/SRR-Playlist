import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Save, ExternalLink, CheckCircle2, Upload, X } from 'lucide-react';
import {
  fetchMyCuratorProfile,
  upsertCuratorProfile,
  isValidHandle,
  isHandleAvailable,
  type CuratorProfilePayload,
} from '@/lib/curatorApi';
import { uploadImage } from '@/lib/imageUpload';
import { toast } from '@/store/toastStore';

interface Props {
  userId: string;
}

export default function CuratorProfileEditor({ userId }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<CuratorProfilePayload>({
    display_name: '',
    handle: '',
    bio: '',
    profile_image_url: '',
    contact_email: '',
    instagram_url: '',
    youtube_url: '',
    website_url: '',
    allow_business_contact: true,
  });
  const [handleError, setHandleError] = useState<string | null>(null);
  const [originalHandle, setOriginalHandle] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchMyCuratorProfile(userId)
      .then((p) => {
        if (!alive) return;
        if (p) {
          setForm({
            display_name: p.display_name ?? '',
            handle: p.handle ?? '',
            bio: p.bio ?? '',
            profile_image_url: p.profile_image_url ?? '',
            contact_email: p.contact_email ?? '',
            instagram_url: p.instagram_url ?? '',
            youtube_url: p.youtube_url ?? '',
            website_url: p.website_url ?? '',
            allow_business_contact: p.allow_business_contact ?? true,
          });
          setOriginalHandle(p.handle);
        }
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [userId]);

  async function checkHandle(h: string) {
    if (!h) {
      setHandleError(null);
      return;
    }
    if (!isValidHandle(h)) {
      setHandleError('영문/숫자/-/_ 만, 3~32자');
      return;
    }
    if (originalHandle && h.toLowerCase() === originalHandle.toLowerCase()) {
      setHandleError(null);
      return;
    }
    const ok = await isHandleAvailable(h, userId);
    setHandleError(ok ? null : '이미 사용 중인 handle 이에요');
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.display_name.trim()) {
      toast.error('표시 이름을 입력해주세요');
      return;
    }
    if (!isValidHandle(form.handle)) {
      toast.error('handle 형식이 올바르지 않아요 (영문/숫자/-/_, 3~32자)');
      return;
    }
    if (handleError) {
      toast.error(handleError);
      return;
    }
    setSaving(true);
    const res = await upsertCuratorProfile(userId, {
      ...form,
      bio: form.bio?.trim() || null,
      contact_email: form.contact_email?.trim() || null,
      instagram_url: form.instagram_url?.trim() || null,
      youtube_url: form.youtube_url?.trim() || null,
      website_url: form.website_url?.trim() || null,
      profile_image_url: form.profile_image_url?.trim() || null,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error ?? '저장 실패');
      return;
    }
    setOriginalHandle(form.handle.toLowerCase());
    toast.success('큐레이터 프로필이 저장됐어요');
  }

  if (loading) {
    return (
      <div className="h-32 animate-pulse rounded-2xl bg-bg-card" />
    );
  }

  return (
    <form onSubmit={onSave} className="space-y-4 rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">큐레이터</p>
          <h3 className="mt-0.5 text-base font-bold">큐레이터 프로필</h3>
          <p className="mt-0.5 text-xs text-ink-mute">
            공개 페이지(/curator/{form.handle || 'handle'})에 노출됩니다.
          </p>
        </div>
        {originalHandle && (
          <Link
            to={`/curator/${originalHandle}`}
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-ink/5 px-2.5 py-1 text-[11px] font-semibold hover:bg-ink/10"
          >
            <ExternalLink size={11} /> 미리보기
          </Link>
        )}
      </div>

      <Field label="표시 이름 *" hint="다른 사용자에게 보이는 이름">
        <input
          type="text"
          value={form.display_name}
          onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
          maxLength={60}
          required
        />
      </Field>

      <Field
        label="Handle *"
        hint={`/curator/${form.handle || 'your-handle'}`}
        error={handleError ?? undefined}
      >
        <input
          type="text"
          value={form.handle}
          onChange={(e) => setForm((f) => ({ ...f, handle: e.target.value.toLowerCase().slice(0, 32) }))}
          onBlur={() => void checkHandle(form.handle)}
          placeholder="srr-music"
          pattern="^[a-z0-9][a-z0-9_-]{1,30}[a-z0-9]$"
          required
        />
      </Field>

      <Field label="소개" hint="짧은 한 줄 소개 권장">
        <textarea
          value={form.bio ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
          rows={2}
          maxLength={500}
        />
      </Field>

      <div className="block space-y-1">
        <span className="block text-[11px] font-semibold uppercase tracking-wider text-ink-mute">프로필 이미지</span>
        <ImageUploadField
          value={form.profile_image_url ?? ''}
          onChange={(url) => setForm((f) => ({ ...f, profile_image_url: url }))}
        />
        <p className="text-[11px] text-ink-dim">JPG/PNG/WEBP · 최대 5MB. 파일을 선택하면 자동 업로드됩니다.</p>
      </div>

      <Field label="협업 문의 이메일" hint="협업 문의 버튼이 이 메일로 mailto 생성">
        <input
          type="email"
          value={form.contact_email ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, contact_email: e.target.value }))}
          placeholder="hello@example.com"
        />
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Instagram URL">
          <input
            type="url"
            value={form.instagram_url ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, instagram_url: e.target.value }))}
            placeholder="https://instagram.com/…"
          />
        </Field>
        <Field label="YouTube URL">
          <input
            type="url"
            value={form.youtube_url ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, youtube_url: e.target.value }))}
            placeholder="https://youtube.com/@…"
          />
        </Field>
        <Field label="웹사이트">
          <input
            type="url"
            value={form.website_url ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, website_url: e.target.value }))}
            placeholder="https://…"
          />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.allow_business_contact ?? true}
          onChange={(e) => setForm((f) => ({ ...f, allow_business_contact: e.target.checked }))}
        />
        <span>협업 문의 받기 (이메일 공개)</span>
      </label>

      <div className="flex items-center justify-end gap-2">
        <button
          type="submit"
          disabled={saving || !!handleError}
          className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-xs font-bold text-bg disabled:opacity-50"
        >
          {saving ? '저장 중…' : (
            <>
              <Save size={14} /> 저장
            </>
          )}
        </button>
        {!saving && originalHandle && (
          <span className="inline-flex items-center gap-0.5 text-[11px] text-emerald-400">
            <CheckCircle2 size={11} /> 적용됨
          </span>
        )}
      </div>
    </form>
  );
}

export function ImageUploadField({
  value, onChange, prefix = 'profile_images',
}: {
  value: string; onChange: (url: string) => void; prefix?: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ''; // 같은 파일 재선택 허용
    if (!f) return;
    setErr(null); setUploading(true);
    const res = await uploadImage(f, prefix);
    setUploading(false);
    if (!res.ok || !res.url) { setErr(res.error ?? '업로드 실패'); toast.error(res.error ?? '업로드 실패'); return; }
    onChange(res.url);
    toast.success('이미지가 업로드됐어요');
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        {value ? (
          <div className="relative">
            <img src={value} alt="프로필 미리보기" className="h-16 w-16 rounded-full object-cover ring-1 ring-line/20" />
            <button type="button" onClick={() => onChange('')} title="이미지 제거"
              className="absolute -right-1 -top-1 rounded-full bg-ink/80 p-0.5 text-bg hover:bg-ink"><X size={11} /></button>
          </div>
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-bg-deep text-[10px] text-ink-dim ring-1 ring-line/15">없음</div>
        )}
        <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold ${uploading ? 'bg-ink/5 text-ink-dim' : 'bg-ink/5 hover:bg-ink/10'}`}>
          <Upload size={13} /> {uploading ? '업로드 중…' : (value ? '이미지 교체' : '이미지 선택')}
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onFile} disabled={uploading} className="hidden" />
        </label>
      </div>
      {err && <p className="text-[11px] text-red-400">{err}</p>}
    </div>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="block text-[11px] font-semibold uppercase tracking-wider text-ink-mute">{label}</span>
      <div className="[&>input]:w-full [&>input]:rounded-lg [&>input]:bg-bg-deep [&>input]:px-3 [&>input]:py-2 [&>input]:text-sm [&>input]:ring-1 [&>input]:ring-line/15 [&>input]:focus:outline-none [&>input]:focus:ring-accent/60 [&>textarea]:w-full [&>textarea]:rounded-lg [&>textarea]:bg-bg-deep [&>textarea]:px-3 [&>textarea]:py-2 [&>textarea]:text-sm [&>textarea]:ring-1 [&>textarea]:ring-line/15 [&>textarea]:focus:outline-none [&>textarea]:focus:ring-accent/60">
        {children}
      </div>
      {error && <p className="text-[11px] text-red-400">{error}</p>}
      {hint && !error && <p className="text-[11px] text-ink-dim">{hint}</p>}
    </label>
  );
}
