export type SubscriptionType = 'free' | 'personal' | 'business';
export type UserRole = 'user' | 'admin';
export type TimeSlot = 'morning' | 'afternoon' | 'evening' | 'night';

export interface UserRow {
  id: string;
  nickname: string | null;
  role: UserRole;
  subscription_type: SubscriptionType;
  business_category: string | null;
  created_at: string;
  // 0014 / 0017 — 마이그레이션 적용 이후. legacy 환경에선 undefined.
  account_type?: 'individual' | 'business' | 'artist';
  artist_approval_status?: 'pending' | 'approved' | 'rejected' | null;
  membership_tier?: 'free' | 'individual' | 'business';
}

export interface TrackRow {
  id: string;
  title: string;
  artist: string | null;
  genre: string | null;
  mood: string | null;
  audio_url: string;
  cover_url: string | null;
  duration: number | null;
  created_at: string;
}

export interface PlaylistRow {
  id: string;
  title: string;
  category: string;
  business_category: string | null;
  thumbnail_url: string | null;
  description: string | null;
  is_business_only: boolean;
  time_slot: TimeSlot | null;
  sort_order: number;
  created_at: string;
  /** 큐레이터(작성자) user_id — 0013 마이그레이션 이후 추가. 기존 seed/admin 플리는 null 가능. */
  created_by_user_id?: string | null;
}

export interface PlaylistTrackRow {
  id: string;
  playlist_id: string;
  track_id: string;
  order_index: number;
}

export interface LikeRow {
  id: string;
  user_id: string;
  playlist_id: string;
  created_at: string;
}

export interface RecentPlayRow {
  id: string;
  user_id: string;
  playlist_id: string;
  played_at: string;
}

type TableShape<R, I = Partial<R>, U = Partial<R>> = {
  Row: R;
  Insert: I;
  Update: U;
  Relationships: [];
};

export interface Database {
  public: {
    Tables: {
      users: TableShape<UserRow, Partial<UserRow> & { id: string }>;
      tracks: TableShape<TrackRow>;
      playlists: TableShape<PlaylistRow>;
      playlist_tracks: TableShape<PlaylistTrackRow>;
      likes: TableShape<LikeRow>;
      recent_plays: TableShape<RecentPlayRow>;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
