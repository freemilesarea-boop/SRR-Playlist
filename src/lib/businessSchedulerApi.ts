import { supabase } from './supabase';
import { getKstHour } from './timeTheme';

export interface BusinessProfile {
  id?: string;
  user_id: string;
  store_name: string | null;
  business_type: string | null;
  timezone: string;
  open_time: string | null; // 'HH:MM:SS' or 'HH:MM'
  close_time: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface BusinessSchedule {
  id: string;
  user_id: string;
  day_of_week: number; // 0=Sunday, 6=Saturday
  slot_name: string;
  start_time: string; // 'HH:MM:SS' or 'HH:MM'
  end_time: string;
  playlist_id: string | null;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'] as const;
export const DAY_LABELS_FULL = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'] as const;

/** 기본 템플릿 — 업종별 시간대 */
export interface ScheduleTemplate {
  slot_name: string;
  start_time: string;
  end_time: string;
  /** 매칭에 사용할 키워드 (제목/카테고리에 포함된 플리 검색용) */
  match_keywords: string[];
}

export const TEMPLATES: Record<string, ScheduleTemplate[]> = {
  카페: [
    { slot_name: '오픈 준비', start_time: '08:00', end_time: '10:00', match_keywords: ['카페', '잔잔', '오전'] },
    { slot_name: '오전 카페', start_time: '10:00', end_time: '12:00', match_keywords: ['카페', '오전', '보사'] },
    { slot_name: '점심 피크', start_time: '12:00', end_time: '15:00', match_keywords: ['카페', '라운지', '오후'] },
    { slot_name: '오후 집중', start_time: '15:00', end_time: '18:00', match_keywords: ['공부', '집중', '라운지'] },
    { slot_name: '저녁 감성', start_time: '18:00', end_time: '21:00', match_keywords: ['저녁', '감성', '와인'] },
    { slot_name: '마감', start_time: '21:00', end_time: '23:00', match_keywords: ['새벽', '수면', '잔잔'] },
  ],
  와인바: [
    { slot_name: '오픈', start_time: '17:00', end_time: '19:00', match_keywords: ['재즈', '라운지'] },
    { slot_name: '메인 타임', start_time: '19:00', end_time: '22:00', match_keywords: ['와인', '재즈', '저녁'] },
    { slot_name: '마감 전', start_time: '22:00', end_time: '24:00', match_keywords: ['감성', '새벽'] },
  ],
  PT샵: [
    { slot_name: '오전 운동', start_time: '06:00', end_time: '12:00', match_keywords: ['PT', '운동', '펌핑'] },
    { slot_name: '오후 운동', start_time: '12:00', end_time: '17:00', match_keywords: ['PT', '운동'] },
    { slot_name: '저녁 피크', start_time: '17:00', end_time: '22:00', match_keywords: ['PT', '운동', '펌핑'] },
  ],
  필라테스: [
    { slot_name: '오전 클래스', start_time: '07:00', end_time: '12:00', match_keywords: ['필라테스', '흐름'] },
    { slot_name: '오후 클래스', start_time: '14:00', end_time: '20:00', match_keywords: ['필라테스', '흐름'] },
  ],
  네일샵: [
    { slot_name: '오픈', start_time: '10:00', end_time: '14:00', match_keywords: ['네일', '카페'] },
    { slot_name: '오후', start_time: '14:00', end_time: '20:00', match_keywords: ['네일', '라운지'] },
  ],
  편집샵: [
    { slot_name: '오픈', start_time: '11:00', end_time: '17:00', match_keywords: ['편집', '시그니처'] },
    { slot_name: '저녁', start_time: '17:00', end_time: '21:00', match_keywords: ['편집', '감성'] },
  ],
};

export const TEMPLATE_KEYS = Object.keys(TEMPLATES);

/* ---------- Profile ---------- */

export async function fetchBusinessProfile(userId: string): Promise<BusinessProfile | null> {
  const { data, error } = await supabase
    .from('business_profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return null;
  return data as BusinessProfile | null;
}

export async function upsertBusinessProfile(
  profile: Omit<BusinessProfile, 'id' | 'created_at' | 'updated_at'>,
): Promise<BusinessProfile | null> {
  const { data, error } = await supabase
    .from('business_profiles')
    .upsert(profile, { onConflict: 'user_id' })
    .select('*')
    .single();
  if (error) throw error;
  return data as BusinessProfile;
}

/* ---------- Schedules ---------- */

export async function fetchBusinessSchedules(userId: string): Promise<BusinessSchedule[]> {
  const { data, error } = await supabase
    .from('business_music_schedules')
    .select('*')
    .eq('user_id', userId)
    .order('day_of_week', { ascending: true })
    .order('start_time', { ascending: true });
  if (error) throw error;
  return (data ?? []) as BusinessSchedule[];
}

export async function createSchedule(payload: {
  user_id: string;
  day_of_week: number;
  slot_name: string;
  start_time: string;
  end_time: string;
  playlist_id?: string | null;
  is_active?: boolean;
}): Promise<BusinessSchedule | null> {
  const { data, error } = await supabase
    .from('business_music_schedules')
    .insert(payload)
    .select('*')
    .single();
  if (error) throw error;
  return data as BusinessSchedule;
}

export async function updateSchedule(
  id: string,
  patch: Partial<BusinessSchedule>,
): Promise<void> {
  const { error } = await supabase
    .from('business_music_schedules')
    .update(patch)
    .eq('id', id);
  if (error) throw error;
}

export async function deleteSchedule(id: string): Promise<void> {
  const { error } = await supabase
    .from('business_music_schedules')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

/* ---------- Default schedule generation ---------- */

/**
 * 업종별 기본 스케줄 생성.
 * 각 시간대에 대해 keywords 와 가장 잘 맞는 플리를 자동 매칭.
 */
export async function createDefaultSchedules(
  userId: string,
  businessType: string,
  daysOfWeek: number[] = [0, 1, 2, 3, 4, 5, 6],
): Promise<{ created: number }> {
  const templates = TEMPLATES[businessType] ?? TEMPLATES['카페'];

  // 모든 플리 조회
  const { data: pls } = await supabase
    .from('playlists')
    .select('id, title, category, business_category, is_business_only');
  const playlists = (pls ?? []) as Array<{
    id: string;
    title: string;
    category: string;
    business_category: string | null;
    is_business_only: boolean;
  }>;

  function findPlaylist(keywords: string[]): string | null {
    // 1. business_only + 키워드 매칭
    for (const pl of playlists.filter((p) => p.is_business_only)) {
      for (const k of keywords) {
        if (pl.title.includes(k) || pl.category.includes(k) || pl.business_category?.includes(k)) {
          return pl.id;
        }
      }
    }
    // 2. 일반 + 키워드 매칭
    for (const pl of playlists) {
      for (const k of keywords) {
        if (pl.title.includes(k) || pl.category.includes(k)) return pl.id;
      }
    }
    // 3. 첫 번째 플리 폴백
    return playlists[0]?.id ?? null;
  }

  const rows = daysOfWeek.flatMap((day) =>
    templates.map((tmpl) => ({
      user_id: userId,
      day_of_week: day,
      slot_name: tmpl.slot_name,
      start_time: tmpl.start_time,
      end_time: tmpl.end_time,
      playlist_id: findPlaylist(tmpl.match_keywords),
      is_active: true,
    })),
  );

  const { error } = await supabase.from('business_music_schedules').insert(rows);
  if (error) throw error;
  return { created: rows.length };
}

/* ---------- 현재/다음 스케줄 계산 ---------- */

function parseTime(s: string): { h: number; m: number } {
  // 'HH:MM' or 'HH:MM:SS'
  const parts = s.split(':');
  return { h: Number(parts[0] ?? 0), m: Number(parts[1] ?? 0) };
}

function minutesOf(s: string): number {
  const { h, m } = parseTime(s);
  return h * 60 + m;
}

/** KST 현재 요일/분 단위 시간 */
export function nowKstParts(now: Date = new Date()): { day: number; minutes: number } {
  const utc = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
  const kst = new Date(utc + 9 * 60 * 60 * 1000);
  return {
    day: kst.getDay(),
    minutes: kst.getHours() * 60 + kst.getMinutes(),
  };
}

export function getCurrentSchedule(
  schedules: BusinessSchedule[],
  now: Date = new Date(),
): BusinessSchedule | null {
  const { day, minutes } = nowKstParts(now);
  const matches = schedules
    .filter(
      (s) =>
        s.is_active &&
        s.day_of_week === day &&
        minutesOf(s.start_time) <= minutes &&
        minutes < minutesOf(s.end_time),
    )
    .sort((a, b) => minutesOf(a.start_time) - minutesOf(b.start_time));
  return matches[0] ?? null;
}

export function getNextSchedule(
  schedules: BusinessSchedule[],
  now: Date = new Date(),
): BusinessSchedule | null {
  const { day, minutes } = nowKstParts(now);
  // 오늘 안에서 시작 시간이 현재 이후
  const today = schedules
    .filter((s) => s.is_active && s.day_of_week === day && minutesOf(s.start_time) > minutes)
    .sort((a, b) => minutesOf(a.start_time) - minutesOf(b.start_time));
  if (today[0]) return today[0];
  // 다음 날부터
  for (let i = 1; i <= 7; i++) {
    const nextDay = (day + i) % 7;
    const ofDay = schedules
      .filter((s) => s.is_active && s.day_of_week === nextDay)
      .sort((a, b) => minutesOf(a.start_time) - minutesOf(b.start_time));
    if (ofDay[0]) return ofDay[0];
  }
  return null;
}

export function formatSlotTime(start: string, end: string): string {
  return `${start.slice(0, 5)} ~ ${end.slice(0, 5)}`;
}

/** 영업시간을 기준으로 겹침 체크 (배열 안에서 동일 요일끼리만) */
export function hasOverlap(schedules: BusinessSchedule[]): BusinessSchedule[] {
  const overlapping: BusinessSchedule[] = [];
  const byDay = new Map<number, BusinessSchedule[]>();
  for (const s of schedules) {
    if (!s.is_active) continue;
    const arr = byDay.get(s.day_of_week) ?? [];
    arr.push(s);
    byDay.set(s.day_of_week, arr);
  }
  for (const arr of byDay.values()) {
    const sorted = [...arr].sort((a, b) => minutesOf(a.start_time) - minutesOf(b.start_time));
    for (let i = 1; i < sorted.length; i++) {
      if (minutesOf(sorted[i].start_time) < minutesOf(sorted[i - 1].end_time)) {
        overlapping.push(sorted[i]);
      }
    }
  }
  return overlapping;
}

export async function logScheduleEvent(
  userId: string | null,
  scheduleId: string | null,
  playlistId: string | null,
  eventType: 'started' | 'switched' | 'stopped',
): Promise<void> {
  try {
    await supabase.from('business_schedule_events').insert({
      user_id: userId,
      schedule_id: scheduleId,
      playlist_id: playlistId,
      event_type: eventType,
    });
  } catch {
    /* noop */
  }
}

/** KST 헬퍼 — TimeTheme 와 별도로 시:분 정밀도 */
export function nowKstHourMinute(): { h: number; m: number } {
  const _ = getKstHour();
  const utc = Date.now() + new Date().getTimezoneOffset() * 60 * 1000;
  const kst = new Date(utc + 9 * 60 * 60 * 1000);
  return { h: _, m: kst.getMinutes() };
}
