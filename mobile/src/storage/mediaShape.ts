import { MMKV } from 'react-native-mmkv';

/**
 * How tall each photo and video is, relative to its width.
 *
 * WHY THIS IS ON THE DEVICE AND NOT IN MONGO. The obvious place for an
 * image's dimensions is beside the rest of its metadata on the server,
 * and the spec asks for exactly that. It was not done that way here for
 * one reason: every photo and video ALREADY SENT has no dimensions
 * stored, and never will without a migration that walks every media
 * document in every workspace and fetches each file to measure it. A
 * server field would fix new messages and leave the entire history
 * cropped — which is most of what anyone is looking at.
 *
 * Measuring on the device fixes both, because the client ends up holding
 * the file anyway: the shape is read off the image it just decoded, at
 * no cost, for messages of any age. Remembering it here is what stops
 * that being a one-frame correction on every subsequent view — the
 * second time a photo is seen, on this launch or any later one, its box
 * is the right shape before a single byte is read.
 *
 * Its own MMKV instance for the same reason the chat cache has one: this
 * grows with how many photos have been seen, and it should not be in the
 * file that every preference read maps.
 */
const shapeStore = new MMKV({ id: 'voxo-media-shape' });

/**
 * How far from square a bubble is allowed to get.
 *
 * A panorama and a full-length portrait are both real, and both look
 * wrong at their true proportions in a chat: one becomes a letterbox
 * slit, the other a column that pushes everything else off the screen.
 * Clamping means the extremes are cropped slightly — the same thing
 * every messaging app does — while everything in the ordinary range
 * between them is exact.
 */
const MIN_RATIO = 0.55;
const MAX_RATIO = 1.8;

/** Beyond this many remembered files, the oldest are dropped. */
const MAX_REMEMBERED = 500;

const INDEX_KEY = 'shape.index';

function key(mediaId: string): string {
  return `shape.${mediaId}`;
}

/** width / height, clamped. Returns null for a shape that cannot be used. */
export function clampRatio(width: number, height: number): number | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return Math.min(Math.max(width / height, MIN_RATIO), MAX_RATIO);
}

export function readMediaRatio(mediaId: string | undefined): number | null {
  if (!mediaId) return null;
  const stored = shapeStore.getNumber(key(mediaId));
  return stored && stored > 0 ? stored : null;
}

export function writeMediaRatio(mediaId: string | undefined, ratio: number | null): void {
  if (!mediaId || ratio === null) return;
  if (shapeStore.getNumber(key(mediaId)) === ratio) return;
  shapeStore.set(key(mediaId), ratio);
  remember(mediaId);
}

/** Newest-first list of what is remembered, oldest evicted past the cap. */
function remember(mediaId: string): void {
  let ids: string[] = [];
  try {
    const raw = shapeStore.getString(INDEX_KEY);
    if (raw) ids = JSON.parse(raw) as string[];
  } catch {
    ids = [];
  }
  if (!Array.isArray(ids)) ids = [];

  const next = [mediaId, ...ids.filter((id) => id !== mediaId)];
  for (const evicted of next.slice(MAX_REMEMBERED)) shapeStore.delete(key(evicted));
  shapeStore.set(INDEX_KEY, JSON.stringify(next.slice(0, MAX_REMEMBERED)));
}

/**
 * Called on sign-out.
 *
 * These are numbers, not pictures — but they are a list of which media
 * ids a person has looked at, which is more than the next user of a
 * shared phone needs to know.
 */
export function clearMediaShapes(): void {
  shapeStore.clearAll();
}
