// Phase ENT-OS-2 — Brand Workspace.
// Enterprise OS 안에서 Brand 를 독립 운영 단위로 승격: 좌측 Summary + 우측 Navigation.
// 섹션: Overview / Music / Playlist / Media / Player / AI / History.
// Playlist 는 영속 엔진(0409): manual/auto · version · clone · soft-delete. AI 생성은 Stub.
import { useCallback, useEffect, useState } from 'react';
import {
  Copy, Plus, Trash2, ExternalLink, Image as ImageIcon, ListMusic, Music2, Sparkles,
  Power, CopyPlus, RefreshCw, History as HistoryIcon, Radio, Gauge, LayoutDashboard,
  SlidersHorizontal, PlayCircle, CheckCircle2, XCircle, ListOrdered, Hammer, Eye,
} from 'lucide-react';
import { AdminCard, AdminButton, AdminBadge, AdminEmpty, AdminSkeleton, AdminAlert, AdminStatCard, AdminModal } from '@/components/admin/ui';
import type { AdminToneName } from '@/components/admin/ui';
import { adminTones } from '@/lib/adminTones';
import { toast } from '@/store/toastStore';
import {
  adminGetBrandWorkspace, adminCreateBrandPlaylist, adminUpdateBrandPlaylist,
  adminCloneBrandPlaylist, adminDeleteBrandPlaylist, adminRegenerateBrandPlaylist,
  type BrandWorkspace as BrandWorkspaceData, type BrandPlaylistRow, type BrandPlaylistType,
  type BrandWorkspaceMediaAsset,
} from '@/lib/api/brandWorkspaceApi';
import {
  adminGetBrandHealth, adminListBrandRuntimeRules, adminCreateBrandRuntimeRule,
  adminUpdateBrandRuntimeRule, adminDeleteBrandRuntimeRule, adminPreviewBrandRuntime,
  type BrandHealth, type BrandRuntimeRule, type RuntimePreview,
} from '@/lib/api/brandRuntimeApi';
import {
  adminPreviewBrandQueue, adminBuildBrandQueue, adminListBrandQueues, adminGetBrandQueue,
  QUEUE_STRATEGIES, type QueueStrategy, type QueuePreview, type QueueRunListItem, type QueueDetail,
} from '@/lib/api/brandQueueApi';
import { adminAddBrandMedia, adminUpdateBrandMedia, adminDeleteBrandMedia } from '@/lib/api/brandPlayerApi';
import { uploadBrandMedia } from '@/lib/brandMediaUpload';
import BrandSignage from '@/components/brand/BrandSignage';

type Section = 'overview' | 'music' | 'playlist' | 'runtime' | 'queue' | 'media' | 'player' | 'ai' | 'history';
const NAV: ReadonlyArray<{ key: Section; label: string; icon: React.ReactNode }> = [
  { key: 'overview', label: 'Overview', icon: <LayoutDashboard size={14} /> },
  { key: 'music', label: 'Music', icon: <Music2 size={14} /> },
  { key: 'playlist', label: 'Playlist', icon: <ListMusic size={14} /> },
  { key: 'runtime', label: 'Runtime', icon: <SlidersHorizontal size={14} /> },
  { key: 'queue', label: 'Queue', icon: <ListOrdered size={14} /> },
  { key: 'media', label: 'Media', icon: <ImageIcon size={14} /> },
  { key: 'player', label: 'Player', icon: <Radio size={14} /> },
  { key: 'ai', label: 'AI', icon: <Sparkles size={14} /> },
  { key: 'history', label: 'History', icon: <HistoryIcon size={14} /> },
];

export default function BrandWorkspace({ brandId, onBrandChanged }: { brandId: string; onBrandChanged?: () => void }) {
  const [section, setSection] = useState<Section>('overview');
  const [data, setData] = useState<BrandWorkspaceData | null>(null);
  const [health, setHealth] = useState<BrandHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [ws, h] = await Promise.all([adminGetBrandWorkspace(brandId), adminGetBrandHealth(brandId)]);
      setData(ws); setHealth(h);
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Workspace 조회 실패'); }
    finally { setLoading(false); }
  }, [brandId]);
  useEffect(() => { void load(); }, [load]);

  const reload = useCallback(async () => { await load(); onBrandChanged?.(); }, [load, onBrandChanged]);

  if (loading && !data) return <AdminSkeleton variant="block" rows={8} />;
  if (error) return <AdminAlert tone="danger" title="조회 실패" description={error} action={<AdminButton size="sm" onClick={() => void load()}>재시도</AdminButton>} />;
  if (!data) return null;

  const b = data.brand; const o = data.overview;
  const scoreVal = health?.score ?? o.health_score;

  return (
    <div className="grid gap-3 lg:grid-cols-[260px_1fr]">
      {/* ── 좌: Brand Summary ── */}
      <aside className="space-y-3">
        <AdminCard>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-base font-bold text-ink">{b.name}</p>
              <p className="mt-0.5 truncate text-[11px] text-ink-mute">{b.enterprise_name ?? '본사 미연결'}</p>
            </div>
            <AdminBadge tone={b.status === 'active' ? 'success' : 'neutral'}>{b.status === 'active' ? '활성' : '비활성'}</AdminBadge>
          </div>
          {b.industry_type && <p className="mt-1 text-[11px] text-ink-dim">{b.industry_type}</p>}

          <div className="mt-3 flex items-center gap-3 rounded-xl bg-bg p-3">
            <Gauge size={22} className={healthColor(scoreVal)} />
            <div>
              <p className="text-[10px] uppercase tracking-wider text-ink-dim">Health Score</p>
              <p className={`text-xl font-extrabold ${healthColor(scoreVal)}`}>{scoreVal}<span className="text-xs text-ink-dim"> / 100</span></p>
            </div>
          </div>

          <dl className="mt-3 space-y-1.5">
            <SummaryRow k="연결 매장" v={String(o.connected_store_count)} />
            <SummaryRow k="연결 지역" v={String(o.connected_region_count)} />
            <SummaryRow k="플레이어 세션" v={String(o.player_session_count)} />
            <SummaryRow k="이미지" v={`${o.active_media_count}/${o.media_count}`} />
            <SummaryRow k="플레이리스트" v={String(o.playlist_count)} />
            <SummaryRow k="재생 가능 트랙" v={String(o.available_track_count)} />
          </dl>
        </AdminCard>
      </aside>

      {/* ── 우: Navigation + Section ── */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1 rounded-2xl bg-bg-card p-1 text-xs">
          {NAV.map((n) => (
            <button key={n.key} onClick={() => setSection(n.key)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-semibold transition ${section === n.key ? 'bg-accent text-black' : 'text-ink-mute hover:bg-bg-hover'}`}>
              {n.icon} {n.label}
            </button>
          ))}
        </div>

        {section === 'overview' && <OverviewSection d={data} health={health} />}
        {section === 'music' && <MusicSection d={data} />}
        {section === 'playlist' && <PlaylistSection d={data} reload={reload} />}
        {section === 'media' && <MediaSection d={data} reload={reload} />}
        {section === 'player' && <PlayerSection d={data} />}
        {section === 'runtime' && <RuntimeSection d={data} reload={reload} />}
        {section === 'queue' && <QueueSection d={data} reload={reload} />}
        {section === 'ai' && <AiSection d={data} />}
        {section === 'history' && <HistorySection d={data} />}
      </div>
    </div>
  );
}

// ── Overview ─────────────────────────────────────────────────────────
function OverviewSection({ d, health }: { d: BrandWorkspaceData; health: BrandHealth | null }) {
  const b = d.brand; const o = d.overview;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <AdminStatCard label="연결 매장" value={String(o.connected_store_count)} />
        <AdminStatCard label="플레이어 세션" value={String(o.player_session_count)} tone={o.player_session_count > 0 ? 'info' : 'neutral'} />
        <AdminStatCard label="플레이리스트" value={String(o.playlist_count)} />
        <AdminStatCard label="이미지(활성)" value={String(o.active_media_count)} tone={o.active_media_count > 0 ? 'success' : 'neutral'} />
      </div>
      {health && (
        <AdminCard title={`Health Checks (${health.score}/100)`} subtitle="Runtime 운영 준비 상태.">
          <HealthChecks health={health} />
        </AdminCard>
      )}
      <AdminCard title="브랜드 정보">
        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
          <KV k="Brand Name" v={b.name} />
          <KV k="Enterprise" v={b.enterprise_name} />
          <KV k="Industry" v={b.industry_type} />
          <KV k="Status" v={b.status} />
          <KV k="Created" v={fmt(b.created_at)} />
          <KV k="Updated" v={fmt(b.updated_at)} />
          <KV k="Music Policy" v={o.music_policy_set ? '설정됨' : '기본값'} />
          <KV k="AI Profile" v={o.ai_profile_set ? '설정됨' : '미설정'} />
          <KV k="Health Score" v={`${o.health_score} / 100`} />
          <KV k="brand_id" v={b.id} copy mono abbrev />
        </dl>
        {b.description && <p className="mt-2 rounded bg-bg px-2 py-1.5 text-xs text-ink-mute">{b.description}</p>}
      </AdminCard>
    </div>
  );
}

// ── Music (brand 음악 정책, 조회) ────────────────────────────────────
function MusicSection({ d }: { d: BrandWorkspaceData }) {
  const ai = d.ai_profile;
  return (
    <AdminCard title="브랜드 음악 정책" subtitle="플레이어 자동 생성의 기준. 편집은 '브랜드 플레이어' 메뉴에서.">
      {!ai ? (
        <AdminEmpty title="음악 정책 없음" description="브랜드 기본값으로 자동 생성됩니다." />
      ) : (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
          <KV k="선호 장르" v={csvOrDash(ai.preferred_genres)} />
          <KV k="차단 장르" v={csvOrDash(ai.blocked_genres)} />
          <KV k="선호 무드" v={csvOrDash(ai.preferred_moods)} />
          <KV k="차단 무드" v={csvOrDash(ai.blocked_moods)} />
          <KV k="에너지" v={`${ai.energy_min ?? '—'} ~ ${ai.energy_max ?? '—'}`} />
          <KV k="보컬 정책" v={ai.vocal_policy} />
          <KV k="자동 플리 생성" v={ai.auto_generate_enabled ? '사용' : '미사용'} />
        </dl>
      )}
    </AdminCard>
  );
}

// ── Playlist (영속 엔진 CRUD) ────────────────────────────────────────
function PlaylistSection({ d, reload }: { d: BrandWorkspaceData; reload: () => Promise<void> }) {
  const [creating, setCreating] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const ps = d.playlist_summary;

  async function act(id: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(id);
    try { await fn(); toast.success(ok); await reload(); }
    catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2">
        <AdminStatCard label="전체" value={String(ps.total)} />
        <AdminStatCard label="활성" value={String(ps.active)} tone="success" />
        <AdminStatCard label="Manual" value={String(ps.manual)} tone="neutral" />
        <AdminStatCard label="Auto" value={String(ps.auto)} tone="info" />
      </div>

      <AdminCard
        title={`플레이리스트 (${d.playlists.length})`}
        subtitle="Manual = 직접 큐레이션 · Auto = 브랜드 정책 기반 자동 생성. 버전/복제/비활성/soft-delete 지원."
        action={
          <div className="flex gap-1.5">
            <AdminButton size="sm" variant="subtle" tone="neutral" leftIcon={<Sparkles size={13} />} onClick={() => setAiOpen(true)}>AI 생성</AdminButton>
            <AdminButton size="sm" tone="primary" leftIcon={<Plus size={13} />} onClick={() => setCreating(true)}>새 플레이리스트</AdminButton>
          </div>
        }
      >
        {d.playlists.length === 0 ? (
          <AdminEmpty icon={<ListMusic size={22} />} title="플레이리스트 없음" description="Auto(정책 기반) 또는 Manual 플레이리스트를 생성하세요." />
        ) : (
          <div className="space-y-2">
            {d.playlists.map((p) => (
              <PlaylistRow key={p.id} p={p} busy={busy === p.id}
                onStatus={() => act(p.id, () => adminUpdateBrandPlaylist({ playlistId: p.id, status: p.status === 'active' ? 'inactive' : 'active' }), '상태를 변경했어요')}
                onClone={() => act(p.id, () => adminCloneBrandPlaylist(p.id), '복제했어요')}
                onRegen={() => act(p.id, () => adminRegenerateBrandPlaylist(p.id), '재생성했어요')}
                onDelete={() => { if (confirm(`"${p.name}" 플레이리스트를 삭제할까요? (soft delete)`)) void act(p.id, () => adminDeleteBrandPlaylist(p.id, true), '삭제했어요'); }}
              />
            ))}
          </div>
        )}
      </AdminCard>

      {creating && <CreatePlaylistModal brandId={d.brand.id} onClose={() => setCreating(false)} onCreated={async () => { setCreating(false); await reload(); }} />}
      {aiOpen && <AiPlaylistStubModal onClose={() => setAiOpen(false)} industry={d.brand.industry_type} />}
    </div>
  );
}

function PlaylistRow({ p, busy, onStatus, onClone, onRegen, onDelete }: {
  p: BrandPlaylistRow; busy: boolean;
  onStatus: () => void; onClone: () => void; onRegen: () => void; onDelete: () => void;
}) {
  return (
    <div className="rounded-lg border border-line/20 bg-bg p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-bold text-ink">{p.name}</span>
            <AdminBadge tone={p.type === 'auto' ? 'info' : 'neutral'}>{p.type === 'auto' ? 'Auto' : 'Manual'}</AdminBadge>
            <AdminBadge tone={p.status === 'active' ? 'success' : 'neutral'}>{p.status === 'active' ? '활성' : '비활성'}</AdminBadge>
            <span className="text-[11px] text-ink-dim">v{p.version}</span>
          </div>
          {p.description && <p className="mt-0.5 truncate text-[11px] text-ink-mute">{p.description}</p>}
          <p className="mt-0.5 text-[11px] text-ink-dim">Track {p.track_count} · 생성 {fmt(p.created_at)} · 수정 {fmt(p.updated_at)}</p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <AdminButton size="sm" variant="ghost" tone="neutral" disabled={busy} leftIcon={<Power size={12} />} onClick={onStatus}>{p.status === 'active' ? '비활성' : '활성'}</AdminButton>
        <AdminButton size="sm" variant="ghost" tone="neutral" disabled={busy} leftIcon={<CopyPlus size={12} />} onClick={onClone}>복제</AdminButton>
        {p.type === 'auto' && <AdminButton size="sm" variant="ghost" tone="info" disabled={busy} leftIcon={<RefreshCw size={12} />} onClick={onRegen}>재생성</AdminButton>}
        <AdminButton size="sm" variant="ghost" tone="danger" disabled={busy} leftIcon={<Trash2 size={12} />} onClick={onDelete}>삭제</AdminButton>
      </div>
    </div>
  );
}

function CreatePlaylistModal({ brandId, onClose, onCreated }: { brandId: string; onClose: () => void; onCreated: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [type, setType] = useState<BrandPlaylistType>('auto');
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!name.trim()) { toast.error('이름을 입력해주세요'); return; }
    setSaving(true);
    try {
      const r = await adminCreateBrandPlaylist({ brandId, name: name.trim(), description: desc.trim() || null, type });
      toast.success(`생성했어요 (트랙 ${r.track_count})`);
      await onCreated();
    } catch (e) { toast.error(`생성 실패: ${(e as Error).message}`); }
    finally { setSaving(false); }
  }

  return (
    <AdminModal open onClose={onClose} title="새 플레이리스트" size="md"
      footer={<><AdminButton tone="neutral" variant="subtle" onClick={onClose}>취소</AdminButton><AdminButton tone="primary" onClick={() => void submit()} disabled={saving}>{saving ? '생성 중…' : '생성'}</AdminButton></>}>
      <div className="space-y-3">
        <Field label="이름 *"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 오전 브런치" maxLength={120} /></Field>
        <Field label="설명"><textarea className={inputCls} rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={300} /></Field>
        <Field label="유형">
          <div className="flex gap-2">
            <TypeChip active={type === 'auto'} onClick={() => setType('auto')} title="Auto" desc="정책 기반 자동 생성" />
            <TypeChip active={type === 'manual'} onClick={() => setType('manual')} title="Manual" desc="직접 큐레이션 (빈 상태)" />
          </div>
        </Field>
        <p className="text-[11px] text-ink-dim">
          {type === 'auto'
            ? 'Auto: 브랜드 음악 정책으로 즉시 채워집니다. 이후 "재생성"으로 갱신.'
            : 'Manual: 빈 플레이리스트로 생성됩니다. 트랙 편집기는 후속 Phase.'}
        </p>
      </div>
    </AdminModal>
  );
}

function TypeChip({ active, onClick, title, desc }: { active: boolean; onClick: () => void; title: string; desc: string }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex-1 rounded-xl border px-3 py-2 text-left transition ${active ? 'border-accent bg-accent/10' : 'border-line/25 bg-bg hover:border-line/40'}`}>
      <p className={`text-sm font-bold ${active ? 'text-ink' : 'text-ink-mute'}`}>{title}</p>
      <p className="text-[11px] text-ink-dim">{desc}</p>
    </button>
  );
}

// AI Playlist Builder — Stub UI (후속 AI Music OS 연결)
function AiPlaylistStubModal({ onClose, industry }: { onClose: () => void; industry: string | null }) {
  return (
    <AdminModal open onClose={onClose} title="AI Playlist Builder" size="md"
      footer={<><AdminButton tone="neutral" variant="subtle" onClick={onClose}>닫기</AdminButton><AdminButton tone="primary" disabled leftIcon={<Sparkles size={14} />}>AI 생성 (후속)</AdminButton></>}>
      <AdminAlert tone="info" className="mb-3" title="후속 AI Music OS 연결 예정"
        description="아래 입력은 미리보기입니다. 실제 AI 생성은 다음 Phase에서 Playlist Engine 위에 연결됩니다." />
      <div className="grid grid-cols-2 gap-3 opacity-70">
        <Field label="업종"><input className={inputCls} defaultValue={industry ?? ''} disabled /></Field>
        <Field label="분위기"><input className={inputCls} placeholder="calm, warm" disabled /></Field>
        <Field label="장르"><input className={inputCls} placeholder="jazz, lofi" disabled /></Field>
        <Field label="기피 장르"><input className={inputCls} placeholder="edm, metal" disabled /></Field>
        <Field label="BPM"><input className={inputCls} placeholder="70 ~ 110" disabled /></Field>
        <Field label="Energy"><input className={inputCls} placeholder="0.2 ~ 0.7" disabled /></Field>
        <Field label="Vocal"><input className={inputCls} placeholder="prefer_instrumental" disabled /></Field>
        <Field label="시간대"><input className={inputCls} placeholder="09:00 ~ 12:00" disabled /></Field>
      </div>
      <div className="mt-3 rounded-lg border border-dashed border-line/30 bg-bg p-3 text-center text-xs text-ink-dim">
        Playlist Preview · 예상 Track 수 · 예상 분위기 — 후속 Phase
      </div>
    </AdminModal>
  );
}

// ── Media ────────────────────────────────────────────────────────────
function MediaSection({ d, reload }: { d: BrandWorkspaceData; reload: () => Promise<void> }) {
  const [uploading, setUploading] = useState(false);
  const brandId = d.brand.id;
  const assets = d.media;

  async function onPickImage(file: File) {
    setUploading(true);
    try {
      const up = await uploadBrandMedia(brandId, file);
      if (!up.ok || !up.url) { toast.error(up.error || '업로드 실패'); return; }
      await adminAddBrandMedia({ brandId, imageUrl: up.url, displayDurationSeconds: 10 });
      toast.success('이미지를 추가했어요'); await reload();
    } catch (e) { toast.error(`이미지 추가 실패: ${(e as Error).message}`); }
    finally { setUploading(false); }
  }
  async function toggle(m: BrandWorkspaceMediaAsset) {
    try { await adminUpdateBrandMedia({ assetId: m.id, status: m.status === 'active' ? 'inactive' : 'active' }); await reload(); }
    catch (e) { toast.error(`수정 실패: ${(e as Error).message}`); }
  }
  async function remove(id: string) {
    if (!confirm('이 이미지를 삭제할까요?')) return;
    try { await adminDeleteBrandMedia(id); toast.success('삭제했어요'); await reload(); }
    catch (e) { toast.error(`삭제 실패: ${(e as Error).message}`); }
  }

  const preview = assets.filter((m) => (m.status ?? 'active') === 'active')
    .map((m) => ({ id: m.id, title: m.title, image_url: m.image_url, display_duration_seconds: m.display_duration_seconds ?? 10 }));

  return (
    <AdminCard
      title={`이미지·사이니지 (${assets.length})`}
      subtitle="순서대로 노출. jpg/png/webp, 10MB 이하. (Video/HTML/YouTube 는 후속)"
      action={
        <label className="cursor-pointer">
          <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={uploading}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPickImage(f); e.currentTarget.value = ''; }} />
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-black">
            <Plus size={13} /> {uploading ? '업로드 중…' : '이미지 추가'}
          </span>
        </label>
      }
    >
      {assets.length === 0 ? (
        <AdminEmpty icon={<ImageIcon size={22} />} title="이미지 없음" description="이미지를 추가하면 플레이어에서 순차 노출됩니다." />
      ) : (
        <div className="space-y-2">
          {assets.map((m) => (
            <div key={m.id} className="flex items-center gap-3 rounded-lg border border-line/20 bg-bg p-2">
              <img src={m.image_url} alt={m.title ?? ''} className="h-12 w-16 shrink-0 rounded object-cover" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-ink">{m.title || '(제목 없음)'}</p>
                <p className="text-[11px] text-ink-dim">{m.asset_type} · 노출 {m.display_duration_seconds ?? '—'}초 · 순서 {m.sort_order ?? '—'}</p>
              </div>
              <AdminBadge tone={(m.status ?? 'active') === 'active' ? 'success' : 'neutral'}>{(m.status ?? 'active') === 'active' ? '표시' : '숨김'}</AdminBadge>
              <AdminButton size="sm" variant="ghost" tone={m.status === 'active' ? 'neutral' : 'success'} onClick={() => void toggle(m)}>{m.status === 'active' ? '숨김' : '표시'}</AdminButton>
              <AdminButton size="sm" variant="ghost" tone="danger" onClick={() => void remove(m.id)}><Trash2 size={13} /></AdminButton>
            </div>
          ))}
        </div>
      )}
      {preview.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-[11px] font-semibold text-ink-dim">플레이어 미리보기</p>
          <BrandSignage items={preview} brandName={d.brand.name} className="h-48 w-full rounded-lg" />
        </div>
      )}
    </AdminCard>
  );
}

// ── Player ───────────────────────────────────────────────────────────
function PlayerSection({ d }: { d: BrandWorkspaceData }) {
  const p = d.player; const code = p.store_invite_code;
  const sum = p.session_summary;
  return (
    <div className="space-y-3">
      <AdminCard title="매장 진입 코드" subtitle="매장은 이 코드만 입력하면 자동으로 브랜드 플레이어에 진입합니다.">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-ink-dim">Store Invite Code</p>
            {code ? (
              <div className="mt-0.5 flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-bg px-2 py-1.5 font-mono text-sm font-bold text-ink">{code}</code>
                <button type="button" title="복사" onClick={() => doCopy(code)} className="rounded bg-bg p-1.5 hover:bg-bg-hover"><Copy size={12} /></button>
              </div>
            ) : <p className="mt-0.5 rounded bg-bg px-2 py-1.5 text-xs text-ink-dim">본사 미연결 · 코드 없음</p>}
          </div>
          <div className="flex items-end">
            <AdminButton size="sm" variant="subtle" tone="neutral" leftIcon={<ExternalLink size={13} />} onClick={() => window.open('/brand', '_blank', 'noopener')}>/brand 열기</AdminButton>
          </div>
        </div>
      </AdminCard>

      <div className="grid grid-cols-3 gap-2">
        <AdminStatCard label="누적 세션" value={String(sum.total)} />
        <AdminStatCard label="활성(10분)" value={String(sum.active_recent)} tone={sum.active_recent > 0 ? 'success' : 'neutral'} />
        <AdminStatCard label="24h" value={String(sum.last_24h)} />
      </div>

      <AdminCard title="현재 재생">
        {p.now_playing ? (
          <div className="text-sm text-ink">
            <span className="font-semibold">{p.now_playing.title ?? '(제목 없음)'}</span>
            {p.now_playing.artist && <span className="text-ink-mute"> · {p.now_playing.artist}</span>}
            <span className="ml-2 text-[11px] text-ink-dim">{fmt(p.now_playing.last_seen_at)}</span>
          </div>
        ) : <p className="text-xs text-ink-dim">현재 재생 중인 세션 없음</p>}
      </AdminCard>

      <AdminCard title="세션">
        {p.sessions.length === 0 ? (
          <AdminEmpty title="세션 기록 없음" description="아직 이 브랜드로 진입한 플레이어가 없습니다." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead className="text-ink-dim"><tr>
                <th className="px-2 py-1 text-left">최근 접속</th><th className="px-2 py-1 text-left">재생 시작</th>
                <th className="px-2 py-1 text-left">현재곡</th><th className="px-2 py-1 text-left">User-Agent</th>
              </tr></thead>
              <tbody>
                {p.sessions.map((s) => (
                  <tr key={s.id} className="border-t border-line/10 align-top">
                    <td className="px-2 py-1.5 whitespace-nowrap text-ink">{fmt(s.last_seen_at)}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-ink-dim">{fmt(s.playback_started_at)}</td>
                    <td className="px-2 py-1.5">{s.current_track_id ? <InlineCopy value={s.current_track_id} /> : <span className="text-ink-dim">—</span>}</td>
                    <td className="px-2 py-1.5 max-w-[220px] truncate text-ink-mute" title={s.user_agent ?? ''}>{s.user_agent ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminCard>
    </div>
  );
}

// ── Runtime (Decision Engine) ────────────────────────────────────────
const RULE_TYPES = ['default', 'time', 'daypart', 'weekday', 'weather', 'season', 'holiday', 'campaign', 'emergency'] as const;
const WEATHERS = ['', 'clear', 'cloudy', 'rain', 'snow', 'storm'];
const SEASONS = ['', 'spring', 'summer', 'autumn', 'winter'];
const WEEKDAYS = ['', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAYPARTS = ['', 'dawn', 'morning', 'afternoon', 'evening', 'night'];
const STORE_STATUSES = ['', 'open', 'closed'];

function RuntimeSection({ d, reload }: { d: BrandWorkspaceData; reload: () => Promise<void> }) {
  const brandId = d.brand.id;
  const [rules, setRules] = useState<BrandRuntimeRule[]>([]);
  const [loadingRules, setLoadingRules] = useState(true);
  const [editing, setEditing] = useState<BrandRuntimeRule | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const loadRules = useCallback(async () => {
    setLoadingRules(true);
    try { setRules(await adminListBrandRuntimeRules(brandId, false)); }
    catch (e) { toast.error(`규칙 조회 실패: ${(e as Error).message}`); }
    finally { setLoadingRules(false); }
  }, [brandId]);
  useEffect(() => { void loadRules(); }, [loadRules]);

  const afterChange = useCallback(async () => { await loadRules(); await reload(); }, [loadRules, reload]);

  async function act(id: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(id);
    try { await fn(); toast.success(ok); await afterChange(); }
    catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-3">
      <AdminAlert tone="info" title="Runtime Decision Engine"
        description="규칙(priority·conditions)으로 지금 어떤 Playlist/Media 가 선택될지 결정합니다. 날씨·공휴일은 아래 Simulation 값(수동)으로 미리봅니다. 실제 player 자동 적용은 후속 Phase." />

      <RuntimeSimulation brandId={brandId} />

      <AdminCard
        title={`Runtime Rules (${rules.length})`}
        subtitle="priority 높은 규칙 우선 · 동일 priority면 최신 수정 우선 · 매칭 없으면 default→활성 플리→자동생성 fallback."
        action={<AdminButton size="sm" tone="primary" leftIcon={<Plus size={13} />} onClick={() => setCreating(true)}>규칙 생성</AdminButton>}
      >
        {loadingRules ? <AdminSkeleton variant="block" rows={4} />
          : rules.length === 0 ? <AdminEmpty icon={<SlidersHorizontal size={22} />} title="규칙 없음" description="default 규칙부터 만들어 기본 Playlist를 지정하세요." />
          : (
            <div className="space-y-2">
              {rules.map((r) => (
                <div key={r.id} className="rounded-lg border border-line/20 bg-bg p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-sm font-bold text-ink">{r.name}</span>
                        <AdminBadge tone="info">{r.rule_type}</AdminBadge>
                        <AdminBadge tone={r.status === 'active' ? 'success' : 'neutral'}>{r.status === 'active' ? '활성' : '비활성'}</AdminBadge>
                        <span className="text-[11px] font-semibold text-ink-dim">priority {r.priority}</span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-ink-mute">
                        {r.playlist_name ? `▶ ${r.playlist_name}` : '▶ (playlist 없음)'}
                        {r.media_title ? ` · 🖼 ${r.media_title}` : ''}
                      </p>
                      <p className="mt-0.5 text-[11px] text-ink-dim">조건: {conditionSummary(r.conditions)} · 기간: {rangeSummary(r.starts_at, r.ends_at)}</p>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <AdminButton size="sm" variant="ghost" tone="neutral" disabled={busy === r.id} onClick={() => setEditing(r)}>수정</AdminButton>
                    <AdminButton size="sm" variant="ghost" tone="neutral" disabled={busy === r.id} leftIcon={<Power size={12} />}
                      onClick={() => act(r.id, () => adminUpdateBrandRuntimeRule({ ruleId: r.id, status: r.status === 'active' ? 'inactive' : 'active' }), '상태를 변경했어요')}>
                      {r.status === 'active' ? '비활성' : '활성'}
                    </AdminButton>
                    <AdminButton size="sm" variant="ghost" tone="danger" disabled={busy === r.id} leftIcon={<Trash2 size={12} />}
                      onClick={() => { if (confirm(`"${r.name}" 규칙을 삭제할까요? (soft delete)`)) void act(r.id, () => adminDeleteBrandRuntimeRule(r.id, true), '삭제했어요'); }}>
                      삭제
                    </AdminButton>
                  </div>
                </div>
              ))}
            </div>
          )}
      </AdminCard>

      {(creating || editing) && (
        <RuntimeRuleModal
          brandId={brandId} rule={editing} playlists={d.playlists} media={d.media}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={async () => { setCreating(false); setEditing(null); await afterChange(); }}
        />
      )}
    </div>
  );
}

function RuntimeSimulation({ brandId }: { brandId: string }) {
  const [dt, setDt] = useState('');
  const [daypart, setDaypart] = useState('');
  const [weather, setWeather] = useState('');
  const [season, setSeason] = useState('');
  const [weekday, setWeekday] = useState('');
  const [holiday, setHoliday] = useState('');
  const [storeStatus, setStoreStatus] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RuntimePreview | null>(null);

  function buildContext(): Record<string, unknown> {
    const c: Record<string, unknown> = {};
    if (dt) c.datetime = dt;
    if (daypart) c.daypart = daypart;
    if (weather) c.weather = weather;
    if (season) c.season = season;
    if (weekday) c.weekday = weekday;
    if (holiday) c.is_holiday = holiday === 'true';
    if (storeStatus) c.store_status = storeStatus;
    return c;
  }

  async function run() {
    setRunning(true);
    try { setResult(await adminPreviewBrandRuntime(brandId, buildContext())); }
    catch (e) { toast.error(`preview 실패: ${(e as Error).message}`); }
    finally { setRunning(false); }
  }

  return (
    <AdminCard title="Runtime Simulation" subtitle="컨텍스트를 입력하고 어떤 Playlist가 선택되는지 미리봅니다. (날씨/공휴일 수동 값)"
      action={<AdminButton size="sm" tone="primary" leftIcon={<PlayCircle size={14} />} disabled={running} onClick={() => void run()}>{running ? 'Preview 중…' : 'Preview Runtime'}</AdminButton>}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Field label="날짜/시간"><input type="datetime-local" className={inputSm} value={dt} onChange={(e) => setDt(e.target.value)} /></Field>
        <Field label="daypart"><SelectSm value={daypart} onChange={setDaypart} options={DAYPARTS} /></Field>
        <Field label="weather"><SelectSm value={weather} onChange={setWeather} options={WEATHERS} /></Field>
        <Field label="season"><SelectSm value={season} onChange={setSeason} options={SEASONS} /></Field>
        <Field label="weekday"><SelectSm value={weekday} onChange={setWeekday} options={WEEKDAYS} /></Field>
        <Field label="holiday"><SelectSm value={holiday} onChange={setHoliday} options={['', 'false', 'true']} /></Field>
        <Field label="store_status"><SelectSm value={storeStatus} onChange={setStoreStatus} options={STORE_STATUSES} /></Field>
      </div>
      {result && <RuntimePreviewResult r={result} />}
    </AdminCard>
  );
}

function RuntimePreviewResult({ r }: { r: RuntimePreview }) {
  return (
    <div className="mt-3 space-y-3 rounded-xl border border-line/20 bg-bg p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold text-ink-dim">선택 결과</span>
        {r.fallback_used
          ? <AdminBadge tone="warning">fallback · {r.fallback_reason}</AdminBadge>
          : <AdminBadge tone="success">rule 매칭</AdminBadge>}
        <span className="text-xs text-ink-dim">평가시각 {fmt(r.evaluated_at)}</span>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg bg-bg-card p-2">
          <p className="text-[10px] uppercase tracking-wider text-ink-dim">Selected Rule</p>
          <p className="text-sm font-bold text-ink">{r.selected_rule?.name ?? '— 규칙 없음 —'}</p>
          {r.selected_rule && <p className="text-[11px] text-ink-dim">{r.selected_rule.rule_type} · priority {r.selected_rule.priority}</p>}
        </div>
        <div className="rounded-lg bg-bg-card p-2">
          <p className="text-[10px] uppercase tracking-wider text-ink-dim">Selected Playlist</p>
          <p className="text-sm font-bold text-ink">{r.selected_playlist?.name ?? '—'}</p>
          {r.selected_playlist && <p className="text-[11px] text-ink-dim">{r.selected_playlist.type} · {r.selected_playlist.track_count}곡</p>}
        </div>
        <div className="rounded-lg bg-bg-card p-2">
          <p className="text-[10px] uppercase tracking-wider text-ink-dim">Selected Media</p>
          <p className="text-sm font-bold text-ink">{r.selected_media?.title ?? '—'}</p>
        </div>
      </div>

      <div>
        <p className="mb-1 text-[11px] font-semibold text-ink-dim">Explanation</p>
        <ol className="space-y-0.5">
          {r.explanation.map((e, i) => <li key={i} className="text-[11px] text-ink-mute">• {e}</li>)}
        </ol>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-[11px] font-semibold text-ink-dim">Matched Rules ({r.matched_rules.length})</p>
          {r.matched_rules.length === 0 ? <p className="text-[11px] text-ink-dim">없음</p> : (
            <ul className="space-y-0.5">
              {r.matched_rules.map((m) => (
                <li key={m.id} className="text-[11px] text-ink-mute">{m.name} <span className="text-ink-dim">({m.rule_type}, p{m.priority})</span></li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="mb-1 text-[11px] font-semibold text-ink-dim">Queue Preview ({r.queue_preview.length})</p>
          {r.queue_preview.length === 0 ? <p className="text-[11px] text-ink-dim">없음</p> : (
            <ol className="space-y-0.5">
              {r.queue_preview.map((t, i) => (
                <li key={t.id} className="truncate text-[11px] text-ink-mute">{i + 1}. {t.title ?? '(제목 없음)'}{t.artist ? ` · ${t.artist}` : ''}</li>
              ))}
            </ol>
          )}
        </div>
      </div>

      <div>
        <p className="mb-1 text-[11px] font-semibold text-ink-dim">Health ({r.health.score}/100)</p>
        <HealthChecks health={r.health} compact />
      </div>
    </div>
  );
}

function RuntimeRuleModal({ brandId, rule, playlists, media, onClose, onSaved }: {
  brandId: string; rule: BrandRuntimeRule | null;
  playlists: BrandWorkspaceData['playlists']; media: BrandWorkspaceData['media'];
  onClose: () => void; onSaved: () => Promise<void>;
}) {
  const isEdit = !!rule;
  const [name, setName] = useState(rule?.name ?? '');
  const [ruleType, setRuleType] = useState(rule?.rule_type ?? 'default');
  const [priority, setPriority] = useState(String(rule?.priority ?? 50));
  const [playlistId, setPlaylistId] = useState(rule?.playlist_id ?? '');
  const [mediaId, setMediaId] = useState(rule?.media_asset_id ?? '');
  const c = (rule?.conditions ?? {}) as Record<string, unknown>;
  const [weather, setWeather] = useState(String(c.weather ?? ''));
  const [season, setSeason] = useState(String(c.season ?? ''));
  const [weekday, setWeekday] = useState(String(c.weekday ?? ''));
  const [daypart, setDaypart] = useState(String(c.daypart ?? ''));
  const [holiday, setHoliday] = useState(c.is_holiday === undefined ? '' : String(c.is_holiday));
  const [storeStatus, setStoreStatus] = useState(String(c.store_status ?? ''));
  const [status, setStatus] = useState<'active' | 'inactive'>(rule?.status ?? 'active');
  const [saving, setSaving] = useState(false);

  function buildConditions(): Record<string, unknown> {
    const cond: Record<string, unknown> = {};
    if (weather) cond.weather = weather;
    if (season) cond.season = season;
    if (weekday) cond.weekday = weekday;
    if (daypart) cond.daypart = daypart;
    if (holiday) cond.is_holiday = holiday === 'true';
    if (storeStatus) cond.store_status = storeStatus;
    return cond;
  }

  async function submit() {
    if (!name.trim()) { toast.error('이름을 입력해주세요'); return; }
    const prio = Number(priority) || 50;
    setSaving(true);
    try {
      if (isEdit && rule) {
        await adminUpdateBrandRuntimeRule({
          ruleId: rule.id, name: name.trim(), ruleType, priority: prio,
          playlistId: playlistId || null, clearPlaylist: !playlistId,
          mediaAssetId: mediaId || null, clearMedia: !mediaId,
          conditions: buildConditions(), status,
        });
        toast.success('규칙을 수정했어요');
      } else {
        await adminCreateBrandRuntimeRule({
          brandId, name: name.trim(), ruleType, priority: prio,
          playlistId: playlistId || null, mediaAssetId: mediaId || null,
          conditions: buildConditions(), status,
        });
        toast.success('규칙을 생성했어요');
      }
      await onSaved();
    } catch (e) { toast.error(`저장 실패: ${(e as Error).message}`); }
    finally { setSaving(false); }
  }

  return (
    <AdminModal open onClose={onClose} title={isEdit ? '규칙 수정' : '새 Runtime 규칙'} size="md"
      footer={<><AdminButton tone="neutral" variant="subtle" onClick={onClose}>취소</AdminButton><AdminButton tone="primary" onClick={() => void submit()} disabled={saving}>{saving ? '저장 중…' : '저장'}</AdminButton></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="이름 *"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></Field>
          <Field label="priority"><input type="number" className={inputCls} value={priority} onChange={(e) => setPriority(e.target.value)} /></Field>
          <Field label="rule_type"><SelectCls value={ruleType} onChange={setRuleType} options={[...RULE_TYPES]} /></Field>
          <Field label="status">
            <SelectCls value={status} onChange={(v) => setStatus(v as 'active' | 'inactive')} options={['active', 'inactive']} />
          </Field>
          <Field label="연결 Playlist">
            <select className={inputCls} value={playlistId} onChange={(e) => setPlaylistId(e.target.value)}>
              <option value="">— 없음 (fallback) —</option>
              {playlists.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.type})</option>)}
            </select>
          </Field>
          <Field label="연결 Media">
            <select className={inputCls} value={mediaId} onChange={(e) => setMediaId(e.target.value)}>
              <option value="">— 없음 —</option>
              {media.map((m) => <option key={m.id} value={m.id}>{m.title || '(제목 없음)'}</option>)}
            </select>
          </Field>
        </div>

        <p className="pt-1 text-[11px] font-semibold text-ink-dim">조건 (비우면 무시 · 모두 비우면 항상 매칭 = default)</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Field label="weather"><SelectSm value={weather} onChange={setWeather} options={WEATHERS} /></Field>
          <Field label="season"><SelectSm value={season} onChange={setSeason} options={SEASONS} /></Field>
          <Field label="weekday"><SelectSm value={weekday} onChange={setWeekday} options={WEEKDAYS} /></Field>
          <Field label="daypart"><SelectSm value={daypart} onChange={setDaypart} options={DAYPARTS} /></Field>
          <Field label="holiday"><SelectSm value={holiday} onChange={setHoliday} options={['', 'false', 'true']} /></Field>
          <Field label="store_status"><SelectSm value={storeStatus} onChange={setStoreStatus} options={STORE_STATUSES} /></Field>
        </div>
        <p className="text-[11px] text-ink-dim">campaign/emergency 등 기간 기반 규칙의 시작/종료 일시는 후속 UI에서 확장됩니다. (RPC는 이미 지원)</p>
      </div>
    </AdminModal>
  );
}

function HealthChecks({ health, compact }: { health: BrandHealth; compact?: boolean }) {
  return (
    <div className={compact ? 'grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4' : 'grid grid-cols-1 gap-1.5 sm:grid-cols-2'}>
      {health.checks.map((c) => (
        <div key={c.key} className="flex items-center gap-1.5 text-[11px]">
          {c.passed ? <CheckCircle2 size={13} className={adminTones.success.icon} /> : <XCircle size={13} className={adminTones.danger.icon} />}
          <span className="text-ink-mute">{c.label}</span>
          {c.detail && !compact && <span className="ml-auto text-ink-dim">{c.detail}</span>}
        </div>
      ))}
    </div>
  );
}

function SelectSm({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: readonly string[] }) {
  return (
    <select className={inputSm} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => <option key={o} value={o}>{o === '' ? '— 무시 —' : o}</option>)}
    </select>
  );
}
function SelectCls({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: readonly string[] }) {
  return (
    <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function conditionSummary(cond: Record<string, unknown> | null | undefined): string {
  const entries = Object.entries(cond ?? {});
  if (entries.length === 0) return '항상(default)';
  return entries.map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('|') : String(v)}`).join(', ');
}
function rangeSummary(startsAt: string | null, endsAt: string | null): string {
  if (!startsAt && !endsAt) return '상시';
  return `${startsAt ? fmt(startsAt) : '~'} → ${endsAt ? fmt(endsAt) : '~'}`;
}

// ── Queue (Track Ordering Engine) ────────────────────────────────────
const STRATEGY_LABEL: Record<QueueStrategy, string> = {
  balanced_shuffle: 'Balanced Shuffle', sequential: 'Sequential', weighted: 'Weighted',
};

function QueueSection({ d, reload }: { d: BrandWorkspaceData; reload: () => Promise<void> }) {
  const brandId = d.brand.id;
  const [playlistId, setPlaylistId] = useState('');
  const [strategy, setStrategy] = useState<QueueStrategy>('balanced_shuffle');
  const [limit, setLimit] = useState('100');
  const [preview, setPreview] = useState<QueuePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [building, setBuilding] = useState(false);
  const [runs, setRuns] = useState<QueueRunListItem[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [detail, setDetail] = useState<QueueDetail | null>(null);

  const loadRuns = useCallback(async () => {
    setLoadingRuns(true);
    try { setRuns(await adminListBrandQueues(brandId)); }
    catch (e) { toast.error(`queue 조회 실패: ${(e as Error).message}`); }
    finally { setLoadingRuns(false); }
  }, [brandId]);
  useEffect(() => { void loadRuns(); }, [loadRuns]);

  const opts = () => ({ playlistId: playlistId || null, strategy, limit: Number(limit) || 100 });

  async function doPreview() {
    setPreviewing(true);
    try { setPreview(await adminPreviewBrandQueue(brandId, opts())); }
    catch (e) { toast.error(`preview 실패: ${(e as Error).message}`); }
    finally { setPreviewing(false); }
  }
  async function doBuild() {
    setBuilding(true);
    try {
      const r = await adminBuildBrandQueue(brandId, opts());
      toast.success(`Queue 생성 (트랙 ${r.stats.returned})`);
      setPreview({ ...r, seed: r.queue_run.seed ?? '', source_playlist_id: r.queue_run.playlist_id, runtime_rule_id: r.queue_run.runtime_rule_id, strategy: r.queue_run.strategy, fallback_used: r.stats.fallback_used });
      await loadRuns(); await reload();
    } catch (e) { toast.error(`build 실패: ${(e as Error).message}`); }
    finally { setBuilding(false); }
  }
  async function openDetail(id: string) {
    try { setDetail(await adminGetBrandQueue(id)); }
    catch (e) { toast.error(`상세 조회 실패: ${(e as Error).message}`); }
  }

  return (
    <div className="space-y-3">
      <AdminAlert tone="info" title="Queue Engine — Track Ordering"
        description="Runtime 이 선택한 Playlist 를 재생 순서(Track Queue)로 변환합니다. Player 강제 연동은 후속 Phase — 지금은 생성/미리보기 중심." />

      <AdminCard title="Queue Builder" subtitle="playlist(미지정 시 Runtime 자동 선택) + strategy 로 재생 순서를 생성합니다.">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Field label="Playlist">
            <select className={inputCls} value={playlistId} onChange={(e) => setPlaylistId(e.target.value)}>
              <option value="">— Runtime 자동 선택 —</option>
              {d.playlists.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.type})</option>)}
            </select>
          </Field>
          <Field label="Strategy">
            <select className={inputCls} value={strategy} onChange={(e) => setStrategy(e.target.value as QueueStrategy)}>
              {QUEUE_STRATEGIES.map((s) => <option key={s} value={s}>{STRATEGY_LABEL[s]}</option>)}
            </select>
          </Field>
          <Field label="Limit"><input type="number" className={inputCls} value={limit} min={1} max={500} onChange={(e) => setLimit(e.target.value)} /></Field>
          <div className="flex items-end gap-1.5">
            <AdminButton size="sm" variant="subtle" tone="neutral" leftIcon={<Eye size={13} />} disabled={previewing} onClick={() => void doPreview()}>{previewing ? '…' : 'Preview'}</AdminButton>
            <AdminButton size="sm" tone="primary" leftIcon={<Hammer size={13} />} disabled={building} onClick={() => void doBuild()}>{building ? '…' : 'Build'}</AdminButton>
          </div>
        </div>
        {preview && <QueuePreviewResult p={preview} />}
      </AdminCard>

      <AdminCard title={`Queue Runs (${runs.length})`} subtitle="최근 생성된 Queue (최대 30).">
        {loadingRuns ? <AdminSkeleton variant="block" rows={3} />
          : runs.length === 0 ? <AdminEmpty icon={<ListOrdered size={22} />} title="Queue 없음" description="Build 로 첫 Queue 를 생성하세요." />
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead className="text-ink-dim"><tr>
                  <th className="px-2 py-1 text-left">생성</th><th className="px-2 py-1 text-left">strategy</th>
                  <th className="px-2 py-1 text-right">트랙</th><th className="px-2 py-1 text-left">playlist</th>
                  <th className="px-2 py-1 text-left">status</th><th className="px-2 py-1 text-left"></th>
                </tr></thead>
                <tbody>
                  {runs.map((q) => (
                    <tr key={q.id} className="border-t border-line/10">
                      <td className="px-2 py-1.5 whitespace-nowrap text-ink-dim">{fmt(q.created_at)}</td>
                      <td className="px-2 py-1.5"><AdminBadge tone="info">{q.strategy}</AdminBadge></td>
                      <td className="px-2 py-1.5 text-right font-semibold text-ink">{q.track_count}</td>
                      <td className="px-2 py-1.5 text-ink-mute">{q.playlist_name ?? (q.reason ? `(${q.reason})` : '—')}</td>
                      <td className="px-2 py-1.5"><AdminBadge tone="neutral">{q.status}</AdminBadge></td>
                      <td className="px-2 py-1.5"><AdminButton size="sm" variant="ghost" tone="primary" onClick={() => void openDetail(q.id)}>상세</AdminButton></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </AdminCard>

      {detail && <QueueDetailModal detail={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function QueuePreviewResult({ p }: { p: QueuePreview }) {
  return (
    <div className="mt-3 space-y-3 rounded-xl border border-line/20 bg-bg p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold text-ink-dim">결과</span>
        <AdminBadge tone="info">{p.strategy}</AdminBadge>
        {p.fallback_used && <AdminBadge tone="warning">fallback</AdminBadge>}
        <span className="text-[11px] text-ink-dim">
          {p.stats.returned}/{p.stats.total_candidates}곡 · artist {p.stats.distinct_artists} · genre {p.stats.distinct_genres} · mood {p.stats.distinct_moods}
        </span>
      </div>
      <div>
        <p className="mb-1 text-[11px] font-semibold text-ink-dim">Explanation</p>
        <ol className="space-y-0.5">{p.explanation.map((e, i) => <li key={i} className="text-[11px] text-ink-mute">• {e}</li>)}</ol>
      </div>
      <div className="max-h-72 overflow-y-auto">
        <table className="w-full text-[11px]">
          <thead className="sticky top-0 bg-bg text-ink-dim"><tr>
            <th className="px-2 py-1 text-left">#</th><th className="px-2 py-1 text-left">Title</th>
            <th className="px-2 py-1 text-left">Artist</th><th className="px-2 py-1 text-left">Genre</th>
            <th className="px-2 py-1 text-left">Mood</th><th className="px-2 py-1 text-left">Source</th>
          </tr></thead>
          <tbody>
            {p.tracks.map((t, i) => (
              <tr key={`${t.track_id}-${i}`} className="border-t border-line/10">
                <td className="px-2 py-1 text-ink-dim">{i + 1}</td>
                <td className="px-2 py-1 text-ink">{t.title ?? '—'}</td>
                <td className="px-2 py-1 text-ink-mute">{t.artist ?? '—'}</td>
                <td className="px-2 py-1 text-ink-mute">{t.genre ?? '—'}</td>
                <td className="px-2 py-1 text-ink-mute">{t.mood ?? '—'}</td>
                <td className="px-2 py-1 text-ink-dim">{t.source_reason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function QueueDetailModal({ detail, onClose }: { detail: QueueDetail; onClose: () => void }) {
  const q = detail.queue_run;
  return (
    <AdminModal open onClose={onClose} title={`Queue · ${q.strategy}`} size="xl"
      footer={<AdminButton tone="neutral" variant="subtle" onClick={onClose}>닫기</AdminButton>}>
      <div className="space-y-3">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          <KV k="strategy" v={q.strategy} />
          <KV k="트랙 수" v={String(q.track_count)} />
          <KV k="status" v={q.status} />
          <KV k="reason" v={q.reason} />
          <KV k="seed" v={q.seed} mono abbrev />
          <KV k="생성" v={fmt(q.created_at)} />
          <KV k="queue_run_id" v={q.id} copy mono abbrev />
          <KV k="playlist_id" v={q.playlist_id} copy mono abbrev />
        </dl>
        <div className="max-h-[50vh] overflow-y-auto">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-bg-card text-ink-dim"><tr>
              <th className="px-2 py-1 text-left">#</th><th className="px-2 py-1 text-left">Title</th>
              <th className="px-2 py-1 text-left">Artist</th><th className="px-2 py-1 text-left">Genre</th>
              <th className="px-2 py-1 text-left">Mood</th><th className="px-2 py-1 text-right">BPM</th>
              <th className="px-2 py-1 text-left">Source</th>
            </tr></thead>
            <tbody>
              {detail.tracks.map((t) => (
                <tr key={`${t.track_id}-${t.sort_order}`} className="border-t border-line/10">
                  <td className="px-2 py-1 text-ink-dim">{t.sort_order + 1}</td>
                  <td className="px-2 py-1 text-ink">{t.title ?? '—'}</td>
                  <td className="px-2 py-1 text-ink-mute">{t.artist ?? '—'}</td>
                  <td className="px-2 py-1 text-ink-mute">{t.genre ?? '—'}</td>
                  <td className="px-2 py-1 text-ink-mute">{t.mood ?? '—'}</td>
                  <td className="px-2 py-1 text-right text-ink-mute">{t.bpm ?? '—'}</td>
                  <td className="px-2 py-1 text-ink-dim">{t.source_reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AdminModal>
  );
}

// ── AI (read-only profile) ───────────────────────────────────────────
function AiSection({ d }: { d: BrandWorkspaceData }) {
  const ai = d.ai_profile;
  return (
    <div className="space-y-3">
      <AdminAlert tone="info" title="Brand AI Profile (Read Only)"
        description="현재는 브랜드 음악 정책 기반 조회입니다. Weather/Holiday/Schedule/Auto Rotation 규칙은 후속 AI Music OS에서 저장·사용됩니다." />
      {!ai ? (
        <AdminEmpty title="AI Profile 없음" description="브랜드 음악 정책이 설정되면 표시됩니다." />
      ) : (
        <>
          <AdminCard title="음악 프로파일">
            <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
              <KV k="업종" v={ai.industry_type} />
              <KV k="Preferred Genres" v={csvOrDash(ai.preferred_genres)} />
              <KV k="Blocked Genres" v={csvOrDash(ai.blocked_genres)} />
              <KV k="Preferred Mood" v={csvOrDash(ai.preferred_moods)} />
              <KV k="Blocked Mood" v={csvOrDash(ai.blocked_moods)} />
              <KV k="Target Energy" v={`${ai.energy_min ?? '—'} ~ ${ai.energy_max ?? '—'}`} />
              <KV k="Target Vocal" v={ai.vocal_policy} />
              <KV k="Auto Playlist" v={ai.auto_generate_enabled ? '사용' : '미사용'} />
            </dl>
          </AdminCard>
          <AdminCard title="자동화 규칙 (후속)">
            <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
              <KV k="Target BPM" v={null} />
              <KV k="Weather Rule" v={null} />
              <KV k="Holiday Rule" v={null} />
              <KV k="Schedule Rule" v={null} />
              <KV k="Auto Media" v={null} />
              <KV k="Auto Rotation" v={null} />
            </dl>
            <p className="mt-2 text-[11px] text-ink-dim">후속 AI Music OS Phase에서 저장·적용됩니다.</p>
          </AdminCard>
        </>
      )}
    </div>
  );
}

// ── History ──────────────────────────────────────────────────────────
function HistorySection({ d }: { d: BrandWorkspaceData }) {
  return (
    <AdminCard title={`변경 이력 (최근 ${d.history.length})`} subtitle="브랜드 생성·정책·이미지·플레이리스트·플레이어 활동.">
      {d.history.length === 0 ? <AdminEmpty title="이력 없음" /> : (
        <div className="space-y-1.5">
          {d.history.map((h) => (
            <div key={h.id} className="flex items-start justify-between gap-2 border-b border-line/5 pb-1.5">
              <div className="min-w-0">
                <AdminBadge tone={actionTone(h.action)}>{h.action}</AdminBadge>
                {h.metadata && <span className="ml-2 text-[11px] text-ink-dim">{summarizeMeta(h.metadata)}</span>}
              </div>
              <span className="shrink-0 text-[11px] text-ink-dim">{fmt(h.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </AdminCard>
  );
}

// ── helpers ──────────────────────────────────────────────────────────
function SummaryRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-ink-dim">{k}</span>
      <span className="font-semibold text-ink">{v}</span>
    </div>
  );
}

function KV({ k, v, copy, mono, abbrev }: { k: string; v: string | null | undefined; copy?: boolean; mono?: boolean; abbrev?: boolean }) {
  const val = v ?? '—';
  const shown = abbrev && v && v.length > 12 ? `${v.slice(0, 8)}…` : val;
  return (
    <div className="flex items-start justify-between gap-2 border-b border-line/5 pb-1">
      <span className="shrink-0 text-[11px] text-ink-dim">{k}</span>
      <span className="flex items-center gap-1 text-right">
        <span className={`text-xs text-ink ${mono ? 'font-mono' : ''}`}>{shown}</span>
        {copy && v && <button type="button" title="복사" onClick={() => doCopy(v)} className="rounded p-0.5 text-ink-dim hover:bg-bg-hover hover:text-ink"><Copy size={11} /></button>}
      </span>
    </div>
  );
}

function InlineCopy({ value }: { value: string }) {
  return (
    <button type="button" title={value} onClick={() => doCopy(value)} className="inline-flex items-center gap-1 font-mono text-ink-dim hover:text-ink">
      {value.slice(0, 8)}… <Copy size={10} />
    </button>
  );
}

function actionTone(action: string): AdminToneName {
  if (action.includes('delete')) return 'danger';
  if (action.includes('create') || action.includes('clone')) return 'success';
  if (action.startsWith('playlist')) return 'info';
  return 'neutral';
}

function summarizeMeta(meta: Record<string, unknown>): string {
  const bits: string[] = [];
  if (meta.name) bits.push(String(meta.name));
  if (meta.type) bits.push(String(meta.type));
  if (meta.track_count != null) bits.push(`트랙 ${meta.track_count}`);
  if (meta.version != null) bits.push(`v${meta.version}`);
  if (meta.status) bits.push(String(meta.status));
  return bits.join(' · ');
}

function healthColor(score: number): string {
  const tone: 'success' | 'warning' | 'danger' = score >= 80 ? 'success' : score >= 50 ? 'warning' : 'danger';
  return adminTones[tone].text;
}

function csvOrDash(arr: string[] | null | undefined): string | null {
  const list = (arr ?? []).filter(Boolean);
  return list.length ? list.join(', ') : null;
}

function doCopy(v: string) {
  void navigator.clipboard?.writeText(v).then(() => toast.success('복사됨')).catch(() => toast.error('복사 실패'));
}

function fmt(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
}

const inputCls = 'w-full rounded-lg border border-line/25 bg-bg px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent/50';
const inputSm = 'w-full rounded border border-line/25 bg-bg px-2 py-1 text-xs text-ink outline-none focus:border-accent/50';
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (<label className="block space-y-1"><span className="text-[11px] font-semibold text-ink-mute">{label}</span>{children}</label>);
}
