import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, UserPlus, ShieldCheck, History } from 'lucide-react';
import {
  listAdmins, addAdmin, updateAdminRole, setAdminActive, fetchAdminActionLog,
  ADMIN_ROLE_LABELS, type AdminUserRow, type AdminActionLogRow, type AdminRole,
} from '@/lib/adminRbacApi';
import { toast } from '@/store/toastStore';

const ROLES: AdminRole[] = ['super_admin', 'content_admin', 'curator_admin', 'sales_admin', 'reviewer'];

export default function AdminUsersList() {
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [log, setLog] = useState<AdminActionLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AdminRole>('content_admin');
  const [showLog, setShowLog] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { const [a, l] = await Promise.all([listAdmins(), fetchAdminActionLog(50)]); setRows(a); setLog(l); }
    catch (e) { toast.error(`불러오기 실패: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function doAdd() {
    if (!email.trim()) { toast.error('이메일을 입력하세요'); return; }
    setBusy(true);
    try { const r = await addAdmin(email.trim(), role); toast.success(r.linked ? '관리자 추가 완료' : '관리자 추가 — 해당 이메일 가입 시 자동 연결됩니다'); setEmail(''); await load(); }
    catch (e) { toast.error(`추가 실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }
  async function changeRole(id: string, r: AdminRole) {
    setBusy(true);
    try { await updateAdminRole(id, r); toast.success('역할 변경됨'); await load(); }
    catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }
  async function toggleActive(row: AdminUserRow) {
    if (!window.confirm(`${row.email} 을(를) ${row.is_active ? '비활성화' : '활성화'}할까요?`)) return;
    setBusy(true);
    try { await setAdminActive(row.id, !row.is_active); toast.success(row.is_active ? '비활성화됨' : '활성화됨'); await load(); }
    catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ShieldCheck size={18} className="text-accent" />
        <h2 className="text-base font-bold">관리자 설정 (역할 기반 권한)</h2>
        <button onClick={() => void load()} className="ml-auto inline-flex items-center gap-1 rounded-lg bg-bg-card px-2.5 py-1.5 text-xs font-semibold hover:bg-bg-hover"><RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 새로고침</button>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-xl bg-bg-card p-3 ring-1 ring-line/10">
        <label className="flex-1 min-w-[200px] text-[11px] font-semibold text-ink-mute">관리자 이메일
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@example.com" type="email"
            className="mt-1 w-full rounded-lg bg-bg-deep px-3 py-2 text-sm ring-1 ring-line/15 focus:outline-none focus:ring-accent/60" />
        </label>
        <label className="text-[11px] font-semibold text-ink-mute">역할
          <select value={role} onChange={(e) => setRole(e.target.value as AdminRole)} className="mt-1 block rounded-lg bg-bg-deep px-3 py-2 text-sm ring-1 ring-line/15">
            {ROLES.map((r) => <option key={r} value={r}>{ADMIN_ROLE_LABELS[r]}</option>)}
          </select>
        </label>
        <button disabled={busy} onClick={() => void doAdd()} className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-2 text-xs font-bold text-black disabled:opacity-50"><UserPlus size={13} /> 관리자 추가</button>
      </div>

      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-bg-card px-3 py-2 text-[11px] ring-1 ring-line/10">
            <span className="min-w-0 flex-1 truncate font-semibold">{r.email} {!r.linked && <span className="text-[10px] font-normal text-ink-dim">(미연결)</span>}</span>
            <select value={r.role} disabled={busy} onChange={(e) => void changeRole(r.id, e.target.value as AdminRole)}
              className="rounded bg-bg-soft px-2 py-1 text-[11px] ring-1 ring-line/10">
              {ROLES.map((x) => <option key={x} value={x}>{ADMIN_ROLE_LABELS[x]}</option>)}
            </select>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${r.is_active ? 'bg-emerald-500/25 text-emerald-300' : 'bg-ink/10 text-ink-mute'}`}>{r.is_active ? '활성' : '비활성'}</span>
            <span className="text-[10px] text-ink-dim">최근활동 {r.last_action_at ? new Date(r.last_action_at).toLocaleDateString('ko-KR') : '—'}</span>
            <button disabled={busy} onClick={() => void toggleActive(r)} className={`rounded px-2 py-1 text-[10px] font-semibold ${r.is_active ? 'bg-rose-500/20 text-rose-300' : 'bg-emerald-500/20 text-emerald-300'} disabled:opacity-50`}>{r.is_active ? '비활성화' : '활성화'}</button>
          </li>
        ))}
        {rows.length === 0 && <p className="rounded-xl bg-bg-card px-4 py-8 text-center text-sm text-ink-dim">{loading ? '불러오는 중…' : '관리자가 없어요.'}</p>}
      </ul>

      <div>
        <button onClick={() => setShowLog((v) => !v)} className="flex items-center gap-1 text-[11px] font-semibold text-ink-mute hover:text-ink"><History size={12} /> 관리자 활동 로그 {showLog ? '▲' : '▼'}</button>
        {showLog && (
          <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto rounded-xl bg-bg-card p-2.5 text-[10px] ring-1 ring-line/10">
            {log.map((l) => (
              <li key={l.id} className="border-b border-line/5 pb-1 last:border-0">
                <span className="text-ink-dim">{new Date(l.created_at).toLocaleString('ko-KR')}</span> · <b>{l.actor_email ?? '?'}</b> · {l.action} {l.target_email ? `→ ${l.target_email}` : ''}
              </li>
            ))}
            {log.length === 0 && <li className="text-ink-dim">기록 없음</li>}
          </ul>
        )}
      </div>
    </div>
  );
}
