/**
 * storePlaybackPolicy — pure evaluation core for brand/franchise playback scheduling,
 * break-time handling, and curated-playlist-set rotation.
 *
 * This module is intentionally FRAMEWORK-FREE and performs NO I/O and NO audio control.
 * It is the shared "brain" that both the server resolver (`resolve_store_playback_policy`
 * RPC) and the client Player runtime call, so the exact same rules are unit-testable here
 * without a DB or a browser.
 *
 * Design grounding (from the read-only architecture audit):
 *  - Franchise stores resolve their schedule through the existing franchise music-policy
 *    system: store → franchise_policy_assignments (store > region > all) → policy → slots
 *    (`franchise_music_policy_slots`: slot_name, start_time, end_time, playlist_id,
 *    days_of_week[]), matched in Asia/Seoul, ISO day-of-week 월=1..일=7. See
 *    get_store_active_music_policy.
 *  - The slot model has NO break concept today; we add a `slotType` ('playlist' | 'break')
 *    and treat "no matching slot" as CLOSED (outside operating hours).
 *  - The Player exposes a single `playing` boolean and many auto-resume paths; a break must
 *    therefore be an explicit state that resume logic checks — encoded here by
 *    `decideBreakResume`.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Slot kind. 'playlist' plays a set/playlist; 'break' is an intentional silence window. */
export type SlotType = 'playlist' | 'break';

/** Resolved playback mode for the current instant. */
export type PlaybackMode = 'play' | 'break' | 'closed';

/** Where the effective policy came from (priority order in the resolver). */
export type PolicySource = 'store_override' | 'brand_schedule' | 'fallback';

/** ISO day-of-week: Monday=1 … Sunday=7 (matches get_store_active_music_policy). */
export type IsoDow = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface LocalInstant {
  /** ISO day-of-week, Monday=1 … Sunday=7. */
  dow: IsoDow;
  /** Minutes since local midnight, 0..1439. */
  minuteOfDay: number;
}

export interface ScheduleSlot {
  id: string;
  slotName: string;
  slotType: SlotType;
  /** minutes since midnight, 0..1440 (1440 allowed as an exclusive end == 24:00). */
  startMinute: number;
  endMinute: number;
  daysOfWeek: IsoDow[];
  sortOrder: number;
  /** For 'playlist' slots: the curated set to rotate within (nullable). */
  playlistSetId?: string | null;
  /** Back-compat single playlist target (nullable). */
  playlistId?: string | null;
}

export interface PolicyEvaluation {
  mode: PlaybackMode;
  matchedSlot: ScheduleSlot | null;
  /**
   * Minutes-of-day (in the *evaluation day frame*, may exceed 1440 to indicate "tomorrow")
   * at which the current mode next changes, or null if indeterminable (no slots at all).
   */
  nextTransitionMinuteOfWeek: number | null;
}

// ---------------------------------------------------------------------------
// Slot matching (handles midnight-crossing exactly like get_store_active_music_policy)
// ---------------------------------------------------------------------------

/** True if `minuteOfDay` falls inside [start,end) with midnight-crossing support. */
export function slotContainsTime(slot: ScheduleSlot, minuteOfDay: number): boolean {
  const { startMinute, endMinute } = slot;
  if (startMinute <= endMinute) {
    return minuteOfDay >= startMinute && minuteOfDay < endMinute;
  }
  // midnight-crossing: e.g. 22:00–02:00
  return minuteOfDay >= startMinute || minuteOfDay < endMinute;
}

/** True if the slot is active on the given ISO day-of-week. */
export function slotAppliesOnDay(slot: ScheduleSlot, dow: IsoDow): boolean {
  return slot.daysOfWeek.includes(dow);
}

/**
 * Pick the single matching slot at `now`, mirroring the DB resolver's ordering
 * (sort_order asc, then created/insertion order via the input array order as a stable
 * tiebreak). Returns null when no slot matches (⇒ CLOSED / outside operating hours).
 */
export function matchSlot(slots: ScheduleSlot[], now: LocalInstant): ScheduleSlot | null {
  const candidates = slots
    .filter((s) => slotAppliesOnDay(s, now.dow) && slotContainsTime(s, now.minuteOfDay))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return candidates[0] ?? null;
}

// ---------------------------------------------------------------------------
// Next-transition computation
// ---------------------------------------------------------------------------

/**
 * Compute the next instant (as an absolute minute-of-week, 0..10080) at which the matched
 * mode changes: the end of the current slot, or the start of the next upcoming slot when
 * currently CLOSED. Returns null only when there are no day-applicable slots at all.
 *
 * We scan forward up to 8 days (7 + wrap) so a schedule that only has slots later in the
 * week still yields a transition.
 */
export function computeNextTransition(
  slots: ScheduleSlot[],
  now: LocalInstant,
  matched: ScheduleSlot | null,
): number | null {
  const nowMow = (now.dow - 1) * 1440 + now.minuteOfDay; // minute of week, Mon 00:00 = 0

  // Gather all slot *edges* (starts and ends) across the week as minute-of-week values.
  const edges: number[] = [];
  for (const s of slots) {
    for (const d of s.daysOfWeek) {
      const dayBase = (d - 1) * 1440;
      edges.push(dayBase + s.startMinute);
      // end may be 1440 (== next day's 0) or cross midnight (< start) → normalize by +1440
      const end = s.endMinute > s.startMinute ? dayBase + s.endMinute : dayBase + s.endMinute + 1440;
      edges.push(end);
    }
  }
  if (edges.length === 0) return null;

  // Normalize every edge into the forward window (now, now + 10080] and pick the closest.
  const WEEK = 7 * 1440;
  let best: number | null = null;
  for (const raw of edges) {
    let e = ((raw % WEEK) + WEEK) % WEEK;
    if (e <= nowMow) e += WEEK; // move strictly into the future
    if (best === null || e < best) best = e;
  }
  // matched is accepted as an argument to keep the resolver contract explicit; the closest
  // future edge is the next transition whether we are currently in a slot or CLOSED.
  void matched;
  return best;
}

// ---------------------------------------------------------------------------
// Top-level policy evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate the effective playback mode for `now` given the resolved slot list.
 *  - a matching 'playlist' slot ⇒ mode 'play'
 *  - a matching 'break' slot     ⇒ mode 'break'
 *  - no matching slot            ⇒ mode 'closed' (outside operating hours)
 */
export function evaluatePolicyAt(slots: ScheduleSlot[], now: LocalInstant): PolicyEvaluation {
  const matched = matchSlot(slots, now);
  const mode: PlaybackMode = matched === null ? 'closed' : matched.slotType === 'break' ? 'break' : 'play';
  return { mode, matchedSlot: matched, nextTransitionMinuteOfWeek: computeNextTransition(slots, now, matched) };
}

// ---------------------------------------------------------------------------
// Curated-playlist-set rotation
// ---------------------------------------------------------------------------

export interface RotationSet {
  id: string;
  rotationOrder: number;
  isActive: boolean;
  /** inclusive validity bounds as epoch ms, null = unbounded. */
  validFromMs?: number | null;
  validUntilMs?: number | null;
}

/**
 * Choose the next curated set to play, honoring:
 *  - only active sets, within their validity window at `atMs`
 *  - deterministic rotation by rotationOrder
 *  - avoid selecting the same set twice in a row when an alternative exists
 * Returns null when no set is eligible (caller decides fail-safe behavior).
 */
export function selectRotationSet(
  sets: RotationSet[],
  lastUsedSetId: string | null,
  atMs: number,
): RotationSet | null {
  const eligible = sets
    .filter((s) => s.isActive)
    .filter((s) => (s.validFromMs == null || s.validFromMs <= atMs) && (s.validUntilMs == null || s.validUntilMs >= atMs))
    .sort((a, b) => a.rotationOrder - b.rotationOrder);
  if (eligible.length === 0) return null;
  if (eligible.length === 1) return eligible[0];

  // advance to the set after lastUsed in rotation order; avoid immediate repeat.
  if (lastUsedSetId != null) {
    const idx = eligible.findIndex((s) => s.id === lastUsedSetId);
    if (idx >= 0) return eligible[(idx + 1) % eligible.length];
  }
  return eligible[0];
}

/**
 * Filter candidate track ids to exclude the most recently played ones (anti-repeat).
 * `recentlyPlayed` is most-recent-first; `minGap` tracks are excluded. Preserves order.
 */
export function excludeRecentlyPlayed(
  candidateTrackIds: string[],
  recentlyPlayed: string[],
  minGap: number,
): string[] {
  const blocked = new Set(recentlyPlayed.slice(0, Math.max(0, minGap)));
  const filtered = candidateTrackIds.filter((id) => !blocked.has(id));
  // never return empty solely due to anti-repeat — fall back to the full list.
  return filtered.length > 0 ? filtered : candidateTrackIds;
}

// ---------------------------------------------------------------------------
// Break-time pause / resume decisions
// ---------------------------------------------------------------------------

export interface BreakResumeState {
  /** the player was actually playing at the instant the break began. */
  wasPlayingBeforeBreak: boolean;
  /** the user expressed a manual pause intent during the break. */
  userPausedDuringBreak: boolean;
  /** current resolved mode is 'play' (still operating hours, not break/closed). */
  isOperatingNow: boolean;
  /** a playable curated set/playlist is available right now. */
  hasPlayablePlaylist: boolean;
  /** account / store / policy state is healthy. */
  accountOk: boolean;
  /** browser autoplay currently permits programmatic play(). */
  autoplayAllowed: boolean;
  /** another audio element is currently producing sound (crossfade/announcement). */
  otherAudioPlaying: boolean;
}

export interface BreakResumeDecision {
  resume: boolean;
  reason: string;
}

/**
 * Decide whether to auto-resume music when a break ends. Auto-resume ONLY when ALL of the
 * spec's conditions hold; otherwise stay paused and let the UI prompt a manual start.
 * Never calls play() — returns a decision.
 */
export function decideBreakResume(s: BreakResumeState): BreakResumeDecision {
  if (!s.wasPlayingBeforeBreak) return { resume: false, reason: 'was_not_playing_before_break' };
  if (s.userPausedDuringBreak) return { resume: false, reason: 'user_paused_during_break' };
  if (!s.isOperatingNow) return { resume: false, reason: 'not_operating_hours' };
  if (!s.hasPlayablePlaylist) return { resume: false, reason: 'no_playable_playlist' };
  if (!s.accountOk) return { resume: false, reason: 'account_not_ok' };
  if (!s.autoplayAllowed) return { resume: false, reason: 'autoplay_blocked' };
  if (s.otherAudioPlaying) return { resume: false, reason: 'other_audio_playing' };
  return { resume: true, reason: 'ok' };
}

/**
 * Classify a pause request while (or around) a break so user-intent is preserved and never
 * confused with the automatic break pause.
 *  - during a break, a user Pause sets the "userPausedDuringBreak" latch (blocks auto-resume)
 *  - during a break, a user Play does NOT start audio; it only records resume intent
 */
export type PlayPauseIntent = 'user_play' | 'user_pause';
export interface BreakInteractionResult {
  startAudio: boolean;
  setUserPausedDuringBreak?: boolean;
  setResumeIntent?: boolean;
  notice?: string;
}

export function handleBreakInteraction(intent: PlayPauseIntent, isBreakActive: boolean): BreakInteractionResult {
  if (!isBreakActive) {
    // outside a break, normal semantics apply (caller handles real play/pause).
    return { startAudio: intent === 'user_play' };
  }
  if (intent === 'user_pause') {
    return { startAudio: false, setUserPausedDuringBreak: true };
  }
  // user_play during break: do not actually play; record intent + inform.
  return { startAudio: false, setResumeIntent: true, notice: '브레이크타임 종료 후 재생됩니다' };
}

// ---------------------------------------------------------------------------
// Timezone helper (boundary use; pure given explicit inputs)
// ---------------------------------------------------------------------------

/**
 * Convert an absolute instant (epoch ms) to LocalInstant in an IANA timezone.
 * Uses Intl (no Date.now); callers pass explicit `epochMs`, so this stays deterministic.
 */
export function toLocalInstant(epochMs: number, timeZone: string): LocalInstant {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(epochMs));
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const weekdayToIso: Record<string, IsoDow> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const dow = weekdayToIso[map.weekday] ?? 1;
  let hour = parseInt(map.hour, 10);
  if (hour === 24) hour = 0; // some environments emit 24 for midnight
  const minute = parseInt(map.minute, 10);
  return { dow, minuteOfDay: hour * 60 + minute };
}

/** Parse a 'HH:MM' or 'HH:MM:SS' time string to minutes-of-day (0..1440). */
export function timeStringToMinutes(t: string): number {
  const [h, m] = t.split(':');
  return parseInt(h, 10) * 60 + parseInt(m, 10);
}
