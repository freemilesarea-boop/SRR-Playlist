import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ScrollText, AlertTriangle, Play, ListMusic } from 'lucide-react';
import {
  complianceSummary, listComplianceFlags, scanCompliance, resolveComplianceFlag,
  type ComplianceSummary, type ComplianceFlagRow,
} from '@/lib/complianceApi';
import { toast } from '@/store/toastStore';

const FLAG_LABEL: Record<string, string> = {
  missing_artist_profile: '프로필 없음', missing_contract: '계약 미완료', missing_payout_account: '계좌 미등록',
  missing_payment: '결제 미완료', invalid_user_role: '비정상 권한', released_without_compliance: '컴플라이언스 미충족 유통',
};
const FILTERS: [string, string][] = [
  ['all', '전체'], ['contract', '계약 미완료'], ['payout', '계좌 미등록'], ['payment', '결제 미완료'],
  ['profile', '프로필 없음'], ['released', 'released 곡'], ['playlist', 'playlist 포함'], ['stream', 'stream 발생'],
];

function Stat({ label, v, tone }: { label: string; v: number; tone?: 'rose' | 'amber' }) {
  return (
    <div className="rounded-xl bg-bg-card p-3 ring-1 ring-line/10">
      <p className="text-[10px] text-ink-dim">{label}</p>
      <p className={`mt-0.5 text-lg font-extrabold ${v > 0 && tone === 'rose' ? 'text-rose-600' : v > 0 && tone === 'amber' ? 'text-amber-600' : ''}`}>{v}</p>
    </div>
  );
}

export default function CompliancePanel() {
  const [summary, setSummary] = useState<ComplianceSummary | null>(null);
  const [rows, setRows] = useState<ComplianceFlagRow[]>([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { const [s, r] = await Promise.all([complianceSummary(), listComplianceFlags(filter, 300)]); setSummary(s); setRows(r); }
    catch (e) { toast.error(`불러오기 실패: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, [filter]);
  useEffect(() => { void load(); }, [load]);

  async function rescan() {
    setBusy(true);
    try { const r = await scanCompliance(); toast.success(`전수 감사 완료 — 플래그 ${r.flags_upserted}건`); await load(); }
    catch (e) { toast.error(`감사 실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }
  async function resolve(trackId: string, status: string) {
    setBusy(true);
    try { await resolveComplianceFlag(trackId, status); toast.success('처리됨'); await load(); }
    catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ScrollText size={18} className="text-accent" />
        <h2 className="text-base font-bold">아티스트 컴플라이언스 (계약/정산/결제)</h2>
        <button onClick={() => void rescan()} disabled={busy} className="ml-auto rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-black disabled:opacity-50">전수 감사 실행</button>
        <button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-lg bg-bg-card px-2.5 py-1.5 text-xs font-semibold hover:bg-bg-hover"><RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 새로고침</button>
      </div>
      <p className="text-[11px] text-ink-dim">유통(released/approved/scheduled) 곡 중 아티스트 프로필·계약·정산계좌·결제 미충족 곡을 탐지합니다. 자동 삭제/비공개 없음 — 관리자 검수. (결제 조건은 정책 미정 → medium 표시)</p>

      {summary && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          <Stat label="미충족 유통곡" v={summary.released_noncompliant} tone="rose" />
          <Stat label="계약 미완료" v={summary.missing_contract} tone="rose" />
          <Stat label="계좌 미등록" v={summary.missing_payout} tone="rose" />
          <Stat label="결제 미완료" v={summary.missing_payment} tone="amber" />
          <Stat label="프로필 없음" v={summary.missing_profile} tone="rose" />
          <Stat label="문제 아티스트" v={summary.flagged_artists} />
          <Stat label="playlist 포함" v={summary.in_playlist_flagged} tone="amber" />
          <Stat label="stream 발생" v={summary.streamed_flagged} tone="amber" />
          <Stat label="정산 포함" v={summary.in_settlement_flagged} tone="rose" />
          <Stat label="open 플래그" v={summary.open_flags} />
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map(([f, l]) => <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${filter === f ? 'bg-accent text-black' : 'bg-bg-card text-ink-mute hover:bg-bg-hover'}`}>{l}</button>)}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl bg-bg-card px-4 py-10 text-center text-sm text-emerald-600">{loading ? '불러오는 중…' : '컴플라이언스 위반 곡이 없습니다 👍 (전수 감사 결과 0건)'}</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.id} className="rounded-lg bg-bg-card p-3 text-[11px] ring-1 ring-line/10">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-semibold">{r.title ?? '(제목없음)'} <span className="text-ink-dim">· {r.artist_email ?? ''} · {r.release_status}</span></span>
                {r.severity === 'critical' && <span className="inline-flex items-center gap-0.5 rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-bold text-rose-600"><AlertTriangle size={10} /> critical</span>}
                {r.has_stream && <Play size={11} className="text-amber-600" />}
                {r.in_playlist && <ListMusic size={11} className="text-amber-600" />}
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {(r.all_flags ?? []).map((f) => <span key={f} className="rounded bg-rose-500/10 px-1.5 py-0.5 text-[10px] text-rose-600">{FLAG_LABEL[f] ?? f}</span>)}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1 text-[10px]">
                <button disabled={busy} onClick={() => void resolve(r.track_id, 'resolved')} className="rounded bg-emerald-500/10 px-2 py-1 font-semibold text-emerald-600 disabled:opacity-40">처리완료</button>
                <button disabled={busy} onClick={() => void resolve(r.track_id, 'dismissed')} className="rounded bg-ink/5 px-2 py-1 font-semibold text-ink-mute disabled:opacity-40">문제 없음</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
