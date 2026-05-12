import { useEffect, useState } from 'react';
import { Plus, Music, ListMusic, Upload, CreditCard } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { fetchPlaylists, fetchTracks } from '@/lib/api';
import type { PlaylistRow, TrackRow } from '@/types/db';
import TrackUploader from '@/components/admin/TrackUploader';
import PlaylistEditor from '@/components/admin/PlaylistEditor';
import OnboardingChecklist from '@/components/admin/OnboardingChecklist';
import SubscriptionRequests from '@/components/admin/SubscriptionRequests';
import { toast } from '@/store/toastStore';

type Tab = 'playlists' | 'tracks' | 'subscriptions';

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('playlists');
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

  useEffect(() => {
    void refresh();
  }, []);

  async function createPlaylist(form: {
    title: string;
    category: string;
    description: string;
    is_business_only: boolean;
    business_category: string | null;
    time_slot: string | null;
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
      })
      .select('*')
      .single();
    if (error) {
      toast.error(`생성 실패: ${error.message}`);
      return;
    }
    toast.success('플레이리스트를 만들었어요. 트랙을 추가해보세요.');
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

  async function deleteTrack(id: string) {
    if (!confirm('이 트랙을 삭제하시겠어요?')) return;
    const { error } = await supabase.from('tracks').delete().eq('id', id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('트랙을 삭제했어요.');
    await refresh();
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
    <div className="space-y-6 px-4 pb-8 pt-6 sm:px-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">관리자</h1>
        <p className="text-xs text-ink-mute">음원 업로드, 플레이리스트 편성, 구독 신청 관리</p>
      </header>

      <OnboardingChecklist tracks={tracks} playlists={playlists} />

      <div className="flex flex-wrap gap-2">
        <TabBtn active={tab === 'playlists'} onClick={() => setTab('playlists')} icon={<ListMusic size={14} />}>
          플레이리스트 ({playlists.length})
        </TabBtn>
        <TabBtn active={tab === 'tracks'} onClick={() => setTab('tracks')} icon={<Music size={14} />}>
          트랙 ({tracks.length})
        </TabBtn>
        <TabBtn
          active={tab === 'subscriptions'}
          onClick={() => setTab('subscriptions')}
          icon={<CreditCard size={14} />}
        >
          구독 신청
        </TabBtn>
      </div>

      {tab === 'playlists' && (
        <div className="space-y-3">
          {creatingPlaylist ? (
            <CreatePlaylistForm
              onSubmit={createPlaylist}
              onCancel={() => setCreatingPlaylist(false)}
            />
          ) : (
            <button onClick={() => setCreatingPlaylist(true)} className="btn-primary">
              <Plus size={14} /> 새 플레이리스트
            </button>
          )}

          <ul className="divide-y divide-white/5 overflow-hidden rounded-2xl bg-bg-card">
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
                  className="rounded-md px-3 py-1.5 text-xs hover:bg-white/10"
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

      {tab === 'tracks' && (
        <div className="space-y-3">
          {showUploader ? (
            <TrackUploader
              onUploaded={async () => {
                setShowUploader(false);
                await refresh();
              }}
              onCancel={() => setShowUploader(false)}
            />
          ) : (
            <button onClick={() => setShowUploader(true)} className="btn-primary">
              <Upload size={14} /> 트랙 업로드
            </button>
          )}

          <ul className="divide-y divide-white/5 overflow-hidden rounded-2xl bg-bg-card">
            {tracks.map((t) => {
              const playable = t.audio_url && t.audio_url.trim().length > 0;
              return (
                <li key={t.id} className="flex items-center gap-3 p-3 hover:bg-bg-hover">
                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-bg-hover">
                    {t.cover_url ? (
                      <img src={t.cover_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-ink-dim">
                        <Music size={14} />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{t.title}</p>
                    <p className="truncate text-xs text-ink-mute">{t.artist ?? '—'}</p>
                  </div>
                  <span
                    className={`hidden rounded-full px-2 py-0.5 text-[10px] sm:inline ${
                      playable ? 'bg-emerald-500/15 text-emerald-200' : 'bg-yellow-500/15 text-yellow-200'
                    }`}
                  >
                    {playable ? '재생가능' : '음원 없음'}
                  </span>
                  <button
                    onClick={() => deleteTrack(t.id)}
                    className="rounded-md px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/10"
                  >
                    삭제
                  </button>
                </li>
              );
            })}
            {tracks.length === 0 && (
              <li className="p-6 text-center text-sm text-ink-mute">
                업로드된 트랙이 없어요.
              </li>
            )}
          </ul>
        </div>
      )}

      {tab === 'subscriptions' && <SubscriptionRequests />}
    </div>
  );
}

function TabBtn({
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
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('카페 음악');
  const [description, setDescription] = useState('');
  const [businessOnly, setBusinessOnly] = useState(false);
  const [businessCategory, setBusinessCategory] = useState('');
  const [timeSlot, setTimeSlot] = useState('');
  const [busy, setBusy] = useState(false);

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
        });
        setBusy(false);
      }}
      className="space-y-3 rounded-2xl bg-bg-card p-4"
    >
      <input
        required
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="플레이리스트 제목"
        className="input"
      />
      <input
        required
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        placeholder="카테고리 (예: 카페 음악)"
        className="input"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="설명 (선택)"
        className="input min-h-[80px]"
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={businessOnly}
          onChange={(e) => setBusinessOnly(e.target.checked)}
        />
        사업자 전용
      </label>
      {businessOnly && (
        <input
          value={businessCategory}
          onChange={(e) => setBusinessCategory(e.target.value)}
          placeholder="업종 (예: 카페, 와인바)"
          className="input"
        />
      )}
      <select
        value={timeSlot}
        onChange={(e) => setTimeSlot(e.target.value)}
        className="input"
      >
        <option value="">시간대 (선택 없음)</option>
        <option value="morning">오전</option>
        <option value="afternoon">오후</option>
        <option value="evening">저녁</option>
        <option value="night">밤</option>
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
