import { useCallback, useEffect, useState } from 'react';
import { Handshake, Loader2, Phone, Mail, MapPin } from 'lucide-react';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';
import {
  listSalesPartnerApplications, updateSalesPartnerApplication,
  type SalesPartnerApplication, type SalesPartnerStatus,
} from '@/lib/salesPartnerApi';

const STATUSES: SalesPartnerStatus[] = ['submitted', 'reviewing', 'contacted', 'approved', 'rejected'];
const STATUS_LABEL: Record<SalesPartnerStatus, string> = {
  submitted: '신규', reviewing: '검토중', contacted: '연락함', approved: '승인', rejected: '반려',
};
const STATUS_TONE: Record<SalesPartnerStatus, string> = {
  submitted: 'bg-violet-500/25 text-violet-600',
  reviewing: 'bg-amber-500/25 text-amber-300',
  contacted: 'bg-sky-500/25 text-sky-300',
  approved: 'bg-emerald-500/25 text-emerald-300',
  rejected: 'bg-rose-500/25 text-rose-300',
};

export default function SalesPartnerApplications() {
  const [rows, setRows] = useState<SalesPartnerApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<SalesPartnerStatus | 'all'>('all');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    listSalesPartnerApplications(filter === 'all' ? undefined : filter)
      .then(setRows)
      .catch((e) => toast.error(friendlyError(e)))
      .finally(() => setLoading(false));
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  async function setStatus(id: string, status: SalesPartnerStatus) {
    setBusy(id);
    try { await updateSalesPartnerApplication(id, status); toast.success(`상태 변경: ${STATUS_LABEL[status]}`); load(); }
    catch (e) { toast.error(friendlyError(e)); }
    finally { setBusy(null); }
  }
  async function saveNote(id: string, note: string) {
    setBusy(id);
    try { await updateSalesPartnerApplication(id, undefined, note); toast.success('메모 저장'); }
    catch (e) { toast.error(friendlyError(e)); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-bold"><Handshake size={15} className="text-violet-500" /> 영업 파트너 신청 ({rows.length})</h2>
        <select value={filter} onChange={(e) => setFilter(e.target.value as SalesPartnerStatus | 'all')} className="input w-auto text-xs">
          <option value="all">전체</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </header>

      {loading && <div className="flex items-center gap-2 text-xs text-ink-mute"><Loader2 size={14} className="animate-spin" /> 불러오는 중…</div>}
      {!loading && rows.length === 0 && <p className="text-xs text-ink-dim">신청이 없어요.</p>}

      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.id} className="rounded-xl bg-bg-card p-4 ring-1 ring-line/10">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold">{r.name}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_TONE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
              <span className="ml-auto text-[11px] text-ink-dim">{new Date(r.created_at).toLocaleString()}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-mute">
              <a href={`tel:${r.phone}`} className="inline-flex items-center gap-1 hover:text-ink"><Phone size={12} />{r.phone}</a>
              <a href={`mailto:${r.email}`} className="inline-flex items-center gap-1 hover:text-ink"><Mail size={12} />{r.email}</a>
              <span className="inline-flex items-center gap-1"><MapPin size={12} />{r.region}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {(r.target_business_types ?? []).map((t) => <span key={t} className="rounded bg-bg-soft px-1.5 py-0.5 text-[10px] ring-1 ring-line/10">{t}</span>)}
            </div>
            <div className="mt-2 grid gap-1 text-[12px] sm:grid-cols-2">
              <div><span className="text-ink-dim">영업경험</span> {r.has_sales_experience ? '있음' : '없음'}</div>
              <div><span className="text-ink-dim">예상 매장수</span> {r.expected_store_count ?? '-'}</div>
              {r.company_name && <div><span className="text-ink-dim">회사</span> {r.company_name}</div>}
            </div>
            {r.motivation && <p className="mt-2 rounded-lg bg-bg-soft/50 p-2 text-[12px] leading-relaxed"><span className="text-ink-dim">동기: </span>{r.motivation}</p>}
            {r.network_description && <p className="mt-1 rounded-lg bg-bg-soft/50 p-2 text-[12px] leading-relaxed"><span className="text-ink-dim">네트워크: </span>{r.network_description}</p>}
            {r.message && <p className="mt-1 rounded-lg bg-bg-soft/50 p-2 text-[12px] leading-relaxed"><span className="text-ink-dim">문의: </span>{r.message}</p>}

            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {STATUSES.map((s) => (
                <button key={s} type="button" disabled={busy === r.id || r.status === s} onClick={() => setStatus(r.id, s)}
                  className={`rounded px-2 py-1 text-[11px] font-semibold ring-1 disabled:opacity-40 ${r.status === s ? STATUS_TONE[s] + ' ring-transparent' : 'bg-bg-soft text-ink-mute ring-line/10 hover:text-ink'}`}>
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
            <div className="mt-2">
              <textarea defaultValue={r.admin_note ?? ''} placeholder="관리자 메모"
                onBlur={(e) => { if (e.target.value !== (r.admin_note ?? '')) void saveNote(r.id, e.target.value); }}
                rows={2} className="input text-[12px]" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
