/**
 * multiOutput — 분리 송출 설정(플레이어 1~3 의 역할 + 안내방송 송출 플레이어).
 * Migration: supabase/migrations/0536_multi_output.sql
 *
 * 저장은 계정 단위(DB), 출력 장치는 PC 단위(각 창의 저장소 — audioOutputStore)다.
 */
import { supabase } from '@/lib/supabase';
import { OUTPUT_SLOTS, type OutputSlot } from '@/lib/outputSlot';

export type SlotMode = 'brand' | 'store' | 'off';
/** 매장 플레이어 음악 출처 — 내 자동 스케줄 | 업종 카테고리(점주가 직접 고름). */
export type StoreSource = 'schedule' | 'category';

export interface SlotConfig {
  slot: OutputSlot;
  mode: SlotMode;
  source?: StoreSource;
  category?: string;
}

export interface MultiOutputConfig {
  slots: SlotConfig[];
  announcement_slot: OutputSlot;
}

export const SLOT_MODE_LABEL: Record<SlotMode, string> = {
  brand: '브랜드 플레이어',
  store: '매장 플레이어',
  off: '사용 안 함',
};

/** 처음 켤 때 — 1번 브랜드, 2번 매장(내 스케줄), 3번 사용 안 함. 안내방송은 1번. */
export const DEFAULT_MULTI_OUTPUT_CONFIG: MultiOutputConfig = {
  slots: [
    { slot: 1, mode: 'brand' },
    { slot: 2, mode: 'store', source: 'schedule' },
    { slot: 3, mode: 'off' },
  ],
  announcement_slot: 1,
};

/** DB 값(형식이 어긋났을 수 있음)을 화면에서 쓸 수 있는 모양으로 맞춘다. */
export function normalizeMultiOutputConfig(raw: unknown): MultiOutputConfig {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as { slots?: unknown; announcement_slot?: unknown };
  const list = Array.isArray(obj.slots) ? obj.slots : [];
  const slots: SlotConfig[] = OUTPUT_SLOTS.map((slot) => {
    const found = list.find((s) => s && typeof s === 'object' && Number((s as { slot?: unknown }).slot) === slot) as
      | Partial<SlotConfig> | undefined;
    const fallback = DEFAULT_MULTI_OUTPUT_CONFIG.slots[slot - 1];
    if (!found) return { ...fallback };
    const mode: SlotMode = found.mode === 'brand' || found.mode === 'store' || found.mode === 'off' ? found.mode : 'off';
    if (mode !== 'store') return { slot, mode };
    const source: StoreSource = found.source === 'category' && found.category ? 'category' : 'schedule';
    return source === 'category' ? { slot, mode, source, category: String(found.category) } : { slot, mode, source };
  });
  const active = slots.filter((s) => s.mode !== 'off').map((s) => s.slot);
  const ann = Number(obj.announcement_slot);
  const announcement_slot = (active.includes(ann as OutputSlot) ? ann : active[0] ?? 1) as OutputSlot;
  return { slots, announcement_slot };
}

/** 저장 전 검증 — 사람이 읽을 메시지. 문제 없으면 null. */
export function validateMultiOutputConfig(c: MultiOutputConfig): string | null {
  const active = c.slots.filter((s) => s.mode !== 'off');
  if (active.length === 0) return '최소 1개 플레이어는 사용해야 해요.';
  const missing = c.slots.find((s) => s.mode === 'store' && s.source === 'category' && !s.category);
  if (missing) return `${missing.slot}번 플레이어의 카테고리를 골라주세요.`;
  if (!active.some((s) => s.slot === c.announcement_slot)) return '안내방송을 송출할 플레이어를 골라주세요.';
  return null;
}

export function slotConfigOf(c: MultiOutputConfig | null | undefined, slot: OutputSlot | null): SlotConfig | null {
  if (!c || !slot) return null;
  return c.slots.find((s) => s.slot === slot) ?? null;
}

/**
 * 이 창에서 안내·긴급방송을 틀어도 되는가.
 * 분리 송출이 꺼져 있으면 지금처럼 어디서든. 켜져 있으면 고른 플레이어 창에서만 —
 * 창마다 같은 안내가 겹쳐 나가거나, 설정 화면 같은 창에서 엉뚱하게 나가지 않게 한다.
 */
export function shouldPlayAnnouncementsHere(opts: {
  enabled: boolean;
  config: MultiOutputConfig | null;
  slot: OutputSlot | null;
}): boolean {
  if (!opts.enabled || !opts.config) return true;
  return opts.slot !== null && opts.slot === opts.config.announcement_slot;
}

export async function saveMultiOutput(enabled: boolean, config: MultiOutputConfig | null): Promise<void> {
  const { error } = await supabase.rpc('set_my_multi_output', {
    p_enabled: enabled,
    p_config: config,
  });
  if (error) throw error;
}

/** 매장 플레이어가 고를 수 있는 업종 카테고리 — 사업자 전용 플레이리스트가 있는 것만. */
export async function fetchStoreCategories(): Promise<string[]> {
  const { data, error } = await supabase
    .from('playlists')
    .select('business_category, category')
    .eq('is_business_only', true);
  if (error) throw error;
  const set = new Set<string>();
  for (const r of (data ?? []) as { business_category: string | null; category: string | null }[]) {
    const c = (r.business_category ?? r.category ?? '').trim();
    if (c) set.add(c);
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'ko'));
}
