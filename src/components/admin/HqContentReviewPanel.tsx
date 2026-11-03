/**
 * HqContentReviewPanel — 관리자 > 본사 콘텐츠 검수 (0541).
 *
 * 본사가 브랜드 콘텐츠 관리(/enterprise/content)에서 보낸 변경 요청을 확인하고
 * 승인(기존 관리자 기능으로 그대로 적용) 또는 반려한다. 결과는 본사 알림센터로 간다.
 */
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ClipboardCheck, RefreshCw, Search, XCircle } from 'lucide-react';
import {
  AdminSection, AdminBadge, AdminButton, AdminEmpty, AdminSkeleton, AdminAlert,
  type AdminToneName,
} from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';
import { genreLabel, moodLabel } from '@/lib/brandMusicPolicy';
import { adminPreviewBrandMusicPolicy } from '@/lib/api/brandPlayerApi';
import {
  adminListHqContentRequests, adminReviewHqContentRequest, describeRecurrence, describeScope, removeRequestUpload,
  HQ_KIND_LABEL, HQ_STATUS_LABEL,
  type AdminHqContentRequest, type HqRequestStatus, type HqScopeType,
} from '@/lib/api/hqContentApi';

const FILTERS: { key: HqRequestStatus | 'all'; label: string }[] = [
  { key: 'pending', label: '검수 대기' },
  { key: 'approved', label: '반영됨' },
  { key: 'rejected', label: '반려' },
  { key: 'all', label: '전체' },
];

const STATUS_TONE: Record<HqRequestStatus, AdminToneName> = {
  pending: 'warning', approved: 'success', rejected: 'danger', cancelled: 'neutral', superseded: 'neutral',
};

const VOCAL: Record<string, string> = {
  any: '제한 없음', vocal_ok: '보컬 허용', prefer_instrumental: '연주곡 선호', instrumental_only: '연주곡만',
};
const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** 서버(0543)가 스토리지 URL 만 받지만, 링크로 여는 곳은 한 번 더 https 만 허용한다. */
function safeHttps(url: string): string | undefined {
  return /^https:\/\//i.test(url) ? url : undefined;
}

function when(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const list = (v: unknown, label: (s: string) => string) =>
  Array.isArray(v) && v.length ? (v as string[]).map(label).join(', ') : '—';
const range = (a: unknown, b: unknown) => (a == null && b == null ? '—' : `${a ?? ''} ~ ${b ?? ''}`);

function Row({ label, before, after }: { label: string; before?: string; after: string }) {
  const changed = before !== undefined && before !== after;
  return (
    <tr className="align-top">
      <td className="whitespace-nowrap py-0.5 pr-3 text-ink-mute">{label}</td>
      {before !== undefined && <td className="py-0.5 pr-3 text-ink-dim">{before}</td>}
      <td className={`py-0.5 ${changed ? 'font-semibold text-accent' : ''}`}>{after}</td>
    </tr>
  );
}

function MusicDiff({ r }: { r: AdminHqContentRequest }) {
  const p = r.payload;
  const c = (r.current ?? {}) as Record<string, unknown>;
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  async function check() {
    if (!r.brand_id) return;
    setLoading(true);
    try { setCount((await adminPreviewBrandMusicPolicy(r.brand_id, p)).eligible); }
    catch (e) { toast.error(friendlyError(e, '확인하지 못했어요')); }
    finally { setLoading(false); }
  }
  const mode = (v: unknown) => (v === 'custom' ? '브랜드 맞춤' : '업종 기본');
  return (
    <div className="space-y-2">
      <table className="w-full text-[12px]">
        <thead><tr className="text-left text-[11px] text-ink-dim"><th /><th className="pr-3 font-normal">지금</th><th className="font-normal">요청</th></tr></thead>
        <tbody>
          <Row label="방식" before={mode(c.policy_mode)} after={mode(p.policy_mode)} />
          <Row label="허용 장르" before={list(c.allowed_genres, genreLabel)} after={list(p.allowed_genres, genreLabel)} />
          <Row label="선호 장르" before={list(c.preferred_genres, genreLabel)} after={list(p.preferred_genres, genreLabel)} />
          <Row label="차단 장르" before={list(c.blocked_genres, genreLabel)} after={list(p.blocked_genres, genreLabel)} />
          <Row label="선호 분위기" before={list(c.preferred_moods, moodLabel)} after={list(p.preferred_moods, moodLabel)} />
          <Row label="차단 분위기" before={list(c.blocked_moods, moodLabel)} after={list(p.blocked_moods, moodLabel)} />
          <Row label="보컬" before={VOCAL[String(c.vocal_policy)] ?? '—'} after={VOCAL[String(p.vocal_policy)] ?? '—'} />
          <Row label="에너지" before={range(c.energy_min, c.energy_max)} after={range(p.energy_min, p.energy_max)} />
          <Row label="BPM" before={range(c.bpm_min, c.bpm_max)} after={range(p.bpm_min, p.bpm_max)} />
        </tbody>
      </table>
      <div className="flex items-center gap-2">
        <AdminButton tone="neutral" variant="subtle" size="sm" leftIcon={<Search size={12} />} onClick={() => void check()} disabled={loading}>
          해당 곡 수 확인
        </AdminButton>
        {count != null && (
          <span className={`text-[12px] ${count < 100 ? 'font-semibold text-amber-600 dark:text-amber-300' : 'text-ink-mute'}`}>
            {count.toLocaleString()}곡{count < 100 ? ' — 적어서 반복이 잦을 수 있음' : ''}
          </span>
        )}
      </div>
      <p className="text-[11px] text-ink-dim">승인하면 정책을 저장하고 오늘 플레이리스트를 바로 다시 만듭니다.</p>
    </div>
  );
}

function Detail({ r }: { r: AdminHqContentRequest }) {
  const p = r.payload;
  const c = (r.current ?? {}) as Record<string, unknown>;
  const s = (k: string) => (typeof p[k] === 'string' ? (p[k] as string) : '');
  switch (r.kind) {
    case 'music_policy':
      return <MusicDiff r={r} />;
    case 'playback_policy': {
      const fmt = (v: Record<string, unknown>) => (v.playback_mode === 'business_hours'
        ? `영업시간 ${String(v.open_time ?? '').slice(0, 5)}~${String(v.close_time ?? '').slice(0, 5)} (${Array.isArray(v.days ?? v.playback_days) ? ((v.days ?? v.playback_days) as number[]).map((d) => DAYS[d]).join('') : '매일'})`
        : '24시간');
      return <table className="text-[12px]"><tbody><Row label="재생 시간" before={fmt(c)} after={fmt(p)} /></tbody></table>;
    }
    case 'media_add':
      return (
        <div className="flex gap-3">
          <a href={safeHttps(s('url'))} target="_blank" rel="noreferrer" className="block w-48 shrink-0 overflow-hidden rounded-lg bg-black">
            {p.asset_type === 'video'
              ? <video src={safeHttps(s('url'))} controls muted className="max-h-32 w-full" />
              : <img src={safeHttps(s('url'))} alt="" className="max-h-32 w-full object-contain" />}
          </a>
          <div className="text-[12px] leading-relaxed">
            <p className="font-semibold">{s('title') || '제목 없음'}</p>
            <p className="text-ink-mute">{p.asset_type === 'video' ? '영상' : `이미지 · ${String(p.display_duration_seconds ?? 10)}초`}</p>
            <p className="text-ink-mute">기간: {p.starts_at ? when(s('starts_at')) : '바로'} ~ {p.ends_at ? when(s('ends_at')) : '계속'}</p>
          </div>
        </div>
      );
    case 'media_update':
    case 'media_delete':
      return (
        <div className="flex items-center gap-3 text-[12px]">
          {typeof c.image_url === 'string' && c.asset_type !== 'video' && <img src={c.image_url} alt="" className="h-12 w-20 rounded object-cover" />}
          <p>
            <b>{String(c.title ?? '제목 없음')}</b>{' → '}
            {r.kind === 'media_delete' ? '삭제' : p.status === 'inactive' ? '표시 중지' : p.status === 'active' ? '다시 표시' : '내용 수정'}
          </p>
        </div>
      );
    case 'announcement_asset_add':
      return (
        <div className="space-y-1 text-[12px]">
          <p className="font-semibold">{s('title')}</p>
          <audio src={safeHttps(s('file_url'))} controls preload="none" className="h-8 w-full max-w-sm" />
        </div>
      );
    case 'announcement_asset_delete':
      return <p className="text-[12px]"><b>{String(c.title ?? '음원')}</b> 삭제 — 이 음원을 쓰는 일정은 더 이상 나가지 않습니다.</p>;
    case 'schedule_create':
      return (
        <div className="space-y-0.5 text-[12px]">
          <p><b>{s('name')}</b> · {describeRecurrence(s('recurrence_rule'))}</p>
          <p className="text-ink-mute">
            {describeScope(p.scope_type as HqScopeType, { regionName: r.region_name, storeCount: Array.isArray(p.store_ids) ? p.store_ids.length : 0 })}
            {' · 음원 '}“{r.asset_title ?? '?'}”
          </p>
          {r.asset_request_status === 'pending' && (
            <p className="text-amber-600 dark:text-amber-300">이 음원은 아직 검수 전이에요 — 이 일정을 승인하면 음원도 함께 승인됩니다.</p>
          )}
        </div>
      );
    case 'schedule_update':
      return (
        <p className="text-[12px]">
          <b>{String(c.name ?? '일정')}</b>{' → '}
          {p.status === 'paused' ? '일시중지' : p.status === 'active' ? '다시 켜기' : '내용 수정'}
        </p>
      );
    case 'schedule_delete':
      return <p className="text-[12px]"><b>{String(c.name ?? '일정')}</b> 삭제</p>;
    default:
      return null;
  }
}

function RequestCard({ r, onDone }: { r: AdminHqContentRequest; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  async function review(approve: boolean) {
    if (!approve && !note.trim()) { toast.error('반려 사유를 적어 주세요 — 본사에 그대로 전달돼요'); return; }
    setBusy(true);
    try {
      await adminReviewHqContentRequest(r.id, approve, note);
      // 반려한 업로드 파일은 공개 버킷에 남기지 않는다(실패해도 검수 결과는 유지).
      if (!approve) await removeRequestUpload(r).catch(() => undefined);
      toast.success(approve ? '승인했어요 — 매장에 반영됩니다' : '반려했어요');
      onDone();
    } catch (e) {
      toast.error(friendlyError(e, '처리하지 못했어요'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="rounded-xl bg-bg-card p-3 ring-1 ring-line/10">
      <div className="flex flex-wrap items-center gap-2">
        <AdminBadge tone={STATUS_TONE[r.status]} variant="subtle">{HQ_STATUS_LABEL[r.status]}</AdminBadge>
        <span className="text-sm font-bold">{HQ_KIND_LABEL[r.kind]}</span>
        <span className="text-[12px] text-ink-mute">· {r.enterprise_name}{r.brand_name ? ` (${r.brand_name})` : ''}</span>
        <span className="ml-auto text-[11px] text-ink-dim">{when(r.created_at)} · {r.requester_email ?? '본사'}</span>
      </div>
      {r.hq_note && <p className="mt-1.5 rounded-lg bg-bg-soft px-2.5 py-1.5 text-[12px]">본사 메모: {r.hq_note}</p>}
      <div className="mt-2.5"><Detail r={r} /></div>
      {r.status === 'pending' ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line/10 pt-3">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            placeholder="본사에 전달할 메모 (반려 시 필수)"
            className="input min-w-[12rem] flex-1 text-sm"
          />
          <AdminButton tone="danger" variant="subtle" size="sm" leftIcon={<XCircle size={13} />} disabled={busy} onClick={() => void review(false)}>
            반려
          </AdminButton>
          <AdminButton tone="success" size="sm" leftIcon={<CheckCircle2 size={13} />} disabled={busy} onClick={() => void review(true)}>
            승인하고 반영
          </AdminButton>
        </div>
      ) : r.review_note ? (
        <p className="mt-2 text-[12px] text-ink-mute">검수 메모: {r.review_note}</p>
      ) : null}
    </div>
  );
}

export default function HqContentReviewPanel() {
  const [filter, setFilter] = useState<HqRequestStatus | 'all'>('pending');
  const [rows, setRows] = useState<AdminHqContentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await adminListHqContentRequests(filter === 'all' ? null : filter));
      setError(null);
    } catch (e) {
      setError(friendlyError(e, '불러오지 못했어요'));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  return (
    <AdminSection
      title={<span className="flex items-center gap-2"><ClipboardCheck size={16} /> 본사 콘텐츠 검수</span>}
      description="본사가 브랜드 콘텐츠 관리에서 요청한 음악·매장 화면·안내방송 변경입니다. 승인하면 바로 매장에 반영되고, 결과는 본사 알림센터로 전달됩니다."
      badge={filter === 'pending' && rows.length > 0 ? <AdminBadge tone="warning" variant="subtle">대기 {rows.length}</AdminBadge> : undefined}
      action={
        <AdminButton tone="neutral" variant="subtle" size="sm" leftIcon={<RefreshCw size={12} />} onClick={() => void load()} disabled={loading}>
          새로고침
        </AdminButton>
      }
    >
      <div className="flex gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-3 py-1 text-[12px] font-semibold ${filter === f.key ? 'bg-accent text-bg' : 'bg-bg-soft text-ink-mute hover:text-ink'}`}
          >
            {f.label}
          </button>
        ))}
      </div>
      {error && <AdminAlert tone="danger" title="불러오기 실패" description={error} />}
      {loading ? (
        <AdminSkeleton rows={3} />
      ) : rows.length === 0 ? (
        <AdminEmpty
          icon={<ClipboardCheck size={20} />}
          title={filter === 'pending' ? '검수할 요청이 없어요' : '요청이 없어요'}
          description="본사가 요청을 보내면 여기와 알림 벨에 나타납니다."
        />
      ) : (
        <div className="space-y-2">
          {rows.map((r) => <RequestCard key={r.id} r={r} onDone={() => void load()} />)}
        </div>
      )}
    </AdminSection>
  );
}
