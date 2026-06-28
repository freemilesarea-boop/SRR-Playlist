import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ShieldAlert, AlertTriangle } from 'lucide-react';
import {
  listIntegrityLogs, integrityDuplicateSha, scanLegacyCorruption,
  type IntegrityLogRow, type DuplicateShaGroup, type LegacyCorruptionGroup,
} from '@/lib/uploadIntegrityApi';
import { toast } from '@/store/toastStore';

type View = 'logs' | 'duplicate' | 'legacy';
const dt = (s: string) => new Date(s).toLocaleString('ko-KR');

export default function UploadIntegrityPanel() {
  const [view, setView] = useState<View>('logs');
  const [days, setDays] = useState(7);
  const [filter, setFilter] = useState('all');
  const [logs, setLogs] = useState<IntegrityLogRow[]>([]);
  const [dups, setDups] = useState<DuplicateShaGroup[]>([]);
  const [legacy, setLegacy] = useState<LegacyCorruptionGroup[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (view === 'logs') setLogs(await listIntegrityLogs(days, filter, 300));
      else if (view === 'duplicate') setDups(await integrityDuplicateSha(30));
      else setLegacy(await scanLegacyCorruption(200));
    } catch (e) { toast.error(`불러오기 실패: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, [view, days, filter]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ShieldAlert size={18} className="text-accent" />
        <h2 className="text-base font-bold">업로드 무결성 검사</h2>
        <button onClick={() => void load()} className="ml-auto inline-flex items-center gap-1 rounded-lg bg-bg-card px-2.5 py-1.5 text-xs font-semibold hover:bg-bg-hover"><RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 새로고침</button>
      </div>
      <p className="text-[11px] text-ink-dim">실제 업로드된 오디오 콘텐츠(변환 후 MP3)의 sha 기준으로 중복/오염을 추적합니다. 자동 수정 없음 — 관리자 검수용.</p>

      <div className="flex flex-wrap gap-1.5">
        {([['logs', '업로드 로그'], ['duplicate', '동일 콘텐츠(SHA) 중복'], ['legacy', '기존 데이터 오염 의심']] as [View, string][]).map(([k, l]) => (
          <button key={k} onClick={() => setView(k)} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${view === k ? 'bg-accent text-black' : 'bg-bg-card text-ink-mute hover:bg-bg-hover'}`}>{l}</button>
        ))}
      </div>

      {view === 'logs' && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {[[1, '24시간'], [7, '7일'], [30, '30일']].map(([d, l]) => <button key={d} onClick={() => setDays(d as number)} className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${days === d ? 'bg-ink/80 text-bg' : 'bg-bg-card text-ink-mute hover:bg-bg-hover'}`}>{l}</button>)}
            <span className="mx-1 h-3 w-px bg-line" />
            {[['all', '전체'], ['failed', '실패만'], ['duplicate_sha', 'SHA중복만']].map(([f, l]) => <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${filter === f ? 'bg-ink/80 text-bg' : 'bg-bg-card text-ink-mute hover:bg-bg-hover'}`}>{l}</button>)}
          </div>
          {logs.length === 0 ? <p className="rounded-xl bg-bg-card px-4 py-8 text-center text-sm text-ink-dim">{loading ? '불러오는 중…' : '로그가 없어요.'}</p> : (
            <ul className="space-y-1">
              {logs.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-bg-card px-3 py-2 text-[10px]">
                  <span className="min-w-0 flex-1 truncate"><b>{l.original_filename ?? '?'}</b> · {l.artist_email ?? ''}</span>
                  {l.upload_status !== 'success' && <span className="rounded bg-rose-500/25 px-1.5 py-0.5 font-semibold text-rose-300">{l.upload_status}</span>}
                  {l.same_sha_count > 1 && <span className="rounded bg-rose-500/25 px-1.5 py-0.5 font-semibold text-rose-300">SHA중복 {l.same_sha_count}</span>}
                  {l.transcoded && <span className="rounded bg-bg-soft px-1.5 py-0.5 text-ink-mute">변환</span>}
                  <span className="font-mono text-ink-dim" title={l.final_audio_sha256 ?? ''}>{(l.final_audio_sha256 ?? '—').slice(0, 10)}</span>
                  <span className="text-ink-dim">{dt(l.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {view === 'duplicate' && (
        dups.length === 0 ? <p className="rounded-xl bg-bg-card px-4 py-8 text-center text-sm text-emerald-300">{loading ? '불러오는 중…' : '동일 콘텐츠 중복 없음 👍'}</p> : (
          <ul className="space-y-2">
            {dups.map((g) => (
              <li key={g.sha} className="rounded-lg bg-rose-500/5 p-3 text-[10px] ring-1 ring-rose-500/50">
                <p className="flex items-center gap-1.5 font-semibold text-rose-300"><AlertTriangle size={12} /> 동일 콘텐츠 {g.n}곡 · {g.artist_email ?? g.user_id} · <span className="font-mono">{g.sha.slice(0, 14)}</span></p>
                <ul className="mt-1 space-y-0.5 text-ink-mute">
                  {g.items.map((it, i) => <li key={i}>· {it.filename ?? '?'} <span className="text-ink-dim">({it.track_id?.slice(0, 8)} · {dt(it.at)})</span></li>)}
                </ul>
              </li>
            ))}
          </ul>
        )
      )}

      {view === 'legacy' && (
        <>
          <p className="text-[11px] text-amber-300">⚠ 휴리스틱 후보입니다. 동일 길이·콘텐츠 크기 + 다른 파일명이면 변환 race 오염 가능성. 실제 바이트 비교 후 판단하세요(자동 수정 안 함).</p>
          {legacy.length === 0 ? <p className="rounded-xl bg-bg-card px-4 py-8 text-center text-sm text-emerald-300">{loading ? '불러오는 중…' : '의심 후보 없음 👍'}</p> : (
            <ul className="space-y-2">
              {legacy.map((g, gi) => (
                <li key={gi} className="rounded-lg bg-amber-500/5 p-3 text-[10px] ring-1 ring-amber-500/50">
                  <p className="font-semibold text-amber-200">의심 {g.n}곡 · {g.duration}s · {g.audio_content_length}B</p>
                  <ul className="mt-1 space-y-0.5 text-ink-mute">
                    {g.tracks.map((t) => <li key={t.track_id}>· {t.title ?? '?'} <span className="text-ink-dim">({t.filename ?? ''} · {dt(t.created_at)})</span></li>)}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
