import { useEffect, useState } from 'react';
import { Bell, Save, ShieldOff, ShieldCheck } from 'lucide-react';
import { fetchSiteSettings, adminUpdateSiteSettings, type SiteSettings } from '@/lib/siteSettingsApi';
import { toast } from '@/store/toastStore';

export default function SiteSettingsPanel() {
  const [s, setS] = useState<SiteSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const row = await fetchSiteSettings();
      setS(row);
      setLoading(false);
    })();
  }, []);

  async function handleSave() {
    if (!s) return;
    if (s.notice_title.trim().length === 0 || s.notice_body.trim().length === 0) {
      toast.error('공지 제목/본문은 비울 수 없습니다');
      return;
    }
    setSaving(true);
    try {
      const updated = await adminUpdateSiteSettings({
        distribution_enabled: s.distribution_enabled,
        notice_enabled: s.notice_enabled,
        notice_title: s.notice_title,
        notice_body: s.notice_body,
      });
      setS(updated);
      toast.success('사이트 설정 저장 완료');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '저장 실패');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="py-8 text-center text-xs text-ink-mute">불러오는 중…</p>;
  if (!s) return <p className="py-8 text-center text-xs text-rose-400">설정을 불러올 수 없습니다.</p>;

  return (
    <section className="space-y-4">
      {/* 음원 유통 kill switch */}
      <div className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
        <div className="mb-3 flex items-center gap-2">
          {s.distribution_enabled ? (
            <ShieldCheck size={14} className="text-emerald-400" />
          ) : (
            <ShieldOff size={14} className="text-rose-400" />
          )}
          <h3 className="text-sm font-bold tracking-tight">신규 음원 유통 접수</h3>
          <span className="ml-auto text-[10px] text-ink-dim">
            DB 트리거 기반 — 일반 사용자는 RPC 호출도 차단됨
          </span>
        </div>

        <label className="flex items-start gap-3 rounded-lg bg-bg-soft p-3 ring-1 ring-line/10">
          <input
            type="checkbox"
            checked={s.distribution_enabled}
            onChange={(e) => setS({ ...s, distribution_enabled: e.target.checked })}
            className="mt-0.5 h-4 w-4 rounded border-line/30 bg-bg-card accent-accent"
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">
              {s.distribution_enabled ? '유통 접수 활성 (정상)' : '유통 접수 중지 중'}
            </div>
            <p className="mt-0.5 text-[11px] text-ink-mute">
              체크 해제 시 신규 업로드 시도가 차단되고 사용자에게 안내 메시지가 표시됩니다.
              기존 등록 음원과 admin 작업에는 영향 없습니다.
            </p>
          </div>
        </label>
      </div>

      {/* 공지 팝업 설정 */}
      <div className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
        <div className="mb-3 flex items-center gap-2">
          <Bell size={14} className={s.notice_enabled ? 'text-accent' : 'text-ink-dim'} />
          <h3 className="text-sm font-bold tracking-tight">메인페이지 공지 팝업</h3>
          <label className="ml-auto flex items-center gap-2 text-[11px] text-ink-mute">
            <input
              type="checkbox"
              checked={s.notice_enabled}
              onChange={(e) => setS({ ...s, notice_enabled: e.target.checked })}
              className="h-4 w-4 rounded border-line/30 bg-bg-card accent-accent"
            />
            {s.notice_enabled ? '표시 ON' : '표시 OFF'}
          </label>
        </div>

        <label className="block space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-ink-dim">제목</span>
          <input
            type="text"
            value={s.notice_title}
            onChange={(e) => setS({ ...s, notice_title: e.target.value })}
            className="input text-sm"
            maxLength={100}
          />
        </label>

        <label className="mt-3 block space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-ink-dim">본문</span>
          <textarea
            value={s.notice_body}
            onChange={(e) => setS({ ...s, notice_body: e.target.value })}
            className="input min-h-[160px] resize-y text-sm leading-relaxed"
            maxLength={2000}
          />
          <span className="text-[10px] text-ink-dim">{s.notice_body.length}/2000</span>
        </label>
      </div>

      <div className="flex items-center justify-end gap-2">
        <span className="text-[10px] text-ink-dim">
          마지막 저장: {new Date(s.updated_at).toLocaleString()}
        </span>
        <button onClick={handleSave} disabled={saving} className="btn-primary h-9">
          <Save size={14} />
          {saving ? '저장 중…' : '저장'}
        </button>
      </div>
    </section>
  );
}
