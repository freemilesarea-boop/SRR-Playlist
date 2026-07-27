/**
 * playlistBuilderSelection — Phase AI-PLAYLIST-ADMIN-UX-2
 *
 * Bulk 후보 선택 / Replacement 후보 조건 / Recommendation Tag 순수 로직.
 *   - Bulk 선택: 현재 로드된(페이지) 후보만 대상. 서버 미지원 전체선택을 가짜로 만들지 않는다.
 *   - Blocked / 이미 포함 트랙은 선택 대상에서 제외.
 *   - Replacement: 새 엔진 없이 대상 트랙 주변 조건을 기존 filterCandidates 로 재사용.
 *   - Tag: 색상만이 아니라 label/코드로 상태 전달(UI 가 icon/tooltip 부여).
 */
import {
  type BuilderTrack,
  type CandidateFilters,
  filterCandidates,
  isVocalTrack,
  totalDuration,
  HIGH_FIT,
  HIGH_COMPLETION,
  LOW_SKIP,
  HIGH_SKIP,
  MIN_LEARNING_SAMPLE,
  ARTIST_CONCENTRATION_WARN,
  GENRE_CONCENTRATION_WARN,
} from './playlistBuilder';
import { sortByScore } from './playlistBuilderInsights';

function isNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

// =============================================================================
// Bulk 선택
// =============================================================================

/** 선택 가능 트랙: Blocked/excluded/이미 포함 아님. */
export function isSelectable(t: BuilderTrack): boolean {
  return !t.guardrailBlocked && t.fitStatus !== 'excluded' && !t.alreadyInPlaylist;
}

/** 페이지 후보 중 선택 가능한 track_id. */
export function selectableTrackIds(tracks: BuilderTrack[]): string[] {
  return tracks.filter(isSelectable).map((t) => t.track_id);
}

/** 개별 토글. 추가는 selectable 일 때만(Blocked 선택 자동 방지), 해제는 항상 허용. */
export function toggleSelection(selected: ReadonlySet<string>, id: string, selectable = true): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) {
    next.delete(id);
  } else if (selectable) {
    next.add(id);
  }
  return next;
}

/** 현재 페이지 전체 선택(선택 가능한 것만 추가). */
export function selectAllOnPage(selected: ReadonlySet<string>, pageTracks: BuilderTrack[]): Set<string> {
  const next = new Set(selected);
  for (const id of selectableTrackIds(pageTracks)) next.add(id);
  return next;
}

/** 현재 페이지 선택 해제. */
export function deselectPage(selected: ReadonlySet<string>, pageTracks: BuilderTrack[]): Set<string> {
  const next = new Set(selected);
  for (const t of pageTracks) next.delete(t.track_id);
  return next;
}

/** 선택 반전(선택 가능한 페이지 트랙 대상). */
export function invertSelection(selected: ReadonlySet<string>, pageTracks: BuilderTrack[]): Set<string> {
  const next = new Set(selected);
  for (const id of selectableTrackIds(pageTracks)) {
    if (next.has(id)) next.delete(id);
    else next.add(id);
  }
  return next;
}

export interface SelectionSummary {
  count: number;
  totalDurationSec: number;
}

/** 선택 요약(트랙 목록 내 선택된 것만 집계). */
export function selectionSummary(tracks: BuilderTrack[], selected: ReadonlySet<string>): SelectionSummary {
  const picked = tracks.filter((t) => selected.has(t.track_id));
  return { count: picked.length, totalDurationSec: totalDuration(picked) };
}

// =============================================================================
// Replacement 후보 조건(기존 filterCandidates 재사용)
// =============================================================================

/** 대상 트랙 주변 조건으로 대체 후보 필터를 구성. 새 엔진 없음. */
export function replacementFilters(target: BuilderTrack, currentIds: string[]): CandidateFilters {
  const f: CandidateFilters = {
    excludeBlocked: true,
    excludePenalized: true, // penalized 우선 제외
    excludeAlreadyIn: true,
    excludeTrackIds: [...currentIds, target.track_id],
  };
  if (target.genre) f.includeGenres = [target.genre];
  if (isNum(target.energyLevel)) {
    f.energyMin = Math.max(1, target.energyLevel - 1);
    f.energyMax = Math.min(5, target.energyLevel + 1);
  }
  if (isNum(target.bpm)) {
    f.bpmMin = target.bpm - 15;
    f.bpmMax = target.bpm + 15;
  }
  const v = isVocalTrack(target);
  if (v === true) f.vocal = 'vocal';
  else if (v === false) f.vocal = 'instrumental';
  return f;
}

/** 대체 후보 조회(점수순). filterCandidates + sortByScore 재사용. */
export function findReplacements(
  catalog: BuilderTrack[],
  target: BuilderTrack,
  currentIds: string[],
  limit = 20,
): BuilderTrack[] {
  const filtered = filterCandidates(catalog, replacementFilters(target, currentIds));
  return sortByScore(filtered, 'adaptive').slice(0, Math.max(0, limit));
}

// =============================================================================
// Recommendation / Warning Tags
// =============================================================================
export type TagKind = 'positive' | 'warning';
export interface RecommendationTag {
  kind: TagKind;
  code: string;
  label: string;
}

/**
 * 추천 이유/경고를 구조화된 Tag 로. UI 가 kind 로 tone(success/warning) 과 icon/tooltip 을 부여.
 * playlist 를 주면 편중(동일 아티스트/장르 과다) 컨텍스트 경고도 포함.
 */
export function recommendationTags(t: BuilderTrack, playlist: BuilderTrack[] = []): RecommendationTag[] {
  const tags: RecommendationTag[] = [];
  // Positive
  if (isNum(t.fitScore) && t.fitScore >= HIGH_FIT) tags.push({ kind: 'positive', code: 'fit_high', label: '업종 적합' });
  if (isNum(t.adaptiveScore) && t.adaptiveScore >= HIGH_FIT)
    tags.push({ kind: 'positive', code: 'adaptive_high', label: '최근 반응 좋음' });
  if (isNum(t.completionRate) && t.completionRate >= HIGH_COMPLETION)
    tags.push({ kind: 'positive', code: 'completion_high', label: '완청률 높음' });
  if (isNum(t.skipRate) && t.skipRate <= LOW_SKIP) tags.push({ kind: 'positive', code: 'skip_low', label: '스킵률 낮음' });
  if (isVocalTrack(t) === false) tags.push({ kind: 'positive', code: 'instrumental', label: '연주곡' });

  // Warning — track 단위
  if (t.guardrailBlocked || t.fitStatus === 'excluded') tags.push({ kind: 'warning', code: 'blocked', label: 'Blocked' });
  if (t.guardrailPenalty > 0 || t.fitStatus === 'review_needed')
    tags.push({ kind: 'warning', code: 'penalized', label: 'Penalized' });
  if (isNum(t.sampleCount) && t.sampleCount < MIN_LEARNING_SAMPLE)
    tags.push({ kind: 'warning', code: 'low_sample', label: '데이터 부족' });
  if (isNum(t.skipRate) && t.skipRate >= HIGH_SKIP) tags.push({ kind: 'warning', code: 'skip_high', label: '스킵률 높음' });
  if (!t.audioUrl) tags.push({ kind: 'warning', code: 'no_audio', label: 'Audio 누락' });
  if (!t.coverUrl) tags.push({ kind: 'warning', code: 'no_artwork', label: 'Artwork 누락' });

  // Warning — playlist 컨텍스트(편중)
  if (playlist.length > 0) {
    if (t.artist) {
      const sameArtist = playlist.filter((p) => p.artist === t.artist).length;
      if (sameArtist / playlist.length > ARTIST_CONCENTRATION_WARN)
        tags.push({ kind: 'warning', code: 'artist_over', label: '동일 아티스트 과다' });
    }
    if (t.genre) {
      const sameGenre = playlist.filter((p) => p.genre === t.genre).length;
      if (sameGenre / playlist.length > GENRE_CONCENTRATION_WARN)
        tags.push({ kind: 'warning', code: 'genre_over', label: '동일 장르 과다' });
    }
  }
  return tags;
}
