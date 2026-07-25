import { describe, it, expect } from 'vitest';
import {
  type ScheduleSlot,
  type IsoDow,
  slotContainsTime,
  matchSlot,
  evaluatePolicyAt,
  computeNextTransition,
  selectRotationSet,
  excludeRecentlyPlayed,
  decideBreakResume,
  handleBreakInteraction,
  toLocalInstant,
  timeStringToMinutes,
  type BreakResumeState,
  type RotationSet,
} from '@/lib/storePlaybackPolicy';

const M = timeStringToMinutes;
function slot(p: Partial<ScheduleSlot> & Pick<ScheduleSlot, 'id' | 'startMinute' | 'endMinute' | 'daysOfWeek'>): ScheduleSlot {
  return {
    slotName: p.slotName ?? p.id,
    slotType: p.slotType ?? 'playlist',
    sortOrder: p.sortOrder ?? 0,
    playlistSetId: p.playlistSetId ?? null,
    playlistId: p.playlistId ?? null,
    ...p,
  };
}
const WEEKDAYS: IsoDow[] = [1, 2, 3, 4, 5];

describe('slot matching', () => {
  const s = slot({ id: 'day', startMinute: M('09:00'), endMinute: M('18:00'), daysOfWeek: WEEKDAYS });
  it('inclusive start, exclusive end', () => {
    expect(slotContainsTime(s, M('09:00'))).toBe(true);
    expect(slotContainsTime(s, M('17:59'))).toBe(true);
    expect(slotContainsTime(s, M('18:00'))).toBe(false);
    expect(slotContainsTime(s, M('08:59'))).toBe(false);
  });
  it('midnight-crossing 22:00–02:00', () => {
    const night = slot({ id: 'n', startMinute: M('22:00'), endMinute: M('02:00'), daysOfWeek: WEEKDAYS });
    expect(slotContainsTime(night, M('23:30'))).toBe(true);
    expect(slotContainsTime(night, M('01:30'))).toBe(true);
    expect(slotContainsTime(night, M('03:00'))).toBe(false);
  });
});

describe('evaluatePolicyAt — mode resolution', () => {
  const slots = [
    slot({ id: 'morning', slotName: 'Morning', startMinute: M('09:00'), endMinute: M('11:00'), daysOfWeek: WEEKDAYS, playlistSetId: 'setA', sortOrder: 1 }),
    slot({ id: 'day', slotName: 'Day', startMinute: M('11:00'), endMinute: M('14:30'), daysOfWeek: WEEKDAYS, playlistSetId: 'setB', sortOrder: 2 }),
    slot({ id: 'break', slotName: 'Break', slotType: 'break', startMinute: M('14:30'), endMinute: M('15:00'), daysOfWeek: WEEKDAYS, sortOrder: 3 }),
    slot({ id: 'day2', slotName: 'Day', startMinute: M('15:00'), endMinute: M('18:00'), daysOfWeek: WEEKDAYS, playlistSetId: 'setB', sortOrder: 4 }),
  ];
  it('#4 returns the playlist set for the current time (play)', () => {
    const r = evaluatePolicyAt(slots, { dow: 1, minuteOfDay: M('10:00') });
    expect(r.mode).toBe('play');
    expect(r.matchedSlot?.playlistSetId).toBe('setA');
  });
  it('#5 break window ⇒ mode break', () => {
    const r = evaluatePolicyAt(slots, { dow: 1, minuteOfDay: M('14:45') });
    expect(r.mode).toBe('break');
    expect(r.matchedSlot?.slotName).toBe('Break');
  });
  it('#6 outside all slots ⇒ mode closed', () => {
    expect(evaluatePolicyAt(slots, { dow: 1, minuteOfDay: M('07:00') }).mode).toBe('closed');
    expect(evaluatePolicyAt(slots, { dow: 1, minuteOfDay: M('20:00') }).mode).toBe('closed');
  });
  it('#10 day-of-week isolation (weekend closed for weekday-only schedule)', () => {
    expect(evaluatePolicyAt(slots, { dow: 6, minuteOfDay: M('10:00') }).mode).toBe('closed');
  });
  it('sort_order tie-break picks lowest', () => {
    const overlap = [
      slot({ id: 'b', startMinute: M('09:00'), endMinute: M('12:00'), daysOfWeek: WEEKDAYS, sortOrder: 5, slotType: 'break' }),
      slot({ id: 'a', startMinute: M('09:00'), endMinute: M('12:00'), daysOfWeek: WEEKDAYS, sortOrder: 1, playlistSetId: 'setA' }),
    ];
    expect(matchSlot(overlap, { dow: 1, minuteOfDay: M('10:00') })?.id).toBe('a');
  });
});

describe('computeNextTransition — #7 next transition time', () => {
  const slots = [
    slot({ id: 'day', startMinute: M('11:00'), endMinute: M('14:30'), daysOfWeek: WEEKDAYS }),
    slot({ id: 'break', slotType: 'break', startMinute: M('14:30'), endMinute: M('15:00'), daysOfWeek: WEEKDAYS }),
  ];
  it('during a slot ⇒ next transition is its end', () => {
    // Monday 12:00 → next edge is 14:30 Monday.
    const nt = computeNextTransition(slots, { dow: 1, minuteOfDay: M('12:00') }, matchSlot(slots, { dow: 1, minuteOfDay: M('12:00') }));
    expect(nt).toBe((1 - 1) * 1440 + M('14:30'));
  });
  it('when closed ⇒ next transition is the next slot start', () => {
    // Monday 09:00 (closed) → next edge is 11:00 Monday start.
    const nt = computeNextTransition(slots, { dow: 1, minuteOfDay: M('09:00') }, null);
    expect(nt).toBe(M('11:00'));
  });
  it('no slots ⇒ null', () => {
    expect(computeNextTransition([], { dow: 1, minuteOfDay: 0 }, null)).toBeNull();
  });
});

describe('rotation — #11-14', () => {
  const sets: RotationSet[] = [
    { id: 'A', rotationOrder: 1, isActive: true },
    { id: 'B', rotationOrder: 2, isActive: true },
    { id: 'C', rotationOrder: 3, isActive: true },
  ];
  it('#11 A→B→C→A cycle avoiding immediate repeat', () => {
    expect(selectRotationSet(sets, null, 0)?.id).toBe('A');
    expect(selectRotationSet(sets, 'A', 0)?.id).toBe('B');
    expect(selectRotationSet(sets, 'B', 0)?.id).toBe('C');
    expect(selectRotationSet(sets, 'C', 0)?.id).toBe('A');
  });
  it('#12 inactive sets excluded', () => {
    const s = [{ ...sets[0], isActive: false }, sets[1], sets[2]];
    expect(selectRotationSet(s, null, 0)?.id).toBe('B');
  });
  it('#13 out-of-validity sets excluded', () => {
    const s: RotationSet[] = [
      { id: 'A', rotationOrder: 1, isActive: true, validUntilMs: 500 },
      { id: 'B', rotationOrder: 2, isActive: true, validFromMs: 100 },
    ];
    expect(selectRotationSet(s, null, 1000)?.id).toBe('B'); // A expired
    expect(selectRotationSet(s, null, 50)?.id).toBe('A');   // B not yet valid
  });
  it('#14 single eligible set ⇒ no crash, returns it even if lastUsed', () => {
    expect(selectRotationSet([sets[0]], 'A', 0)?.id).toBe('A');
  });
  it('no eligible ⇒ null', () => {
    expect(selectRotationSet([{ ...sets[0], isActive: false }], null, 0)).toBeNull();
  });
});

describe('anti-repeat — #15 recently played exclusion', () => {
  it('excludes the last N played, preserving order', () => {
    const out = excludeRecentlyPlayed(['t1', 't2', 't3', 't4'], ['t4', 't3'], 2);
    expect(out).toEqual(['t1', 't2']);
  });
  it('never returns empty solely due to anti-repeat', () => {
    const out = excludeRecentlyPlayed(['t1', 't2'], ['t1', 't2'], 5);
    expect(out).toEqual(['t1', 't2']);
  });
});

describe('break resume decision — #20-22', () => {
  const base: BreakResumeState = {
    wasPlayingBeforeBreak: true,
    userPausedDuringBreak: false,
    isOperatingNow: true,
    hasPlayablePlaylist: true,
    accountOk: true,
    autoplayAllowed: true,
    otherAudioPlaying: false,
  };
  it('#20 was playing + still operating + no user pause ⇒ resume', () => {
    expect(decideBreakResume(base)).toEqual({ resume: true, reason: 'ok' });
  });
  it('#21 user paused during break ⇒ no resume', () => {
    expect(decideBreakResume({ ...base, userPausedDuringBreak: true }).resume).toBe(false);
  });
  it('was not playing before break ⇒ no resume', () => {
    expect(decideBreakResume({ ...base, wasPlayingBeforeBreak: false }).resume).toBe(false);
  });
  it('now closed (past operating hours) ⇒ no resume', () => {
    expect(decideBreakResume({ ...base, isOperatingNow: false }).reason).toBe('not_operating_hours');
  });
  it('autoplay blocked ⇒ no resume', () => {
    expect(decideBreakResume({ ...base, autoplayAllowed: false }).reason).toBe('autoplay_blocked');
  });
  it('another audio element playing ⇒ no resume (double-play guard)', () => {
    expect(decideBreakResume({ ...base, otherAudioPlaying: true }).reason).toBe('other_audio_playing');
  });
  it('no playable playlist ⇒ no resume', () => {
    expect(decideBreakResume({ ...base, hasPlayablePlaylist: false }).reason).toBe('no_playable_playlist');
  });
});

describe('break interaction — #22 user actions during break', () => {
  it('user Play during break does NOT start audio; records intent + notice', () => {
    const r = handleBreakInteraction('user_play', true);
    expect(r.startAudio).toBe(false);
    expect(r.setResumeIntent).toBe(true);
    expect(r.notice).toContain('브레이크타임');
  });
  it('user Pause during break latches userPausedDuringBreak', () => {
    const r = handleBreakInteraction('user_pause', true);
    expect(r.startAudio).toBe(false);
    expect(r.setUserPausedDuringBreak).toBe(true);
  });
  it('outside break, user Play uses normal semantics', () => {
    expect(handleBreakInteraction('user_play', false).startAudio).toBe(true);
  });
});

describe('timezone — #10 Asia/Seoul evaluation', () => {
  it('converts a known UTC instant to KST local parts', () => {
    // 2026-07-06T01:30:00Z == 2026-07-06 10:30 KST, which is a Monday.
    const li = toLocalInstant(Date.parse('2026-07-06T01:30:00Z'), 'Asia/Seoul');
    expect(li.dow).toBe(1); // Monday
    expect(li.minuteOfDay).toBe(M('10:30'));
  });
  it('KST day boundary: 2026-07-05T15:30:00Z == Mon 00:30 KST', () => {
    const li = toLocalInstant(Date.parse('2026-07-05T15:30:00Z'), 'Asia/Seoul');
    expect(li.dow).toBe(1);
    expect(li.minuteOfDay).toBe(M('00:30'));
  });
});
