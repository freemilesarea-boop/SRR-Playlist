/**
 * 본사 > 브랜드 콘텐츠 > 안내방송 — 안내 음원과 방송 일정.
 * 정해진 시각에 매장 음악을 잠깐 멈추고 안내가 나간다.
 * 안내방송은 운영사 검수 없이 저장 즉시 매장에 반영된다 (0551).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Mic, Pause, Play, Plus, Power, RefreshCw, Trash2, Upload } from 'lucide-react';
import AnnouncementStatusView from '@/components/announcement/AnnouncementStatusView';
import { getHqAnnouncementStatus, type AnnouncementStatusDetail } from '@/lib/api/announcementApi';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';
import RecurrenceRuleBuilder from '@/components/admin/RecurrenceRuleBuilder';
import {
  describeRecurrence, describeScope, removeRequestUpload, submitContentRequest, summarizeRequest, uploadHqAnnouncement,
  HQ_KIND_LABEL,
  type HqBrandContent, type HqScopeType, type HqSchedule,
} from '@/lib/api/hqContentApi';
import { Card, NoteInput, PendingRow, ResponsibilityCheck } from './shared';

const AUDIO_ACCEPT = 'audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/aac,audio/ogg';

export default function AnnounceTab({ data, onChanged, onCancel }: {
  data: HqBrandContent; onChanged: () => void; onCancel: (id: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [assetTitle, setAssetTitle] = useState('');
  const [agree, setAgree] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [assetChoice, setAssetChoice] = useState('');
  const [rule, setRule] = useState<string | null>('daily:12:00');
  const [scope, setScope] = useState<HqScopeType>('enterprise');
  const [regionId, setRegionId] = useState('');
  const [storeIds, setStoreIds] = useState<string[]>([]);
  const [note, setNote] = useState('');

  // 탭을 떠나거나 새로 그려질 때 미리듣기를 멈춘다(멈출 버튼이 사라지므로).
  useEffect(() => () => { audioRef.current?.pause(); }, []);

  const pendingAssets = data.requests.filter((r) => r.kind === 'announcement_asset_add' && r.status === 'pending');
  const pendingSchedules = data.requests.filter((r) => r.kind === 'schedule_create' && r.status === 'pending');
  const assetTitleOf = (id: string) => data.announcement_assets.find((a) => a.id === id)?.title ?? '음원';
  const pendingFor = (kind: 'announcement_asset_delete' | 'schedule_update' | 'schedule_delete', key: string, id: string) =>
    data.requests.find((r) => r.status === 'pending' && r.kind === kind && r.payload[key] === id);

  function togglePlay(id: string, url: string) {
    if (playing === id) { audioRef.current?.pause(); setPlaying(null); return; }
    audioRef.current?.pause();
    const a = new Audio(url);
    audioRef.current = a;
    a.onended = () => setPlaying(null);
    void a.play().then(() => setPlaying(id)).catch(() => toast.error('재생하지 못했어요'));
  }

  async function uploadAsset() {
    if (!file) { toast.error('음원 파일을 골라 주세요'); return; }
    if (!assetTitle.trim()) { toast.error('음원 이름을 적어 주세요'); return; }
    if (!agree) { toast.error('저작권·내용 책임 확인에 체크해 주세요'); return; }
    setBusy('upload');
    let uploaded: { file_path: string } | null = null;
    try {
      const up = await uploadHqAnnouncement(data.enterprise.id, file);
      uploaded = up;
      await submitContentRequest('announcement_asset_add', { ...up, title: assetTitle.trim() });
      toast.success('올렸어요. 바로 일정에 쓸 수 있어요.');
      setFile(null); setAssetTitle(''); setAgree(false);
      if (fileRef.current) fileRef.current.value = '';
      onChanged();
    } catch (e) {
      // 파일은 올라갔는데 요청 전송이 실패하면 그 파일을 바로 지운다.
      if (uploaded) void removeRequestUpload({ kind: 'announcement_asset_add', payload: uploaded }).catch(() => undefined);
      toast.error(friendlyError(e, '올리지 못했어요'));
    }
    finally { setBusy(null); }
  }

  async function createSchedule() {
    if (!name.trim()) { toast.error('일정 이름을 적어 주세요'); return; }
    if (!assetChoice) { toast.error('틀 음원을 골라 주세요'); return; }
    if (!rule) { toast.error('언제 틀지 정해 주세요'); return; }
    if (scope === 'region' && !regionId) { toast.error('지역을 골라 주세요'); return; }
    if (scope === 'store' && storeIds.length === 0) { toast.error('매장을 하나 이상 골라 주세요'); return; }
    const [src, id] = assetChoice.split(':');
    setBusy('schedule');
    try {
      await submitContentRequest('schedule_create', {
        name: name.trim(),
        ...(src === 'req' ? { asset_request_id: id } : { asset_id: id }),
        recurrence_rule: rule,
        scope_type: scope,
        ...(scope === 'region' ? { region_id: regionId } : {}),
        ...(scope === 'store' ? { store_ids: storeIds } : {}),
      }, note);
      toast.success('일정을 저장했어요. 정한 시간부터 매장에서 나가요.');
      setShowForm(false); setName(''); setAssetChoice(''); setNote(''); setStoreIds([]);
      onChanged();
    } catch (e) { toast.error(friendlyError(e, '저장하지 못했어요')); }
    finally { setBusy(null); }
  }

  async function scheduleAction(s: HqSchedule, kind: 'schedule_update' | 'schedule_delete') {
    if (kind === 'schedule_delete' && !window.confirm(`"${s.name}" 일정을 지울까요?`)) return;
    setBusy(s.id);
    try {
      await submitContentRequest(kind, kind === 'schedule_delete'
        ? { schedule_id: s.id }
        : { schedule_id: s.id, status: s.status === 'active' ? 'paused' : 'active' });
      toast.success(kind === 'schedule_delete' ? '일정을 지웠어요.' : s.status === 'active' ? '일정을 멈췄어요.' : '일정을 다시 켰어요.');
      onChanged();
    } catch (e) { toast.error(friendlyError(e, '바꾸지 못했어요')); }
    finally { setBusy(null); }
  }

  async function deleteAsset(id: string, title: string) {
    const used = data.schedules.filter((s) => s.asset_id === id).length;
    if (!window.confirm(`"${title}" 음원을 지울까요?${used ? ` 이 음원을 쓰는 일정 ${used}개는 더 이상 나가지 않아요.` : ''}`)) return;
    setBusy(id);
    try {
      await submitContentRequest('announcement_asset_delete', { asset_id: id });
      toast.success('음원을 지웠어요.');
      onChanged();
    } catch (e) { toast.error(friendlyError(e, '지우지 못했어요')); }
    finally { setBusy(null); }
  }

  const regionName = (id: string | null) => data.regions.find((r) => r.id === id)?.name ?? null;

  return (
    <div className="space-y-3">
      <StatusCard />

      <Card title="안내 음원" subtitle="MP3·WAV·M4A, 20MB까지. 매장 음악을 잠깐 멈추고 이 음원이 나가요.">
        {pendingAssets.length > 0 && (
          <div className="mb-3 space-y-1.5">
            {pendingAssets.map((r) => <PendingRow key={r.id} req={r} summary={summarizeRequest(r)} onCancel={onCancel} />)}
          </div>
        )}
        {data.announcement_assets.length === 0 ? (
          <p className="rounded-xl bg-bg-soft p-4 text-center text-[12px] text-ink-mute">아직 등록된 안내 음원이 없어요.</p>
        ) : (
          <ul className="divide-y divide-line/10">
            {data.announcement_assets.map((a) => {
              const pending = pendingFor('announcement_asset_delete', 'asset_id', a.id);
              return (
                <li key={a.id} className="flex items-center gap-2 py-2">
                  <button type="button" onClick={() => togglePlay(a.id, a.file_url)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent" aria-label="듣기">
                    {playing === a.id ? <Pause size={14} /> : <Play size={14} />}
                  </button>
                  <p className="min-w-0 flex-1 truncate text-sm font-semibold">{a.title}</p>
                  {pending ? (
                    <span className="shrink-0 rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">삭제 검수 대기</span>
                  ) : (
                    <button type="button" disabled={busy !== null} onClick={() => void deleteAsset(a.id, a.title)}
                      title="삭제" className="shrink-0 rounded-md p-1.5 text-ink-mute hover:bg-bg-hover hover:text-rose-500 disabled:opacity-40">
                      <Trash2 size={15} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-3 space-y-2 border-t border-line/10 pt-3">
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-line/40 p-3 text-sm hover:bg-bg-hover">
            <Mic size={16} className="text-accent" />
            <span className="min-w-0 flex-1 truncate">{file ? file.name : '음원 파일 고르기'}</span>
            <input ref={fileRef} type="file" accept={AUDIO_ACCEPT} className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                if (f && !assetTitle) setAssetTitle(f.name.replace(/\.[^.]+$/, ''));
              }} />
          </label>
          <input value={assetTitle} onChange={(e) => setAssetTitle(e.target.value)} maxLength={60}
            placeholder="음원 이름 — 예: 마감 30분 전 안내" className="input w-full text-sm" />
          <ResponsibilityCheck checked={agree} onChange={setAgree} />
          <button type="button" onClick={() => void uploadAsset()} disabled={busy !== null || !file || !agree}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-bg-soft py-2 text-sm font-semibold hover:bg-bg-hover disabled:opacity-50">
            {busy === 'upload' ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} 음원 올리기
          </button>
        </div>
      </Card>

      <Card
        title="방송 일정"
        subtitle="정해진 시각에 매장 음악을 잠깐 멈추고 안내가 나가요."
        action={!showForm && (
          <button type="button" onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-[12px] font-bold text-bg">
            <Plus size={13} /> 일정 추가
          </button>
        )}
      >
        {pendingSchedules.length > 0 && (
          <div className="mb-3 space-y-1.5">
            {pendingSchedules.map((r) => {
              const assetReq = data.requests.find((x) => x.id === r.payload.asset_request_id);
              return (
                <PendingRow key={r.id} req={r} onCancel={onCancel} summary={summarizeRequest(r, {
                  assetTitle: typeof r.payload.asset_id === 'string' ? assetTitleOf(r.payload.asset_id)
                    : (assetReq?.payload.title as string | undefined) ?? null,
                  regionName: regionName((r.payload.region_id as string) ?? null),
                })} />
              );
            })}
          </div>
        )}

        {showForm && (
          <div className="mb-3 space-y-2.5 rounded-xl bg-bg-soft p-3">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60}
              placeholder="일정 이름 — 예: 마감 30분 전" className="input w-full text-sm" />
            <select value={assetChoice} onChange={(e) => setAssetChoice(e.target.value)} className="input w-full text-sm" aria-label="틀 음원">
              <option value="">틀 음원 고르기</option>
              {data.announcement_assets.map((a) => <option key={a.id} value={`asset:${a.id}`}>{a.title}</option>)}
              {pendingAssets.map((r) => <option key={r.id} value={`req:${r.id}`}>{String(r.payload.title)}</option>)}
            </select>
            <RecurrenceRuleBuilder value={rule} onChange={setRule} />
            <div className="grid grid-cols-3 gap-1.5">
              {(['enterprise', 'region', 'store'] as const).map((s) => (
                <button key={s} type="button" onClick={() => setScope(s)}
                  disabled={s === 'region' && data.regions.length === 0}
                  className={`rounded-lg py-1.5 text-[12px] font-semibold transition disabled:opacity-40 ${scope === s ? 'bg-accent text-bg' : 'bg-bg-card text-ink-mute hover:text-ink'}`}>
                  {s === 'enterprise' ? '전체 가맹점' : s === 'region' ? '지역' : '매장 고르기'}
                </button>
              ))}
            </div>
            {scope === 'region' && (
              <select value={regionId} onChange={(e) => setRegionId(e.target.value)} className="input w-full text-sm" aria-label="지역">
                <option value="">지역 고르기</option>
                {data.regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            )}
            {scope === 'store' && (
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg bg-bg-card p-2">
                {data.stores.length === 0 && <p className="text-[12px] text-ink-mute">연결된 매장이 없어요.</p>}
                {data.stores.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-[12px]">
                    <input type="checkbox" checked={storeIds.includes(s.id)}
                      onChange={() => setStoreIds(storeIds.includes(s.id) ? storeIds.filter((x) => x !== s.id) : [...storeIds, s.id])} />
                    {s.name}
                  </label>
                ))}
              </div>
            )}
            <NoteInput value={note} onChange={setNote} />
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowForm(false)}
                className="flex-1 rounded-lg bg-bg-card py-2 text-sm font-semibold hover:bg-bg-hover">취소</button>
              <button type="button" onClick={() => void createSchedule()} disabled={busy !== null}
                className="btn-primary inline-flex flex-[2] items-center justify-center gap-1.5 py-2 text-sm disabled:opacity-50">
                {busy === 'schedule' && <Loader2 size={14} className="animate-spin" />} 일정 저장
              </button>
            </div>
          </div>
        )}

        {data.schedules.length === 0 ? (
          !showForm && <p className="rounded-xl bg-bg-soft p-4 text-center text-[12px] text-ink-mute">아직 방송 일정이 없어요.</p>
        ) : (
          <ul className="divide-y divide-line/10">
            {data.schedules.map((s) => {
              const pending = pendingFor('schedule_update', 'schedule_id', s.id) ?? pendingFor('schedule_delete', 'schedule_id', s.id);
              const on = s.status === 'active';
              return (
                <li key={s.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{s.name}</p>
                    <p className="truncate text-[11px] text-ink-mute">
                      {describeRecurrence(s.recurrence_rule)} · {describeScope(s.scope_type, { regionName: regionName(s.region_id), storeCount: s.store_ids.length })} · {assetTitleOf(s.asset_id)}
                    </p>
                  </div>
                  {pending ? (
                    <span className="shrink-0 rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">
                      {HQ_KIND_LABEL[pending.kind].replace('안내방송 일정 ', '')} 검수 대기
                    </span>
                  ) : (
                    <>
                      <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold ${on ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200' : 'bg-bg-hover text-ink-mute'}`}>
                        {on ? '켜짐' : '꺼짐'}
                      </span>
                      <button type="button" disabled={busy !== null} onClick={() => void scheduleAction(s, 'schedule_update')}
                        title={on ? '일시중지' : '다시 켜기'} className="shrink-0 rounded-md p-1.5 text-ink-mute hover:bg-bg-hover hover:text-ink disabled:opacity-40">
                        <Power size={15} />
                      </button>
                      <button type="button" disabled={busy !== null} onClick={() => void scheduleAction(s, 'schedule_delete')}
                        title="삭제" className="shrink-0 rounded-md p-1.5 text-ink-mute hover:bg-bg-hover hover:text-rose-500 disabled:opacity-40">
                        <Trash2 size={15} />
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** 0555 — 송출 현황: 안내 전용 플레이어 켜짐/꺼짐 + 오늘 매장별 결과 (1분마다 갱신). */
function StatusCard() {
  const [data, setData] = useState<AnnouncementStatusDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    getHqAnnouncementStatus()
      .then((d) => { setData(d); setFailed(false); })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const t = window.setInterval(load, 60_000);
    return () => window.clearInterval(t);
  }, [load]);

  return (
    <Card
      title="송출 현황"
      subtitle="매장 안내 전용 플레이어 상태와 오늘 나간 안내방송. 꺼지거나 실패하면 알림센터로도 알려드려요."
      action={(
        <button type="button" onClick={load} disabled={loading} aria-label="새로고침"
          className="rounded-md p-1.5 text-ink-mute hover:bg-bg-hover hover:text-ink disabled:opacity-40">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      )}
    >
      {data ? <AnnouncementStatusView data={data} />
        : failed ? <p className="text-[12px] text-ink-mute">현황을 불러오지 못했어요.</p>
        : <p className="text-[12px] text-ink-mute">불러오는 중…</p>}
    </Card>
  );
}
