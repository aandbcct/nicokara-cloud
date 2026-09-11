import {
  DEFAULT_PLAYBACK_SHORTCUT_BINDINGS,
  PlaybackShortcut,
  type PlaybackShortcutBindings,
} from "./timeline-editing";

export const PREVIEW_LEAD_STORAGE_KEY = "nicokara.timeline.previewLeadMs";
export const PLAYBACK_SHORTCUTS_STORAGE_KEY = "nicokara.timeline.playbackShortcuts";
export const DEFAULT_PREVIEW_LEAD_MS = 100;
export const MAX_PREVIEW_LEAD_MS = 2000;

export function normalizePreviewLeadMs(value: string | number | null): number {
  if (value === null || value === "") return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_PREVIEW_LEAD_MS;
  return Math.min(MAX_PREVIEW_LEAD_MS, Math.max(0, Math.trunc(parsed)));
}

export function loadPreviewLeadMs(storage: Pick<Storage, "getItem">): number {
  try {
    const stored = storage.getItem(PREVIEW_LEAD_STORAGE_KEY);
    const parsed = stored === null || stored.trim() === "" ? Number.NaN : Number(stored);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_PREVIEW_LEAD_MS) {
      return DEFAULT_PREVIEW_LEAD_MS;
    }
    return parsed;
  } catch {
    return DEFAULT_PREVIEW_LEAD_MS;
  }
}

export function savePreviewLeadMs(
  storage: Pick<Storage, "setItem">,
  value: string | number | null,
): number {
  const normalized = normalizePreviewLeadMs(value);
  try {
    storage.setItem(PREVIEW_LEAD_STORAGE_KEY, String(normalized));
  } catch {
    return normalized;
  }
  return normalized;
}

const CONFIGURABLE_SHORTCUTS = [
  PlaybackShortcut.PreviousLine,
  PlaybackShortcut.NextLine,
  PlaybackShortcut.ReplayLine,
  PlaybackShortcut.ToggleLineLoop,
  PlaybackShortcut.RateToggle,
  PlaybackShortcut.RateDown,
  PlaybackShortcut.RateUp,
] as const;

export function normalizePlaybackShortcutKey(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9]$/.test(normalized) ? normalized : null;
}

function parsedShortcutBindings(value: unknown): PlaybackShortcutBindings | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const bindings = { ...DEFAULT_PLAYBACK_SHORTCUT_BINDINGS };
  const usedKeys = new Set<string>();
  for (const shortcut of CONFIGURABLE_SHORTCUTS) {
    const stored = record[shortcut];
    if (typeof stored !== "string") return null;
    const key = normalizePlaybackShortcutKey(stored);
    if (key === null || usedKeys.has(key)) return null;
    bindings[shortcut] = key;
    usedKeys.add(key);
  }
  return bindings;
}

export function loadPlaybackShortcutBindings(storage: Pick<Storage, "getItem">): PlaybackShortcutBindings {
  try {
    const stored = storage.getItem(PLAYBACK_SHORTCUTS_STORAGE_KEY);
    if (stored === null) return { ...DEFAULT_PLAYBACK_SHORTCUT_BINDINGS };
    return parsedShortcutBindings(JSON.parse(stored)) ?? { ...DEFAULT_PLAYBACK_SHORTCUT_BINDINGS };
  } catch {
    return { ...DEFAULT_PLAYBACK_SHORTCUT_BINDINGS };
  }
}

export function savePlaybackShortcutBindings(
  storage: Pick<Storage, "setItem">,
  bindings: PlaybackShortcutBindings,
): PlaybackShortcutBindings {
  const normalized = parsedShortcutBindings(bindings) ?? { ...DEFAULT_PLAYBACK_SHORTCUT_BINDINGS };
  try {
    storage.setItem(PLAYBACK_SHORTCUTS_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    return normalized;
  }
  return normalized;
}
