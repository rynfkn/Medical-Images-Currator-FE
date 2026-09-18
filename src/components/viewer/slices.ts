import { api } from "../../api/client";
import type { ViewerLabel } from "../../types/api";

// Index 0 is background; the rest are label IDs 1..8 as used by the brush.
export const LABEL_COLORS = [
  "#000000",
  "#ff5a5f",
  "#38d9c4",
  "#ffc94d",
  "#9b7bff",
  "#63d471",
  "#4da3ff",
  "#ff8a4d",
  "#ff6bc1",
];

export interface SliceData {
  image: ImageBitmap;
  labels: Uint8Array;
  overlay: HTMLCanvasElement;
  rows: number;
  columns: number;
}

export function labelColor(value: number): string {
  return LABEL_COLORS[value % LABEL_COLORS.length];
}

function rgb(value: number): [number, number, number] {
  const hex = labelColor(value);
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D is unavailable in this browser.");
  return ctx;
}

export function scratch(columns: number, rows: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = columns;
  canvas.height = rows;
  return canvas;
}

/** Repaint the colour overlay from label values, optionally only inside a box. */
export function colorize(
  overlay: HTMLCanvasElement,
  labels: Uint8Array,
  box?: { x: number; y: number; width: number; height: number },
): void {
  const ctx = context(overlay);
  const area = box || {
    x: 0,
    y: 0,
    width: overlay.width,
    height: overlay.height,
  };
  if (area.width <= 0 || area.height <= 0) return;
  const image = ctx.createImageData(area.width, area.height);
  for (let row = 0; row < area.height; row++) {
    for (let column = 0; column < area.width; column++) {
      const value = labels[(area.y + row) * overlay.width + area.x + column];
      const offset = (row * area.width + column) * 4;
      if (!value) {
        image.data[offset + 3] = 0;
        continue;
      }
      const [red, green, blue] = rgb(value);
      image.data[offset] = red;
      image.data[offset + 1] = green;
      image.data[offset + 2] = blue;
      image.data[offset + 3] = 255;
    }
  }
  ctx.putImageData(image, area.x, area.y);
}

async function bitmap(
  path: string,
  params: object,
  signal?: AbortSignal,
): Promise<ImageBitmap> {
  const { data } = await api.get<Blob>(path, {
    params,
    responseType: "blob",
    signal,
  });
  return createImageBitmap(data);
}

async function fetchSlice(
  caseId: string,
  axis: number,
  index: number,
  level: number,
  width: number,
  signal?: AbortSignal,
): Promise<SliceData> {
  const [image, mask] = await Promise.all([
    bitmap(
      `/viewer/cases/${caseId}/slice/${axis}/${index}`,
      { level, width },
      signal,
    ),
    bitmap(`/viewer/cases/${caseId}/mask/${axis}/${index}`, {}, signal),
  ]);
  const source = scratch(mask.width, mask.height);
  context(source).drawImage(mask, 0, 0);
  const pixels = context(source).getImageData(
    0,
    0,
    mask.width,
    mask.height,
  ).data;
  const labels = new Uint8Array(mask.width * mask.height);
  for (let i = 0; i < labels.length; i++) labels[i] = pixels[i * 4];
  mask.close();
  const overlay = scratch(source.width, source.height);
  colorize(overlay, labels);
  return { image, labels, overlay, rows: source.height, columns: source.width };
}

// Decoded slices are kept so scrolling back and forth costs nothing. The cache
// holds the painted overlay too, so local edits survive a return visit.
// Bitmaps are dropped, never closed: the slice being drawn can still be holding
// one when it falls out of the cache, and drawing a closed bitmap throws.
const CACHE_LIMIT = 64;
const cache = new Map<string, Promise<SliceData>>();

function key(
  caseId: string,
  axis: number,
  index: number,
  level: number,
  width: number,
): string {
  return `${caseId}|${axis}|${index}|${Math.round(level)}|${Math.round(width)}`;
}

/** Drop cached slices, after a save or discard replaces the stored segmentation. */
export function clearSlices(caseId?: string): void {
  for (const entry of [...cache.keys()])
    if (!caseId || entry.startsWith(`${caseId}|`)) cache.delete(entry);
}

export function cached(
  caseId: string,
  axis: number,
  index: number,
  level: number,
  width: number,
): boolean {
  return cache.has(key(caseId, axis, index, level, width));
}

export function loadSlice(
  caseId: string,
  axis: number,
  index: number,
  level: number,
  width: number,
  signal?: AbortSignal,
): Promise<SliceData> {
  const entry = key(caseId, axis, index, level, width);
  const hit = cache.get(entry);
  if (hit) {
    // Re-insert so the slice on screen is never the next one evicted.
    cache.delete(entry);
    cache.set(entry, hit);
    return hit;
  }
  // A cancelled request must not leave a rejected promise behind for the next visit.
  const request = fetchSlice(caseId, axis, index, level, width, signal).catch(
    (cause: unknown) => {
      cache.delete(entry);
      throw cause;
    },
  );
  cache.set(entry, request);
  while (cache.size > CACHE_LIMIT)
    cache.delete(cache.keys().next().value as string);
  return request;
}

/**
 * Warm the slices the user is scrolling towards. Reading ahead in the direction
 * of travel is what keeps wheel scrolling off the network entirely.
 */
export function prefetch(
  caseId: string,
  axis: number,
  index: number,
  level: number,
  width: number,
  direction: number,
  limit: number,
): void {
  const ahead = direction >= 0 ? 8 : -8;
  const behind = direction >= 0 ? -3 : 3;
  const targets = new Set<number>();
  for (const far of [ahead, behind])
    for (let step = 1; step <= Math.abs(far); step++)
      targets.add(index + Math.sign(far) * step);
  for (const target of targets) {
    if (target < 0 || target >= limit) continue;
    if (cached(caseId, axis, target, level, width)) continue;
    void loadSlice(caseId, axis, target, level, width).catch(() => undefined);
  }
}

/** Paint a filled disc of `value` into the label buffer; returns the changed box. */
export function stamp(
  slice: SliceData,
  centerX: number,
  centerY: number,
  radius: number,
  value: number,
): { x: number; y: number; width: number; height: number } | null {
  const left = Math.max(0, Math.floor(centerX - radius));
  const right = Math.min(slice.columns - 1, Math.ceil(centerX + radius));
  const top = Math.max(0, Math.floor(centerY - radius));
  const bottom = Math.min(slice.rows - 1, Math.ceil(centerY + radius));
  if (right < left || bottom < top) return null;
  let changed = false;
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const dx = x + 0.5 - centerX;
      const dy = y + 0.5 - centerY;
      if (dx * dx + dy * dy > radius * radius) continue;
      const offset = y * slice.columns + x;
      if (slice.labels[offset] === value) continue;
      slice.labels[offset] = value;
      changed = true;
    }
  }
  if (!changed) return null;
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

/** Encode a label slice as a PNG whose red channel holds the label IDs. */
export function encodeLabels(slice: SliceData): Promise<Blob> {
  const canvas = scratch(slice.columns, slice.rows);
  const ctx = context(canvas);
  const image = ctx.createImageData(slice.columns, slice.rows);
  for (let i = 0; i < slice.labels.length; i++) {
    const offset = i * 4;
    image.data[offset] = slice.labels[i];
    image.data[offset + 1] = slice.labels[i];
    image.data[offset + 2] = slice.labels[i];
    image.data[offset + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Could not encode the slice.")),
      "image/png",
    ),
  );
}

export function sendSlice(
  caseId: string,
  axis: number,
  index: number,
  payload: Blob,
): Promise<unknown> {
  return api.post(`/viewer/cases/${caseId}/paint/${axis}/${index}`, payload, {
    headers: { "Content-Type": "image/png" },
  });
}

/** Store the names for the mask's numeric labels; they are saved with the mask. */
export async function renameLabels(
  caseId: string,
  labels: ViewerLabel[],
): Promise<ViewerLabel[]> {
  const { data } = await api.post<{ labels: ViewerLabel[] }>(
    `/viewer/cases/${caseId}/labels`,
    { labels },
  );
  return data.labels;
}
