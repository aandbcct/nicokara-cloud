export const PREVIEW_LEAD_STORAGE_KEY = "nicokara.timeline.previewLeadMs";
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
