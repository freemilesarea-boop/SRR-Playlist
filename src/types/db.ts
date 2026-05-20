// 0029 부터 users.subscription_type CHECK 가 'individual' 도 허용 (PayApp paid 처리에서 사용).
// 'personal' 은 legacy 값으로 일부 기존 row 에 남아있을 수 있음.
export type SubscriptionType = 'free' | 'personal' | 'individual' | 'business';
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
  // 0054 — 영업인 추적
  sales_agent_id?: string | null;
  sales_agent_code?: string | null;
  // 0056 — 회원 탈퇴
  withdrawn_at?: string | null;
  withdrawn_reason?: string | null;
  // 0057 — 아티스트 계약서 상태
  contract_status?: 'not_created' | 'pending_signature' | 'signed' | 'rejected' | 'expired';
  // 0095 — 회원 비활성/마스킹
  disabled_at?: string | null;
  pii_masked_at?: string | null;
  // 0098 — 큐레이터 권한
  is_curator?: boolean;
}

export interface SalesAgentRow {
  id: string;
  user_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  code: string;
  commission_rate: number;
  is_active: boolean;
  note?: string | null;
  created_at: string;
  updated_at: string;
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
