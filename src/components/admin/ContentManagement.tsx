import { useEffect, useMemo, useState } from 'react';
import { Plus, Music, ListMusic, Upload, Play, Pencil, Trash2, Save, X, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { fetchPlaylists, fetchTracks } from '@/lib/api';
import { fetchAllCurators, fetchMyCuratorProfile, type CuratorListItem } from '@/lib/curatorApi';
import { useAuthStore } from '@/store/authStore';
import { usePlayerStore } from '@/store/playerStore';
import { isPlayableUrl } from '@/lib/audio';
import { useFreshFetch } from '@/hooks/useFreshFetch';
import type { PlaylistRow, TrackRow } from '@/types/db';
import TrackUploader from '@/components/admin/TrackUploader';
import PlaylistEditor from '@/components/admin/PlaylistEditor';
import { adminHardDeleteTrack, adminUpdateTrackMetadata, type AdminTrackMetadataInput } from '@/lib/adminTrackApi';
import { toast } from '@/store/toastStore';

type SubTab = 'playlists' | 'tracks';

export default function ContentManagement() {
  const [subTab, setSubTab] = useState<SubTab>('playlists');
  const [playlists, setPlaylists] = useState<PlaylistRow[]>([]);
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [editingPlaylistId, setEditingPlaylistId] = useState<string | null>(null);
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const [showUploader, setShowUploader] = useState(false);

  async function refresh() {
    const [pls, trs] = await Promise.all([fetchPlaylists(), fetchTracks()]);
    setPlaylists(pls);
    setTracks(trs);
  }

  // 재로그인 / 새로고침 / 탭 복귀 시 항상 DB 에서 최신 fetch
  useFreshFetch(refresh, []);

  async function createPlaylist(form: {
    title: string;
    category: string;
    description: string;
    is_business_only: boolean;
    business_category: string | null;
    time_slot: string | null;
    created_by_user_id: string | null;
  }) {
    if (!form.title.trim()) {
      toast.error('플레이리스트 제목은 필수예요.');
      return;
    }
    if (!form.category.trim()) {
      toast.error('카테고리는 필수예요.');
      return;
    }
    const { data, error } = await supabase
      .from('playlists')
      .insert({
        title: form.title.trim(),
        category: form.category.trim(),
        description: form.description.trim() || null,
        is_business_only: form.is_business_only,
        business_category: form.business_category?.trim() || null,
        time_slot: (form.time_slot as PlaylistRow['time_slot']) || null,
        created_by_user_id: form.created_by_user_id,
      })
      .select('*')
      .single();
    if (error) {
      toast.error(`생성 실패: ${error.message}`);
      return;
    }
    toast.success('플레이리스트를 만들었어요.');
    await refresh();
    setCreatingPlaylist(false);
    if (data) setEditingPlaylistId(data.id);
  }

  async function deletePlaylist(id: string) {
    if (!confirm('정말 삭제하시겠어요?')) return;
    const { error } = await supabase.from('playlists').delete().eq('id', id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('플레이리스트를 삭제했어요.');
    await refresh();
  }

  async function deleteTrack(id: string, title: string) {
    if (!confirm(
      `'${title}' 을 완전히 삭제할까요?\n\n` +
      `· 음원 파일 (audio/cover) 즉시 제거 → 사이트 어디서도 재생 불가\n` +
      `· 정산/수익 기록이 없으면 DB 행도 완전 제거\n` +
      `· 정산 기록이 있으면 회계 보존 위해 행은 hidden 으로 남기지만 재생은 불가\n` +
      `· 되돌릴 수 없습니다.`,
    )) return;
    try {
      const result = await adminHardDeleteTrack(id);
      if (result.mode === 'soft_due_to_revenue') {
        toast.success(`'${title}' 음원 제거 (정산 보존을 위해 DB 행은 숨김 상태로 보존)`);
      } else {
        toast.success(`'${title}' 완전 삭제 완료`);
      }
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '삭제 실패');
    }
  }

  if (editingPlaylistId) {
    return (
      <PlaylistEditor
        playlistId={editingPlaylistId}
        allTracks={tracks}
        onClose={() => {
          setEditingPlaylistId(null);
          void refresh();
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <SubTabBtn active={subTab === 'playlists'} onClick={() => setSubTab('playlists')} icon={<ListMusic size={14} />}>
          플레이리스트 ({playlists.length})
        </SubTabBtn>
        <SubTabBtn active={subTab === 'tracks'} onClick={() => setSubTab('tracks')} icon={<Music size={14} />}>
          트랙 ({tracks.length})
        </SubTabBtn>
      </div>

      {subTab === 'playlists' && (
        <div className="space-y-3">
          {creatingPlaylist ? (
            <CreatePlaylistForm onSubmit={createPlaylist} onCancel={() => setCreatingPlaylist(false)} />
          ) : (
            <button onClick={() => setCreatingPlaylist(true)} className="btn-primary">
              <Plus size={14} /> 새 플레이리스트
            </button>
          )}

          <ul className="divide-y divide-line/10 overflow-hidden rounded-2xl bg-bg-card">
            {playlists.map((p) => (
              <li key={p.id} className="flex items-center gap-3 p-3 hover:bg-bg-hover">
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-gradient-to-br from-accent-soft/40 to-black">
                  {p.thumbnail_url ? (
                    <img src={p.thumbnail_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-ink-dim">
                      <ListMusic size={14} />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{p.title}</p>
                  <p className="truncate text-xs text-ink-mute">
                    {p.category}
                    {p.is_business_only && ' · 사업자'}
                    {p.time_slot && ` · ${p.time_slot}`}
                  </p>
                </div>
                <button
                  onClick={() => setEditingPlaylistId(p.id)}
                  className="rounded-md px-3 py-1.5 text-xs hover:bg-ink/10"
                >
                  편집
                </button>
                <button
                  onClick={() => deletePlaylist(p.id)}
                  className="rounded-md px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/10"
                >
                  삭제
                </button>
              </li>
            ))}
            {playlists.length === 0 && (
              <li className="p-6 text-center text-sm text-ink-mute">
                플레이리스트가 없어요. 새로 만들어보세요.
              </li>
            )}
          </ul>
        </div>
      )}

      {subTab === 'tracks' && (
        <AdminTrackList
          tracks={tracks}
          showUploader={showUploader}
          setShowUploader={setShowUploader}
          onUploaded={async () => { setShowUploader(false); await refresh(); }}
          onDelete={(id, title) => deleteTrack(id, title)}
          onUpdated={refresh}
        />
      )}
    </div>
  );
}

/** 트랙 리스트 + 검색 + 페이지네이션. 1000+ 트랙 처리 위해 50개씩 표시. */
function AdminTrackList({
  tracks, showUploader, setShowUploader, onUploaded, onDelete, onUpdated,
}: {
  tracks: TrackRow[];
  showUploader: boolean;
  setShowUploader: (b: boolean) => void;
  onUploaded: () => Promise<void>;
  onDelete: (id: string, title: string) => void;
  onUpdated: () => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(50);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tracks;
    return tracks.filter((t) =>
      t.title.toLowerCase().includes(q) ||
      (t.artist ?? '').toLowerCase().includes(q),
    );
  }, [tracks, query]);
  const visible = filtered.slice(0, visibleCount);

  return (
    <div className="space-y-3">
      {showUploader ? (
        <TrackUploader onUploaded={onUploaded} onCancel={() => setShowUploader(false)} />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setShowUploader(true)} className="btn-primary">
            <Upload size={14} /> 트랙 업로드
          </button>
          <div className="flex flex-1 items-center gap-2 rounded-xl bg-bg-card px-3 py-1.5 ring-1 ring-line/10">
            <Search size={14} className="text-ink-dim" />
            <input
              type="text"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setVisibleCount(50); }}
              placeholder="제목/아티스트로 검색…"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-dim"
            />
            {query && (
              <button onClick={() => setQuery('')} className="text-ink-dim hover:text-ink">
                <X size={12} />
              </button>
            )}
          </div>
          <span className="text-[11px] text-ink-mute">
            {filtered.length === tracks.length
              ? `${tracks.length}개`
              : `${filtered.length}/${tracks.length}개`}
          </span>
        </div>
      )}

      <ul className="divide-y divide-line/10 overflow-hidden rounded-2xl bg-bg-card">
        {visible.map((t) => (
          <AdminTrackRow key={t.id} track={t} onDelete={onDelete} onUpdated={onUpdated} />
        ))}
        {filtered.length === 0 && (
          <li className="p-6 text-center text-sm text-ink-mute">
            {query ? '검색 결과가 없어요.' : '업로드된 트랙이 없어요.'}
          </li>
        )}
      </ul>

      {visibleCount < filtered.length && (
        <div className="flex justify-center">
          <button
            onClick={() => setVisibleCount((c) => c + 50)}
            className="rounded-full bg-bg-card px-4 py-1.5 text-xs font-semibold text-ink-mute ring-1 ring-line/10 hover:bg-bg-hover hover:text-ink"
          >
            더 보기 ({filtered.length - visibleCount}개 남음)
          </button>
        </div>
      )}
    </div>
  );
}

const GENRE_OPTIONS = ['POP','House','R&B','K-POP','J-Pop','Lo-fi','Jazz','Indie Pop','Jazzhop','Hip-Hop','K-HipHop','Phonk','Chillhop','Ballad','Retro Pop','Instrumental','Electronic','Ambient','Classical','Lounge','Soul','Funk'] as const;
const MOOD_OPTIONS = ['차분한','밝은','트렌디한','따뜻한','몽환적인','신나는','감각적인','고급스러운','활기찬','편안한','세련된'] as const;
const TEMPO_OPTIONS = [{ v: 'slow', l: '느림' }, { v: 'mid', l: '중간' }, { v: 'fast', l: '빠름' }] as const;

/** 단일 트랙 행 — 재생/편집/삭제 + 메타 인라인 수정. */
function AdminTrackRow({
  track, onDelete, onUpdated,
}: {
  track: TrackRow;
  onDelete: (id: string, title: string) => void;
  onUpdated: () => Promise<void>;
}) {
  const setQueue = usePlayerStore((s) => s.setQueue);
  const currentTrackId = usePlayerStore((s) => s.queue[s.index]?.id ?? null);
  const isPlaying = usePlayerStore((s) => s.playing);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<AdminTrackMetadataInput>({});

  // tracks 타입에 main_genre/sub_genre/mood/energy_level/bpm/tempo_feel 가 빠진 경우 unknown 캐스팅으로 접근.
  // db 에는 0237/0238 마이그레이션으로 존재.
  const raw = track as unknown as TrackRow & {
    main_genre?: string | null; sub_genre?: string | null;
    mood?: string | null; energy_level?: number | null;
    bpm?: number | null; tempo_feel?: string | null;
    instrumental?: boolean | null;
  };

  const playable = isPlayableUrl(track.audio_url);
  const isThisPlaying = currentTrackId === track.id && isPlaying;

  function startEdit() {
    setDraft({
      title: track.title, artist: track.artist,
      main_genre: raw.main_genre ?? null, sub_genre: raw.sub_genre ?? null, mood: raw.mood ?? null,
      energy_level: raw.energy_level ?? null, bpm: raw.bpm ?? null,
      tempo_feel: raw.tempo_feel ?? null, instrumental: raw.instrumental ?? null,
    });
    setEditing(true);
  }

  function play() {
    if (!playable) {
      toast.info('재생 가능한 음원이 없어요.');
      return;
    }
    setQueue([track], 0, null);
  }

  async function save() {
    setSaving(true);
    try {
      await adminUpdateTrackMetadata(track.id, draft);
      toast.success('메타데이터 저장 완료');
      setEditing(false);
      await onUpdated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '저장 실패');
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="border-b border-line/5 last:border-b-0">
      <div className="flex items-center gap-3 p-3 hover:bg-bg-hover">
        <button
          onClick={play}
          disabled={!playable}
          className={`relative h-10 w-10 shrink-0 overflow-hidden rounded-md ${
            playable ? 'ring-1 ring-line/10' : 'opacity-50'
          }`}
          title={playable ? '재생' : '재생 불가'}
        >
          {track.cover_url ? (
            <img src={track.cover_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-bg-hover text-ink-dim">
              <Music size={14} />
            </div>
          )}
          <div className={`absolute inset-0 flex items-center justify-center bg-black/40 ${
            isThisPlaying ? 'opacity-100' : 'opacity-0 hover:opacity-100'
          } transition`}>
            <Play size={14} fill="currentColor" className="text-white" />
          </div>
        </button>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {track.title}
            {isThisPlaying && <span className="ml-1.5 text-[10px] text-accent">▶ 재생 중</span>}
          </p>
          <p className="truncate text-xs text-ink-mute">
            {track.artist ?? '—'}
            {(raw.main_genre || raw.sub_genre) && (
              <span className="ml-1.5 text-ink-dim">
                · {raw.main_genre ?? ''}{raw.sub_genre ? ` / ${raw.sub_genre}` : ''}
              </span>
            )}
            {raw.energy_level != null && (
              <span className="ml-1.5 rounded bg-accent/15 px-1 text-[9px] font-bold text-accent">E{raw.energy_level}</span>
            )}
            {raw.bpm != null && (
              <span className="ml-1 rounded bg-bg-soft px-1 text-[9px] font-bold text-ink-mute">{raw.bpm} BPM</span>
            )}
          </p>
        </div>

        <span className={`hidden rounded-full px-2 py-0.5 text-[10px] sm:inline ${
          playable ? 'bg-emerald-500/15 text-emerald-200' : 'bg-yellow-500/15 text-yellow-200'
        }`}>
          {playable ? '재생가능' : '음원 없음'}
        </span>

        <button
          onClick={() => editing ? setEditing(false) : startEdit()}
          className={`rounded-md px-2.5 py-1.5 text-xs ${
            editing ? 'bg-accent text-black' : 'text-ink-mute hover:bg-ink/10 hover:text-ink'
          }`}
          title="메타데이터 편집"
        >
          <Pencil size={12} className="inline" /> 편집
        </button>
        <button
          onClick={() => onDelete(track.id, track.title)}
          className="rounded-md px-2.5 py-1.5 text-xs text-red-300 hover:bg-red-500/10"
          title="완전 삭제 (DB + 스토리지)"
        >
          <Trash2 size={12} className="inline" /> 삭제
        </button>
      </div>

      {editing && (
        <div className="grid grid-cols-2 gap-2 border-t border-line/10 bg-bg-soft px-3 py-3 sm:grid-cols-4">
          <Field label="제목" colSpan={2}>
            <input
              value={draft.title ?? ''} onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              className="input h-8 text-xs"
            />
          </Field>
          <Field label="아티스트" colSpan={2}>
            <input
              value={draft.artist ?? ''} onChange={(e) => setDraft({ ...draft, artist: e.target.value })}
              className="input h-8 text-xs"
            />
          </Field>

          <Field label="메인 장르">
            <select
              value={draft.main_genre ?? ''} onChange={(e) => setDraft({ ...draft, main_genre: e.target.value || null })}
              className="input h-8 text-xs"
            >
              <option value="">—</option>
              {GENRE_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </Field>
          <Field label="서브 장르">
            <input
              value={draft.sub_genre ?? ''} onChange={(e) => setDraft({ ...draft, sub_genre: e.target.value })}
              placeholder="예: City Pop" className="input h-8 text-xs"
            />
          </Field>
          <Field label="무드">
            <select
              value={draft.mood ?? ''} onChange={(e) => setDraft({ ...draft, mood: e.target.value || null })}
              className="input h-8 text-xs"
            >
              <option value="">—</option>
              {MOOD_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="템포">
            <select
              value={draft.tempo_feel ?? ''} onChange={(e) => setDraft({ ...draft, tempo_feel: e.target.value || null })}
              className="input h-8 text-xs"
            >
              <option value="">—</option>
              {TEMPO_OPTIONS.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
            </select>
          </Field>

          <Field label="에너지 (1-5)">
            <input
              type="number" min={1} max={5}
              value={draft.energy_level ?? ''} onChange={(e) => setDraft({ ...draft, energy_level: e.target.value ? Number(e.target.value) : null })}
              className="input h-8 text-xs"
            />
          </Field>
          <Field label="BPM">
            <input
              type="number" min={0} max={400}
              value={draft.bpm ?? ''} onChange={(e) => setDraft({ ...draft, bpm: e.target.value ? Number(e.target.value) : null })}
              className="input h-8 text-xs"
            />
          </Field>
          <Field label="Instrumental">
            <label className="flex h-8 items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={!!draft.instrumental}
                onChange={(e) => setDraft({ ...draft, instrumental: e.target.checked })}
                className="h-4 w-4 rounded border-line/30 bg-bg-card accent-accent"
              />
              가사 없음
            </label>
          </Field>

          <div className="col-span-2 flex items-center justify-end gap-2 sm:col-span-4">
            <button onClick={() => setEditing(false)} className="btn-ghost h-8 text-xs">
              <X size={11} /> 취소
            </button>
            <button onClick={save} disabled={saving} className="btn-primary h-8 text-xs">
              <Save size={11} /> {saving ? '저장 중…' : '저장'}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function Field({ label, children, colSpan = 1 }: { label: string; children: React.ReactNode; colSpan?: 1 | 2 }) {
  return (
    <label className={`block space-y-1 ${colSpan === 2 ? 'col-span-2' : ''}`}>
      <span className="text-[9px] font-bold uppercase tracking-wider text-ink-dim">{label}</span>
      {children}
    </label>
  );
}

function SubTabBtn({
  children,
  active,
  onClick,
  icon,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
        active ? 'bg-accent text-black' : 'bg-bg-card text-ink-mute hover:text-ink'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function CreatePlaylistForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (f: {
    title: string;
    category: string;
    description: string;
    is_business_only: boolean;
    business_category: string | null;
    time_slot: string | null;
    created_by_user_id: string | null;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('카페 음악');
  const [description, setDescription] = useState('');
  const [businessOnly, setBusinessOnly] = useState(false);
  const [businessCategory, setBusinessCategory] = useState('');
  const [timeSlot, setTimeSlot] = useState('');
  const [curators, setCurators] = useState<CuratorListItem[]>([]);
  const [createdBy, setCreatedBy] = useState<string>('');
  const [busy, setBusy] = useState(false);

  // 큐레이터 목록 + 기본값 (로그인 사용자가 큐레이터 프로필 있으면 본인)
  useEffect(() => {
    let alive = true;
    void fetchAllCurators().then(async (list) => {
      if (!alive) return;
      setCurators(list);
      if (userId) {
        const mine = await fetchMyCuratorProfile(userId);
        if (alive && mine) {
          // 본인 user_id 가 목록에 있으면 자동 선택
          const me = list.find((c) => c.user_id === userId);
          if (me) setCreatedBy(userId);
        }
      }
    });
    return () => {
      alive = false;
    };
  }, [userId]);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        await onSubmit({
          title,
          category,
          description,
          is_business_only: businessOnly,
          business_category: businessOnly ? businessCategory || null : null,
          time_slot: timeSlot || null,
          created_by_user_id: createdBy || null,
        });
        setBusy(false);
      }}
      className="space-y-3 rounded-2xl bg-bg-card p-4"
    >
      <input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="플레이리스트 제목" className="input" />
      <input required value={category} onChange={(e) => setCategory(e.target.value)} placeholder="카테고리 (예: 카페 음악)" className="input" />
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="설명 (선택)" className="input min-h-[80px]" />

      <label className="block space-y-1">
        <span className="block text-[11px] font-semibold uppercase tracking-wider text-ink-mute">큐레이터</span>
        <select
          value={createdBy}
          onChange={(e) => setCreatedBy(e.target.value)}
          className="input"
        >
          <option value="">— 큐레이터 없음 —</option>
          {curators.map((c) => (
            <option key={c.user_id} value={c.user_id}>
              {c.display_name} (@{c.handle}){c.is_verified ? ' ✓' : ''}
            </option>
          ))}
        </select>
        {curators.length === 0 && (
          <span className="block text-[11px] text-ink-dim">
            아직 큐레이터 프로필이 없어요. 프로필 페이지에서 본인 큐레이터 프로필을 먼저 만들어주세요.
          </span>
        )}
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={businessOnly} onChange={(e) => setBusinessOnly(e.target.checked)} />
        사업자 전용
      </label>
      {businessOnly && (
        <input value={businessCategory} onChange={(e) => setBusinessCategory(e.target.value)} placeholder="업종 (예: 카페, 와인바)" className="input" />
      )}
      <select value={timeSlot} onChange={(e) => setTimeSlot(e.target.value)} className="input">
        <option value="">시간대 (선택 없음)</option>
        <option value="morning">오전</option>
        <option value="afternoon">오후</option>
        <option value="evening">저녁</option>
        {/* 'night' 옵션은 0215 마이그에서 evening 으로 흡수됨 — 매장 schedules 모델과 일치 */}
      </select>
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="btn-primary flex-1">
          {busy ? '생성 중…' : '만들기'}
        </button>
        <button type="button" onClick={onCancel} className="btn-ghost">
          취소
        </button>
      </div>
    </form>
  );
}
