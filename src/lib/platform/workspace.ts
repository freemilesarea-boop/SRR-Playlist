// WEB-OPS-10 — Workspace & Widget system (pure helpers). A per-operator dashboard layout: which widgets,
// their size, position, collapsed/favorite state. All logic is pure and side-effect-free — persistence is
// handled by the 0463 RPCs. Nothing here touches playback or operational data.

import { WORKSPACE_MAX_WIDGETS } from './thresholds';
import type { WidgetType, WidgetSize, WidgetConfig, WorkspaceLayout } from './types';

export const WIDGET_CATALOG: Array<{ type: WidgetType; label: string }> = [
  { type: 'platformScore', label: 'Platform Score' },
  { type: 'executive', label: 'Executive Summary' },
  { type: 'streaming', label: 'Streaming' },
  { type: 'reliability', label: 'Reliability' },
  { type: 'sla', label: 'SLA' },
  { type: 'incidents', label: 'Incidents' },
  { type: 'fleet', label: 'Fleet' },
  { type: 'enterprise', label: 'Enterprise' },
  { type: 'recommendations', label: 'Recommendations' },
  { type: 'release', label: 'Release Readiness' },
  { type: 'timeline', label: 'Command Timeline' },
];

const VALID_TYPES = new Set<WidgetType>(WIDGET_CATALOG.map((w) => w.type));
const VALID_SIZES = new Set<WidgetSize>(['S', 'M', 'L']);

/** The default layout shown to an operator who has never saved one. */
export function defaultLayout(): WorkspaceLayout {
  const widgets: WidgetConfig[] = [
    { id: 'w-platformScore', type: 'platformScore', size: 'L', collapsed: false, favorite: true },
    { id: 'w-executive', type: 'executive', size: 'M', collapsed: false, favorite: false },
    { id: 'w-streaming', type: 'streaming', size: 'M', collapsed: false, favorite: false },
    { id: 'w-incidents', type: 'incidents', size: 'M', collapsed: false, favorite: false },
    { id: 'w-fleet', type: 'fleet', size: 'M', collapsed: false, favorite: false },
    { id: 'w-recommendations', type: 'recommendations', size: 'M', collapsed: false, favorite: false },
  ];
  return { name: 'Default', widgets, isDefault: true };
}

/** Coerce an untrusted saved layout into a valid one (drop unknown widgets, clamp count). */
export function normalizeLayout(raw: unknown): WorkspaceLayout {
  const def = defaultLayout();
  if (!raw || typeof raw !== 'object') return def;
  const obj = raw as { name?: unknown; widgets?: unknown; isDefault?: unknown };
  const widgetsRaw = Array.isArray(obj.widgets) ? obj.widgets : [];
  const seen = new Set<string>();
  const widgets: WidgetConfig[] = [];
  for (const w of widgetsRaw) {
    if (widgets.length >= WORKSPACE_MAX_WIDGETS) break;
    if (!w || typeof w !== 'object') continue;
    const c = w as Partial<WidgetConfig>;
    if (!c.type || !VALID_TYPES.has(c.type)) continue;
    const id = typeof c.id === 'string' && c.id ? c.id : `w-${c.type}`;
    if (seen.has(id)) continue;
    seen.add(id);
    widgets.push({
      id, type: c.type,
      size: c.size && VALID_SIZES.has(c.size) ? c.size : 'M',
      collapsed: c.collapsed === true,
      favorite: c.favorite === true,
    });
  }
  return {
    name: typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim().slice(0, 60) : 'Default',
    widgets: widgets.length ? widgets : def.widgets,
    isDefault: obj.isDefault === true,
  };
}

/** Move a widget up/down (pure — returns a new layout). */
export function moveWidget(layout: WorkspaceLayout, id: string, dir: -1 | 1): WorkspaceLayout {
  const widgets = [...layout.widgets];
  const i = widgets.findIndex((w) => w.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= widgets.length) return layout;
  [widgets[i], widgets[j]] = [widgets[j], widgets[i]];
  return { ...layout, widgets };
}

/** Reorder by moving `id` to just before `beforeId` (native drag-and-drop drop handler). */
export function reorderWidget(layout: WorkspaceLayout, id: string, beforeId: string): WorkspaceLayout {
  if (id === beforeId) return layout;
  const widgets = [...layout.widgets];
  const from = widgets.findIndex((w) => w.id === id);
  if (from < 0) return layout;
  const [moved] = widgets.splice(from, 1);
  const to = widgets.findIndex((w) => w.id === beforeId);
  if (to < 0) widgets.push(moved); else widgets.splice(to, 0, moved);
  return { ...layout, widgets };
}

export function updateWidget(layout: WorkspaceLayout, id: string, patch: Partial<Pick<WidgetConfig, 'size' | 'collapsed' | 'favorite'>>): WorkspaceLayout {
  return { ...layout, widgets: layout.widgets.map((w) => (w.id === id ? { ...w, ...patch } : w)) };
}

export function addWidget(layout: WorkspaceLayout, type: WidgetType): WorkspaceLayout {
  if (!VALID_TYPES.has(type) || layout.widgets.length >= WORKSPACE_MAX_WIDGETS) return layout;
  const id = `w-${type}-${layout.widgets.length}`;
  return { ...layout, widgets: [...layout.widgets, { id, type, size: 'M', collapsed: false, favorite: false }] };
}

export function removeWidget(layout: WorkspaceLayout, id: string): WorkspaceLayout {
  return { ...layout, widgets: layout.widgets.filter((w) => w.id !== id) };
}
