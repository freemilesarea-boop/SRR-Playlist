import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Mail,
  Instagram,
  Youtube,
  Globe,
  CheckCircle2,
  Sparkles,
  Music,
  ArrowLeft,
} from 'lucide-react';
import { fetchCuratorProfile, type CuratorProfile } from '@/lib/curatorApi';
import { gradientStyle } from '@/lib/cover';
import AutoCover from '@/components/AutoCover';
import EmptyState from '@/components/common/EmptyState';

export default function CuratorProfilePage() {
  const { handle } = useParams<{ handle: string }>();
  const [profile, setProfile] = useState<CuratorProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!handle) return;
    let alive = true;
    setLoading(true);
    fetchCuratorProfile(handle)
      .then((p) => {
        if (alive) setProfile(p);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [handle]);

  const mailtoUrl = useMemo(() => {
    if (!profile?.contact_email) return null;
    const subject = encodeURIComponent(`듣다 — ${profile.display_name} 협업 문의`);
    return `mailto:${profile.contact_email}?subject=${subject}`;
  }, [profile]);

  if (loading) {
    return (
      <div className="space-y-6 px-4 pb-12 pt-6 sm:px-6">
        <div className="h-48 animate-pulse rounded-3xl bg-bg-card" />
        <div className="h-6 w-1/3 animate-pulse rounded bg-bg-card" />
        <div className="h-32 animate-pulse rounded-2xl bg-bg-card" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="space-y-3 px-4 py-16 text-center sm:px-6">
        <Sparkles size={28} className="mx-auto text-ink-dim" />
        <p className="text-sm text-ink-mute">큐레이터를 찾을 수 없어요.</p>
        <Link to="/" className="inline-flex rounded-full bg-bg-card px-3 py-1.5 text-xs hover:bg-bg-hover">
          홈으로
        </Link>
      </div>
    );
  }

  return (
    <div className="pb-12">
      {/* Hero */}
      <div className="relative overflow-hidden">
        <div
          className="absolute inset-0 scale-110 opacity-70 blur-3xl"
          style={gradientStyle(profile.handle)}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-bg/60 to-bg" />

        <div className="relative flex flex-col gap-5 p-5 pt-12 sm:flex-row sm:items-end sm:gap-6 sm:p-7 sm:pt-16">
          <Link
            to="/"
            className="absolute left-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 backdrop-blur"
          >
            <ArrowLeft size={18} />
          </Link>

          {/* Profile image */}
          <div className="aspect-square w-32 shrink-0 overflow-hidden rounded-full shadow-2xl ring-1 ring-white/15 sm:w-40">
            {profile.profile_image_url ? (
              <img
                src={profile.profile_image_url}
                alt={profile.display_name}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-bg-card text-3xl font-bold text-ink/80">
                {profile.display_name.slice(0, 1)}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-white/70">
              큐레이터 · @{profile.handle}
            </p>
            <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-white drop-shadow sm:text-4xl">
              {profile.display_name}
              {profile.is_verified && (
                <CheckCircle2 size={20} className="text-sky-400" aria-label="verified" />
              )}
              {profile.is_featured && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-bold text-accent ring-1 ring-accent/40">
                  <Sparkles size={10} /> Featured
                </span>
              )}
            </h1>
            {profile.bio && (
              <p className="max-w-2xl text-sm leading-relaxed text-white/85">{profile.bio}</p>
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/75">
              <span>
                <strong className="text-white">{profile.follower_count.toLocaleString()}</strong> 팔로워
              </span>
              <span>
                <strong className="text-white">{profile.playlist_count.toLocaleString()}</strong> 플레이리스트
              </span>
              <span>
                <strong className="text-white">{profile.total_playlist_streams.toLocaleString()}</strong> 누적 재생
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Action bar */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 bg-bg/90 px-4 py-3 backdrop-blur sm:px-6">
        {mailtoUrl && profile.allow_business_contact && (
          <a
            href={mailtoUrl}
            className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-xs font-bold text-bg shadow-sm hover:bg-accent/90"
          >
            <Mail size={14} /> 협업 문의하기
          </a>
        )}
        {profile.instagram_url && (
          <a
            href={profile.instagram_url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-ink/5 ring-1 ring-line/15 hover:bg-ink/10"
            aria-label="Instagram"
            title="Instagram"
          >
            <Instagram size={16} />
          </a>
        )}
        {profile.youtube_url && (
          <a
            href={profile.youtube_url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-ink/5 ring-1 ring-line/15 hover:bg-ink/10"
            aria-label="YouTube"
            title="YouTube"
          >
            <Youtube size={16} />
          </a>
        )}
        {profile.website_url && (
          <a
            href={profile.website_url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-ink/5 ring-1 ring-line/15 hover:bg-ink/10"
            aria-label="Website"
            title="Website"
          >
            <Globe size={16} />
          </a>
        )}
      </div>

      {/* 통계 카드 */}
      <section className="grid grid-cols-2 gap-3 px-4 pt-2 sm:grid-cols-4 sm:px-6">
        <StatCard label="누적 재생" value={profile.total_playlist_streams.toLocaleString()} />
        <StatCard label="이번 달" value={profile.monthly_streams.toLocaleString()} />
        <StatCard label="플레이리스트" value={profile.playlist_count.toLocaleString()} />
        <StatCard label="차트 진입" value={profile.chart_entries.toLocaleString()} />
      </section>

      {/* 플레이리스트 목록 */}
      <section className="space-y-3 px-4 pt-7 sm:px-6">
        <h2 className="flex items-center gap-1.5 text-lg font-bold tracking-tight sm:text-xl">
          <Music size={16} className="text-accent" /> 플레이리스트
        </h2>
        {profile.playlists.length === 0 ? (
          <EmptyState
            icon={<Music size={20} />}
            title="아직 공개된 플레이리스트가 없어요"
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {profile.playlists.map((p) => (
              <Link
                key={p.id}
                to={`/playlist/${p.id}`}
                className="group space-y-2"
              >
                <div className="relative aspect-square overflow-hidden rounded-2xl bg-bg-card shadow-card ring-1 ring-line/10 transition group-hover:-translate-y-0.5">
                  <AutoCover
                    title={p.title}
                    category={p.category}
                    imageUrl={p.thumbnail_url}
                    size="md"
                  />
                </div>
                <div className="space-y-0.5 px-0.5">
                  <p className="truncate text-sm font-semibold">{p.title}</p>
                  <p className="truncate text-xs text-ink-mute">
                    {p.stream_count.toLocaleString()} 재생 · 팔로워 {p.follower_count.toLocaleString()}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-bg-card p-3 ring-1 ring-line/10">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-dim">{label}</p>
      <p className="mt-0.5 text-lg font-extrabold tabular-nums">{value}</p>
    </div>
  );
}
