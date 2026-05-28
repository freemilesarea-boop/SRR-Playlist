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
  /** @deprecated 호환용 — 새 코드는 days_of_week 사용. days_of_week[0] 과 동일하게 유지됨. */
  day_of_week: number | null; // 0=Sunday, 6=Saturday
  /** 한 스케줄이 적용되는 모든 요일. 한 번 만들면 여기 들어간 모든 요일에 동일 시간/플리가 자동 적용. */
  days_of_week: number[];
  slot_name: string;
  start_time: string; // 'HH:MM:SS' or 'HH:MM'
  end_time: string;
  playlist_id: string | null;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

/** 호환 헬퍼 — 옛 day_of_week 만 채워져 있어도 days_of_week 로 정규화. */
export function effectiveDays(s: BusinessSchedule): number[] {
  if (s.days_of_week && s.days_of_week.length > 0) return s.days_of_week;
  return s.day_of_week == null ? [] : [s.day_of_week];
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
    .order('start_time', { ascending: true });
  if (error) throw error;
  return (data ?? []) as BusinessSchedule[];
}

export async function createSchedule(payload: {
  user_id: string;
  days_of_week: number[];
  slot_name: string;
  start_time: string;
  end_time: string;
  playlist_id?: string | null;
  is_active?: boolean;
}): Promise<BusinessSchedule | null> {
  const days = [...new Set(payload.days_of_week)].sort((a, b) => a - b);
  if (days.length === 0) throw new Error('적용 요일을 1개 이상 선택해주세요.');
  // day_of_week 호환 컬럼은 days[0] 로 자동 채움 (옛 코드/RPC 가 참조해도 안전)
  const { data, error } = await supabase
    .from('business_music_schedules')
    .insert({
      user_id: payload.user_id,
      days_of_week: days,
      day_of_week: days[0],
      slot_name: payload.slot_name,
      start_time: payload.start_time,
      end_time: payload.end_time,
      playlist_id: payload.playlist_id ?? null,
      is_active: payload.is_active ?? true,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as BusinessSchedule;
}

export async function updateSchedule(
  id: string,
  patch: Partial<Omit<BusinessSchedule, 'id' | 'user_id'>>,
): Promise<void> {
  // days_of_week 변경 시 day_of_week 호환 컬럼도 동기화
  const normalized: Record<string, unknown> = { ...patch };
  if (patch.days_of_week) {
    const days = [...new Set(patch.days_of_week)].sort((a, b) => a - b);
    if (days.length === 0) throw new Error('적용 요일을 1개 이상 선택해주세요.');
    normalized.days_of_week = days;
    normalized.day_of_week = days[0];
  }
  const { error } = await supabase
    .from('business_music_schedules')
    .update(normalized)
    .eq('id', id);
  if (error) throw error;
}

/** 동일한 (이름·시간·플리·활성) 슬롯들을 days_of_week 합집합으로 자동 병합 — 1회성 정리 도구. */
export async function consolidateSchedules(): Promise<{ merged: number; kept: number }> {
  const { data, error } = await supabase.rpc('consolidate_business_schedules');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return { merged: row?.merged_count ?? 0, kept: row?.kept_count ?? 0 };
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

  // 한 템플릿 = 한 행 (선택된 요일 모두에 적용) — 단일 행 모델
  const days = [...new Set(daysOfWeek)].sort((a, b) => a - b);
  const rows = templates.map((tmpl) => ({
    user_id: userId,
    days_of_week: days,
    day_of_week: days[0], // 호환 컬럼
    slot_name: tmpl.slot_name,
    start_time: tmpl.start_time,
    end_time: tmpl.end_time,
    playlist_id: findPlaylist(tmpl.match_keywords),
    is_active: true,
  }));

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
        effectiveDays(s).includes(day) &&
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
    .filter((s) => s.is_active && effectiveDays(s).includes(day) && minutesOf(s.start_time) > minutes)
    .sort((a, b) => minutesOf(a.start_time) - minutesOf(b.start_time));
  if (today[0]) return today[0];
  // 다음 날부터
  for (let i = 1; i <= 7; i++) {
    const nextDay = (day + i) % 7;
    const ofDay = schedules
      .filter((s) => s.is_active && effectiveDays(s).includes(nextDay))
      .sort((a, b) => minutesOf(a.start_time) - minutesOf(b.start_time));
    if (ofDay[0]) return ofDay[0];
  }
  return null;
}

export function formatSlotTime(start: string, end: string): string {
  return `${start.slice(0, 5)} ~ ${end.slice(0, 5)}`;
}

/** 영업시간을 기준으로 겹침 체크. 두 스케줄이 공통 요일을 적어도 하나 공유하고 시간이 겹치면 양쪽 모두 표시. */
export function hasOverlap(schedules: BusinessSchedule[]): BusinessSchedule[] {
  const overlappingIds = new Set<string>();
  const active = schedules.filter((s) => s.is_active);
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      const ad = effectiveDays(a);
      const bd = effectiveDays(b);
      const shareDay = ad.some((d) => bd.includes(d));
      if (!shareDay) continue;
      const aStart = minutesOf(a.start_time);
      const aEnd = minutesOf(a.end_time);
      const bStart = minutesOf(b.start_time);
      const bEnd = minutesOf(b.end_time);
      if (aStart < bEnd && bStart < aEnd) {
        overlappingIds.add(a.id);
        overlappingIds.add(b.id);
      }
    }
  }
  return active.filter((s) => overlappingIds.has(s.id));
}

export async function logScheduleEvent(
  userId: string | null,
  scheduleId: string | null,
  playlistId: string | null,
  eventType: 'started' | 'switched' | 'stopped',
): Promise<void> {
  try {
    const { error } = await supabase.from('business_schedule_events').insert({
      user_id: userId,
      schedule_id: scheduleId,
      playlist_id: playlistId,
      event_type: eventType,
    });
    if (error && import.meta.env.DEV) {
      console.debug('[business] logScheduleEvent 실패 (마이그레이션 미적용 가능):', error.message);
    }
  } catch (e) {
    if (import.meta.env.DEV) {
      console.debug('[business] logScheduleEvent 네트워크 실패:', e);
    }
  }
}

/** KST 헬퍼 — TimeTheme 와 별도로 시:분 정밀도 */
export function nowKstHourMinute(): { h: number; m: number } {
  const _ = getKstHour();
  const utc = Date.now() + new Date().getTimezoneOffset() * 60 * 1000;
  const kst = new Date(utc + 9 * 60 * 60 * 1000);
  return { h: _, m: kst.getMinutes() };
}
