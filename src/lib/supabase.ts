import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anon);

// Untyped client — 우리는 자체 Row 타입(@/types/db)으로 캐스팅해 사용합니다.
export const supabase = createClient(
  url || 'http://localhost:54321',
  anon || 'public-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);
