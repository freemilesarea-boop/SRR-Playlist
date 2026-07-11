// AI-MUSIC-2 — Time Intelligence. STATIC day-part rules mapping an hour (0-23) to a listening slot
// (Coffee/Morning → Lunch → Afternoon → Dinner → Closing) with an energy + mood hint. RULE-based only —
// NO LLM. Used to shape a *proposed* playlist; it never changes the real Player/schedule.

import type { TimeSlot } from './types';

// Slots cover the full 24h. CLOSING wraps late-night/early-morning (21-24 and 0-6).
export const TIME_SLOTS: TimeSlot[] = [
  { key: 'MORNING', label: 'Coffee / Morning', startHour: 6, endHour: 11, energyHint: 'LOW', moodHint: ['calm', 'acoustic', 'bright'] },
  { key: 'LUNCH', label: 'Lunch', startHour: 11, endHour: 14, energyHint: 'MEDIUM', moodHint: ['bright', 'pop', 'bossa'] },
  { key: 'AFTERNOON', label: 'Afternoon', startHour: 14, endHour: 17, energyHint: 'MEDIUM', moodHint: ['chill', 'lofi', 'pop'] },
  { key: 'DINNER', label: 'Dinner', startHour: 17, endHour: 21, energyHint: 'HIGH', moodHint: ['warm', 'soul', 'upbeat'] },
  { key: 'CLOSING', label: 'Closing', startHour: 21, endHour: 24, energyHint: 'LOW', moodHint: ['calm', 'lounge', 'ambient'] },
];

const CLOSING = TIME_SLOTS[TIME_SLOTS.length - 1];

/** Resolve an hour (0-23) to its day-part slot. null hour → null (whole-day plan). */
export function resolveTimeSlot(hour: number | null): TimeSlot | null {
  if (hour == null || !Number.isFinite(hour)) return null;
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  const hit = TIME_SLOTS.find((s) => h >= s.startHour && h < s.endHour);
  return hit ?? CLOSING;   // 0-6 wraps to Closing (late-night)
}

export function allTimeSlots(): TimeSlot[] { return TIME_SLOTS; }
