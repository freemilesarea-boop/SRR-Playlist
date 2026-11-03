/**
 * 본사 > 브랜드 콘텐츠 > 매장 화면·광고 — 브랜드 플레이어 화면(TV·모니터)에 도는 이미지·영상.
 * 올리기·표시 중지·삭제 모두 검수 요청으로 남는다.
 */
import { useRef, useState } from 'react';
import { EyeOff, Eye, Film, Image as ImageIcon, Loader2, Trash2, Upload } from 'lucide-react';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';
import { IMAGE_MIME_TYPES, VIDEO_MIME_TYPES, isVideoMime } from '@/lib/brandMediaType';
import {
  submitContentRequest, summarizeRequest, uploadHqMedia, HQ_KIND_LABEL,
  type HqBrandContent, type HqBrandMedia,
} from '@/lib/api/hqContentApi';
import { Card, NoteInput, PendingRow, ResponsibilityCheck } from './shared';
import { dateInputToIso, formatPeriod } from './format';

function isLive(m: HqBrandMedia): boolean {
  const now = Date.now();
  if (m.status !== 'active') return false;
  if (m.starts_at && new Date(m.starts_at).getTime() > now) return false;
  if (m.ends_at && new Date(m.ends_at).getTime() < now) return false;
  return true;
}

export default function ScreenTab({ data, onChanged, onCancel }: {
  data: HqBrandContent; onChanged: () => void; onCancel: (id: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [seconds, setSeconds] = useState('10');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [agree, setAgree] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  if (!data.brand) {
    return (
      <Card
        title="브랜드 플레이어가 아직 연결되지 않았어요"
        subtitle="매장 화면은 브랜드 플레이어가 연결된 뒤 관리할 수 있어요. 운영사에 문의해 주세요."
      />
    );
  }
  const brandId = data.brand.id;
  const pendingAdds = data.requests.filter((r) => r.kind === 'media_add' && r.status === 'pending');
  const pendingFor = (id: string) =>
    data.requests.find((r) => (r.kind === 'media_update' || r.kind === 'media_delete')
      && r.status === 'pending' && r.payload.asset_id === id);

  async function upload() {
    if (!file) { toast.error('파일을 골라 주세요'); return; }
    if (!agree) { toast.error('저작권·내용 책임 확인에 체크해 주세요'); return; }
    if (startDate && endDate && endDate < startDate) { toast.error('끝나는 날이 시작일보다 빨라요'); return; }
    setBusy('upload');
    try {
      const up = await uploadHqMedia(data.enterprise.id, brandId, file);
      await submitContentRequest('media_add', {
        ...up,
        title: title.trim() || file.name.replace(/\.[^.]+$/, ''),
        display_duration_seconds: Math.max(3, Math.min(600, Number(seconds) || 10)),
        starts_at: dateInputToIso(startDate),
        ends_at: dateInputToIso(endDate, true),
      }, note);
      toast.success('올렸어요. 운영사 검수 후 매장 화면에 나와요.');
      setFile(null); setTitle(''); setStartDate(''); setEndDate(''); setNote(''); setAgree(false);
      if (fileRef.current) fileRef.current.value = '';
      onChanged();
    } catch (e) { toast.error(friendlyError(e, '올리지 못했어요')); }
    finally { setBusy(null); }
  }

  async function request(kind: 'media_update' | 'media_delete', m: HqBrandMedia) {
    if (kind === 'media_delete' && !window.confirm(`"${m.title ?? '제목 없음'}"을(를) 매장 화면에서 지울까요? (검수 후 반영)`)) return;
    setBusy(m.id);
    try {
      await submitContentRequest(kind, kind === 'media_delete'
        ? { asset_id: m.id }
        : { asset_id: m.id, status: m.status === 'active' ? 'inactive' : 'active' });
      toast.success('검수 요청을 보냈어요.');
      onChanged();
    } catch (e) { toast.error(friendlyError(e, '요청을 보내지 못했어요')); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-3">
      <Card
        title="매장 화면에 도는 이미지·영상"
        subtitle="브랜드 플레이어 화면(TV·모니터)에 순서대로 보여요. 음악은 그대로 나와요."
      >
        {pendingAdds.length > 0 && (
          <div className="mb-3 space-y-1.5">
            {pendingAdds.map((r) => <PendingRow key={r.id} req={r} summary={summarizeRequest(r)} onCancel={onCancel} />)}
          </div>
        )}
        {data.media.length === 0 ? (
          <p className="rounded-xl bg-bg-soft p-4 text-center text-[12px] text-ink-mute">아직 등록된 이미지·영상이 없어요.</p>
        ) : (
          <ul className="divide-y divide-line/10">
            {data.media.map((m) => {
              const pending = pendingFor(m.id);
              const live = isLive(m);
              return (
                <li key={m.id} className="flex items-center gap-3 py-2.5">
                  <div className="h-12 w-20 shrink-0 overflow-hidden rounded-lg bg-bg-soft">
                    {m.asset_type === 'video'
                      ? (m.thumbnail_url
                          ? <img src={m.thumbnail_url} alt="" className="h-full w-full object-cover" />
                          : <div className="flex h-full items-center justify-center text-ink-mute"><Film size={18} /></div>)
                      : <img src={m.url} alt="" className="h-full w-full object-cover" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{m.title ?? '제목 없음'}</p>
                    <p className="text-[11px] text-ink-mute">
                      {m.asset_type === 'video' ? '영상' : `이미지 · ${m.display_duration_seconds}초`} · {formatPeriod(m.starts_at, m.ends_at)}
                    </p>
                  </div>
                  {pending ? (
                    <span className="shrink-0 rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">
                      {HQ_KIND_LABEL[pending.kind].replace('매장 화면 ', '')} 검수 대기
                    </span>
                  ) : (
                    <>
                      <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold ${live ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200' : 'bg-bg-hover text-ink-mute'}`}>
                        {live ? '표시 중' : m.status === 'active' ? '기간 아님' : '중지됨'}
                      </span>
                      <button type="button" disabled={busy !== null} onClick={() => void request('media_update', m)}
                        title={m.status === 'active' ? '표시 중지' : '다시 표시'}
                        className="shrink-0 rounded-md p-1.5 text-ink-mute hover:bg-bg-hover hover:text-ink disabled:opacity-40">
                        {m.status === 'active' ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                      <button type="button" disabled={busy !== null} onClick={() => void request('media_delete', m)}
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

      <Card title="새로 올리기" subtitle="이미지(JPG·PNG·WEBP·GIF, 10MB까지) 또는 영상(MP4·WEBM·MOV, 50MB까지).">
        <div className="space-y-2.5">
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-line/40 p-3 text-sm hover:bg-bg-hover">
            {file && isVideoMime(file.type) ? <Film size={16} className="text-accent" /> : <ImageIcon size={16} className="text-accent" />}
            <span className="min-w-0 flex-1 truncate">{file ? file.name : '파일 고르기'}</span>
            <input
              ref={fileRef}
              type="file"
              accept={[...IMAGE_MIME_TYPES, ...VIDEO_MIME_TYPES].join(',')}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="hidden"
            />
          </label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} placeholder="제목 — 예: 11월 신메뉴 홍보" className="input w-full text-sm" />
          <div className="grid grid-cols-3 gap-2">
            <label className="text-[11px] text-ink-mute">
              보여 줄 시간(초)
              <input value={seconds} onChange={(e) => setSeconds(e.target.value)} inputMode="numeric"
                disabled={!!file && isVideoMime(file.type)} className="input mt-1 w-full text-sm disabled:opacity-50" />
            </label>
            <label className="text-[11px] text-ink-mute">
              시작일 (선택)
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input mt-1 w-full text-sm" />
            </label>
            <label className="text-[11px] text-ink-mute">
              끝나는 날 (선택)
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="input mt-1 w-full text-sm" />
            </label>
          </div>
          <ResponsibilityCheck checked={agree} onChange={setAgree} />
          <NoteInput value={note} onChange={setNote} />
          <button
            type="button"
            onClick={() => void upload()}
            disabled={busy !== null || !file || !agree}
            className="btn-primary inline-flex w-full items-center justify-center gap-1.5 py-2.5 text-sm disabled:opacity-50"
          >
            {busy === 'upload' ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} 올리고 검수 요청
          </button>
        </div>
      </Card>
    </div>
  );
}
