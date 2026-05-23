import { useCallback, useEffect, useState } from 'react';
import { Ticket, Plus, Copy, CheckCircle2 } from 'lucide-react';
import {
  adminGenerateArtistInviteCode,
  adminListArtistInviteCodes,
  type ArtistInviteCode,
} from '@/lib/artistApi';
import { toast } from '@/store/toastStore';

export default function ArtistInviteCodes() {
  const [codes, setCodes] = useState<ArtistInviteCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCodes(await adminListArtistInviteCodes(200));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function generate() {
    setBusy(true);
    try {
      const code = await adminGenerateArtistInviteCode(note.trim() || undefined, null);
      toast.success(`초대코드 발급: ${code}`);
      setNote('');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function statusOf(c: ArtistInviteCode): { label: string; tone: string } {
    if (c.used_by) return { label: '사용됨', tone: 'bg-ink/10 text-ink-mute' };
    if (!c.is_active) return { label: '비활성', tone: 'bg-red-500/15 text-red-300' };
    if (c.expires_at && new Date(c.expires_at) <= new Date())
      return { label: '만료', tone: 'bg-amber-500/15 text-amber-300' };
    return { label: '사용 가능', tone: 'bg-emerald-500/15 text-emerald-300' };
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="flex items-center gap-1.5 text-lg font-bold tracking-tight">
          <Ticket size={16} className="text-accent" /> 아티스트 초대코드
        </h2>
        <p className="text-xs text-ink-mute">
          아티스트 가입/전환은 유효한 초대코드가 있어야만 가능합니다. 코드는 1회만 사용됩니다.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-2xl bg-bg-card p-3 ring-1 ring-line/10">
        <label className="flex-1 space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-dim">메모 (선택)</span>
          <input
            className="input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="예: 5월 아티스트 모집 / 홍길동"
          />
        </label>
        <button
          onClick={() => void generate()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-bg hover:opacity-90 disabled:opacity-50"
        >
          <Plus size={14} /> {busy ? '발급 중…' : '코드 발급'}
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-xs">
            <thead className="border-b border-line/10 text-[10px] uppercase text-ink-dim">
              <tr>
                <th className="px-3 py-2 text-left">코드</th>
                <th className="px-3 py-2 text-left">상태</th>
                <th className="px-3 py-2 text-left">메모</th>
                <th className="px-3 py-2 text-left">사용자</th>
                <th className="px-3 py-2 text-left">발급일</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-ink-mute">불러오는 중…</td></tr>
              )}
              {!loading && codes.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-ink-mute">발급된 코드가 없어요.</td></tr>
              )}
              {codes.map((c) => {
                const st = statusOf(c);
                return (
                  <tr key={c.id} className="border-b border-line/10 last:border-b-0">
                    <td className="px-3 py-2 font-mono font-semibold">{c.code}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${st.tone}`}>{st.label}</span>
                    </td>
                    <td className="px-3 py-2 text-ink-mute">{c.note ?? '—'}</td>
                    <td className="px-3 py-2 font-mono text-[10px] text-ink-dim">{c.used_by ? c.used_by.slice(0, 8) + '…' : '—'}</td>
                    <td className="px-3 py-2 text-ink-dim">{new Date(c.created_at).toLocaleDateString('ko-KR')}</td>
                    <td className="px-3 py-2 text-right">
                      {!c.used_by && (
                        <button
                          onClick={() => {
                            void navigator.clipboard?.writeText(c.code);
                            toast.info('코드 복사됨');
                          }}
                          className="inline-flex items-center gap-1 rounded-md bg-bg-soft px-2 py-1 text-[10px] font-semibold text-ink-mute ring-1 ring-line/10 hover:text-ink"
                        >
                          <Copy size={11} /> 복사
                        </button>
                      )}
                      {c.used_by && <CheckCircle2 size={12} className="ml-auto text-ink-dim" />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
