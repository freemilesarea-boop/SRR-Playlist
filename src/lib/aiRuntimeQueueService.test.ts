import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TrackRow } from '@/types/db';
import type { AiRuntimeModeInfo, RuntimeCandidateItem } from './aiRuntimeResolver';

// Mock the network layer — the service must orchestrate purely from these.
const mockFetchMode = vi.fn<(id: string) => Promise<AiRuntimeModeInfo>>();
const mockFetchQueue = vi.fn<(s: string, p: string, l?: number) => Promise<RuntimeCandidateItem[]>>();

vi.mock('./api/aiRuntimeApi', () => ({
  fetchStoreAiRuntimeMode: (id: string) => mockFetchMode(id),
  fetchStoreAiRuntimeQueue: (s: string, p: string, l?: number) => mockFetchQueue(s, p, l),
}));

import { resolveStoreRuntimeQueue, invalidateRuntimeModeCache } from './aiRuntimeQueueService';

function track(id: string): TrackRow {
  return {
    id, title: `T-${id}`, artist: null, genre: null, mood: null,
    audio_url: `https://cdn/${id}.mp3`, cover_url: null, duration: 180, created_at: '2026-01-01T00:00:00Z',
  };
}
function mode(over: Partial<AiRuntimeModeInfo>): AiRuntimeModeInfo {
  return {
    storeId: 's', mode: 'off', enabled: false, approved: false,
    maxAiTracks: 50, minimumFitScore: 0, source: 'settings', ...over,
  };
}
const statics = [track('a'), track('b'), track('c')];

beforeEach(() => {
  mockFetchMode.mockReset();
  mockFetchQueue.mockReset();
  invalidateRuntimeModeCache();
});

describe('resolveStoreRuntimeQueue', () => {
  it('OFF → static, no candidate fetch', async () => {
    mockFetchMode.mockResolvedValue(mode({ mode: 'off' }));
    const r = await resolveStoreRuntimeQueue({ storeId: 's1', playlistId: 'p1', staticTracks: statics });
    expect(r.source).toBe('static');
    expect(r.seedShuffle).toBe(true);
    expect(mockFetchQueue).not.toHaveBeenCalled();
  });

  it('SHADOW → static returned but candidate queue IS fetched (comparison)', async () => {
    mockFetchMode.mockResolvedValue(mode({ mode: 'shadow' }));
    mockFetchQueue.mockResolvedValue([
      { track_id: 'c', fit_score: 95, fit_status: 'active', guardrail_penalty: 0 },
    ]);
    const r = await resolveStoreRuntimeQueue({ storeId: 's2', playlistId: 'p1', staticTracks: statics });
    expect(r.source).toBe('static');
    expect(r.tracks.map((t) => t.id)).toEqual(['a', 'b', 'c']); // playback unchanged
    expect(mockFetchQueue).toHaveBeenCalledOnce();
  });

  it('PREVIEW valid → ai_preview re-ranked queue', async () => {
    mockFetchMode.mockResolvedValue(mode({ mode: 'preview' }));
    mockFetchQueue.mockResolvedValue([
      { track_id: 'c', fit_score: 95, fit_status: 'active', guardrail_penalty: 0 },
      { track_id: 'a', fit_score: 80, fit_status: 'active', guardrail_penalty: 0 },
    ]);
    const r = await resolveStoreRuntimeQueue({ storeId: 's3', playlistId: 'p1', staticTracks: statics });
    expect(r.source).toBe('ai_preview');
    expect(r.seedShuffle).toBe(false);
    expect(r.tracks.map((t) => t.id)).toEqual(['c', 'a']);
  });

  it('PREVIEW candidate RPC error → static_fallback', async () => {
    mockFetchMode.mockResolvedValue(mode({ mode: 'preview' }));
    mockFetchQueue.mockRejectedValue(new Error('ai_runtime_disabled'));
    const r = await resolveStoreRuntimeQueue({ storeId: 's4', playlistId: 'p1', staticTracks: statics });
    expect(r.source).toBe('static_fallback');
    expect(r.fallbackUsed).toBe(true);
    expect(r.tracks.map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect(r.seedShuffle).toBe(true);
  });

  it('PREVIEW empty candidates → static_fallback', async () => {
    mockFetchMode.mockResolvedValue(mode({ mode: 'preview' }));
    mockFetchQueue.mockResolvedValue([]);
    const r = await resolveStoreRuntimeQueue({ storeId: 's5', playlistId: 'p1', staticTracks: statics });
    expect(r.source).toBe('static_fallback');
    expect(r.fallbackReason).toBe('empty_candidates');
  });

  it('SHADOW candidate error → plain static (no fallback flag)', async () => {
    mockFetchMode.mockResolvedValue(mode({ mode: 'shadow' }));
    mockFetchQueue.mockRejectedValue(new Error('timeout'));
    const r = await resolveStoreRuntimeQueue({ storeId: 's6', playlistId: 'p1', staticTracks: statics });
    expect(r.source).toBe('static');
    expect(r.fallbackUsed).toBe(false);
  });

  it('mode fetch is cached per store (one call across two resolves)', async () => {
    mockFetchMode.mockResolvedValue(mode({ mode: 'off' }));
    await resolveStoreRuntimeQueue({ storeId: 's7', playlistId: 'p1', staticTracks: statics });
    await resolveStoreRuntimeQueue({ storeId: 's7', playlistId: 'p2', staticTracks: statics });
    expect(mockFetchMode).toHaveBeenCalledOnce();
  });

  it('empty static tracks → static (never calls network)', async () => {
    const r = await resolveStoreRuntimeQueue({ storeId: 's8', playlistId: 'p1', staticTracks: [] });
    expect(r.source).toBe('static');
    expect(mockFetchMode).not.toHaveBeenCalled();
  });

  it('missing storeId/playlistId → static, no throw', async () => {
    const r = await resolveStoreRuntimeQueue({ storeId: '', playlistId: '', staticTracks: statics });
    expect(r.source).toBe('static');
    expect(mockFetchMode).not.toHaveBeenCalled();
  });

  it('unexpected mode-fetch throw → static (never breaks playback)', async () => {
    mockFetchMode.mockRejectedValue(new Error('boom'));
    const r = await resolveStoreRuntimeQueue({ storeId: 's9', playlistId: 'p1', staticTracks: statics });
    expect(r.source).toBe('static');
    expect(r.tracks.map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });
});
