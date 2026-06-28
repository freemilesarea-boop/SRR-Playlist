import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Save, X, Bell, Eye, EyeOff } from 'lucide-react';
import {
  adminListSiteNotices,
  adminUpsertSiteNotice,
  adminDeleteSiteNotice,
  adminToggleSiteNotice,
  type SiteNotice,
  type NoticeAudience,
  type NoticeLocation,
  type UpsertSiteNoticeInput,
} from '@/lib/siteNoticesApi';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';

const AUDIENCE_LABELS: Record<NoticeAudience, string> = {
  all: '전체 (로그인+게스트)',
  guest: '비로그인만',
  authenticated: '로그인 사용자만',
  artist: '아티스트만',
  business: '사업자/매장만',
  admin: '관리자만',
};

const LOCATION_LABELS: Record<NoticeLocation, string> = {
  home: '메인페이지만',
  all_pages: '모든 페이지',
};

const EMPTY_DRAFT: UpsertSiteNoticeInput = {
  id: null,
  title: '',
  body: '',
  is_active: true,
  audience: 'all',
  display_location: 'home',
  starts_at: null,
  ends_at: null,
  priority: 0,
  dismissible: true,
};

export default function SiteNoticesManagerPanel() {
  const [list, setList] = useState<SiteNotice[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null | 'new'>(null);
  const [draft, setDraft] = useState<UpsertSiteNoticeInput>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await adminListSiteNotices();
      setList(rows);
    } catch (e) {
      toast.error(friendlyError(e, '공지 불러오기 실패'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  function startCreate() {
    setDraft({ ...EMPTY_DRAFT });
    setEditingId('new');
  }
  function startEdit(n: SiteNotice) {
    setDraft({
      id: n.id, title: n.title, body: n.body, is_active: n.is_active,
      audience: n.audience, display_location: n.display_location,
      starts_at: n.starts_at, ends_at: n.ends_at,
      priority: n.priority, dismissible: n.dismissible,
    });
    setEditingId(n.id);
  }

  async function save() {
    if (draft.title.trim().length === 0 || draft.body.trim().length === 0) {
      toast.error('제목과 본문은 비울 수 없습니다');
      return;
    }
    setSaving(true);
    try {
      await adminUpsertSiteNotice(draft);
      toast.success(editingId === 'new' ? '공지 생성 완료' : '공지 수정 완료');
      setEditingId(null);
      await reload();
    } catch (e) {
      toast.error(friendlyError(e, '저장 실패'));
    } finally {
      setSaving(false);
    }
  }

  async function toggle(n: SiteNotice) {
    try {
      await adminToggleSiteNotice(n.id, !n.is_active);
      toast.success(n.is_active ? '비활성화됨' : '활성화됨');
      await reload();
    } catch (e) {
      toast.error(friendlyError(e, '토글 실패'));
    }
  }

  async function remove(n: SiteNotice) {
    if (!confirm(`'${n.title}' 공지를 삭제할까요? 되돌릴 수 없습니다.`)) return;
    try {
      await adminDeleteSiteNotice(n.id);
      toast.success('삭제됨');
      await reload();
    } catch (e) {
      toast.error(friendlyError(e, '삭제 실패'));
    }
  }

  return (
    <section className="space-y-4">
      <div className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell size={14} className="text-accent" />
            <h3 className="text-sm font-bold tracking-tight">공지/팝업 관리</h3>
            <span className="ml-2 text-[10px] text-ink-dim">
              메인페이지/전체페이지에 노출. audience 별로 타겟팅, 기간/우선순위 설정 가능.
            </span>
          </div>
          <button onClick={startCreate} className="btn-primary h-9">
            <Plus size={14} /> 새 공지
          </button>
        </div>

        {editingId !== null && (
          <NoticeEditor
            draft={draft}
            onChange={setDraft}
            onCancel={() => setEditingId(null)}
            onSave={save}
            saving={saving}
            isNew={editingId === 'new'}
          />
        )}
      </div>

      <div className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
        <h4 className="mb-3 text-sm font-bold tracking-tight">
          전체 공지
          <span className="ml-2 text-xs text-ink-mute">
            {list.length}개 · 활성 {list.filter((n) => n.is_active).length}
          </span>
        </h4>

        {loading ? (
          <p className="py-8 text-center text-xs text-ink-mute">불러오는 중…</p>
        ) : list.length === 0 ? (
          <p className="py-8 text-center text-xs text-ink-dim">아직 등록된 공지가 없습니다.</p>
        ) : (
          <ul className="space-y-2">
            {list.map((n) => (
              <li key={n.id} className={`rounded-xl bg-bg-soft p-3 ring-1 ${
                n.is_active ? 'ring-emerald-500/50' : 'ring-line/10 opacity-70'
              }`}>
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-semibold">
                      {n.is_active ? (
                        <span className="rounded-full bg-emerald-500/25 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">ON</span>
                      ) : (
                        <span className="rounded-full bg-bg-card px-1.5 py-0.5 text-[10px] font-bold text-ink-dim">OFF</span>
                      )}
                      {n.title}
                    </p>
                    <p className="mt-1 line-clamp-2 whitespace-pre-line text-[11px] text-ink-mute">{n.body}</p>
                    <p className="mt-1 flex flex-wrap gap-1 text-[10px] text-ink-dim">
                      <span className="rounded bg-bg-card px-1.5 py-0.5">{AUDIENCE_LABELS[n.audience]}</span>
                      <span className="rounded bg-bg-card px-1.5 py-0.5">{LOCATION_LABELS[n.display_location]}</span>
                      <span className="rounded bg-bg-card px-1.5 py-0.5">우선순위 {n.priority}</span>
                      {!n.dismissible && <span className="rounded bg-rose-500/25 px-1.5 py-0.5 text-rose-300">닫기불가</span>}
                      {n.starts_at && <span>시작 {new Date(n.starts_at).toLocaleString()}</span>}
                      {n.ends_at && <span>종료 {new Date(n.ends_at).toLocaleString()}</span>}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      onClick={() => toggle(n)}
                      className="rounded-md px-2 py-1 text-[11px] text-ink-mute hover:bg-bg-hover hover:text-ink"
                      title={n.is_active ? '비활성화' : '활성화'}
                    >
                      {n.is_active ? <EyeOff size={12} /> : <Eye size={12} />}
                    </button>
                    <button
                      onClick={() => startEdit(n)}
                      className="rounded-md bg-bg-card px-2.5 py-1 text-[11px] text-ink-mute hover:bg-bg-hover hover:text-ink"
                    >
                      편집
                    </button>
                    <button
                      onClick={() => remove(n)}
                      className="rounded-md px-2 py-1 text-[11px] text-rose-300 hover:bg-rose-500/20"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function NoticeEditor({
  draft, onChange, onCancel, onSave, saving, isNew,
}: {
  draft: UpsertSiteNoticeInput;
  onChange: (d: UpsertSiteNoticeInput) => void;
  onCancel: () => void;
  onSave: () => Promise<void>;
  saving: boolean;
  isNew: boolean;
}) {
  function toLocalInput(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    const tz = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - tz).toISOString().slice(0, 16);
  }
  function fromLocalInput(v: string): string | null {
    if (!v) return null;
    return new Date(v).toISOString();
  }

  return (
    <div className="space-y-3 rounded-xl bg-bg-soft p-4 ring-1 ring-line/10">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold tracking-tight">{isNew ? '새 공지 작성' : '공지 수정'}</p>
        <button onClick={onCancel} className="text-ink-mute hover:text-ink">
          <X size={14} />
        </button>
      </div>

      <label className="block space-y-1">
        <span className="text-[10px] font-bold uppercase tracking-wider text-ink-dim">제목</span>
        <input
          type="text" value={draft.title}
          onChange={(e) => onChange({ ...draft, title: e.target.value })}
          className="input h-9 text-sm" maxLength={100}
        />
      </label>

      <label className="block space-y-1">
        <span className="text-[10px] font-bold uppercase tracking-wider text-ink-dim">본문 ({draft.body.length}/2000)</span>
        <textarea
          value={draft.body}
          onChange={(e) => onChange({ ...draft, body: e.target.value })}
          className="input min-h-[120px] resize-y text-sm leading-relaxed" maxLength={2000}
        />
      </label>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="block space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-ink-dim">대상</span>
          <select
            value={draft.audience ?? 'all'}
            onChange={(e) => onChange({ ...draft, audience: e.target.value as NoticeAudience })}
            className="input h-9 text-xs"
          >
            {(Object.entries(AUDIENCE_LABELS) as [NoticeAudience, string][]).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-ink-dim">표시 위치</span>
          <select
            value={draft.display_location ?? 'home'}
            onChange={(e) => onChange({ ...draft, display_location: e.target.value as NoticeLocation })}
            className="input h-9 text-xs"
          >
            {(Object.entries(LOCATION_LABELS) as [NoticeLocation, string][]).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-ink-dim">우선순위 (↑먼저)</span>
          <input
            type="number" value={draft.priority ?? 0}
            onChange={(e) => onChange({ ...draft, priority: Number(e.target.value) })}
            className="input h-9 text-xs"
          />
        </label>
        <label className="flex items-center gap-2 pt-5 text-xs">
          <input
            type="checkbox" checked={draft.dismissible ?? true}
            onChange={(e) => onChange({ ...draft, dismissible: e.target.checked })}
            className="h-4 w-4 rounded border-line/30 bg-bg-card accent-accent"
          />
          닫기 허용
        </label>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="block space-y-1 sm:col-span-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-ink-dim">시작일시 (비우면 즉시)</span>
          <input
            type="datetime-local" value={toLocalInput(draft.starts_at)}
            onChange={(e) => onChange({ ...draft, starts_at: fromLocalInput(e.target.value) })}
            className="input h-9 text-xs"
          />
        </label>
        <label className="block space-y-1 sm:col-span-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-ink-dim">종료일시 (비우면 무기한)</span>
          <input
            type="datetime-local" value={toLocalInput(draft.ends_at)}
            onChange={(e) => onChange({ ...draft, ends_at: fromLocalInput(e.target.value) })}
            className="input h-9 text-xs"
          />
        </label>
        <label className="flex items-center gap-2 pt-5 text-xs sm:col-span-1">
          <input
            type="checkbox" checked={draft.is_active ?? true}
            onChange={(e) => onChange({ ...draft, is_active: e.target.checked })}
            className="h-4 w-4 rounded border-line/30 bg-bg-card accent-accent"
          />
          저장 즉시 활성화
        </label>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="btn-ghost h-9 text-xs">
          <X size={12} /> 취소
        </button>
        <button onClick={() => onSave()} disabled={saving} className="btn-primary h-9 text-xs">
          <Save size={12} /> {saving ? '저장 중…' : '저장'}
        </button>
      </div>
    </div>
  );
}
