import { Types } from 'mongoose';
import { encodeCursorParts, decodeCursor, afterCursor } from './conversation.repository';

/**
 * Proves the chat list's keyset pagination is complete and duplicate-free,
 * without needing a database.
 *
 * The predicate afterCursor() builds is evaluated here by a small
 * interpreter that implements the same comparison semantics MongoDB does
 * for `$lt` on a boolean, a Date and an ObjectId. That is enough to catch
 * the class of bug this replaced — a cursor keyed on a field the query
 * does not sort by, which dropped rows between pages — because such a
 * cursor fails this simulation for exactly the same reason it failed in
 * production.
 */

interface Row {
  id: string;
  pinned: boolean;
  updatedAt: Date;
}

/** The list's sort: pinned first, then most recently active, _id breaking ties. */
function compareDesc(a: Row, b: Row): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  if (a.updatedAt.getTime() !== b.updatedAt.getTime()) return b.updatedAt.getTime() - a.updatedAt.getTime();
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** Evaluates one `$or` branch produced by afterCursor against a row. */
function matchesBranch(row: Row, branch: Record<string, unknown>): boolean {
  for (const [field, condition] of Object.entries(branch)) {
    const value = field === '_id' ? row.id : field === 'pinned' ? row.pinned : row.updatedAt;

    if (condition instanceof Date) {
      if ((value as Date).getTime() !== condition.getTime()) return false;
      continue;
    }
    if (typeof condition === 'boolean') {
      if (value !== condition) return false;
      continue;
    }
    const lt = (condition as { $lt: unknown }).$lt;
    if (typeof lt === 'boolean') {
      // BSON orders false below true.
      if (!(Number(value as boolean) < Number(lt))) return false;
    } else if (lt instanceof Date) {
      if (!((value as Date).getTime() < lt.getTime())) return false;
    } else {
      if (!(String(value) < String(lt))) return false;
    }
  }
  return true;
}

function matches(row: Row, branches: Record<string, unknown>[]): boolean {
  return branches.some((branch) => matchesBranch(row, branch));
}

function makeRows(count: number): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < count; i += 1) {
    rows.push({
      id: String(new Types.ObjectId()),
      // Roughly a third pinned, and deliberately NOT correlated with _id
      // order — the old cursor only looked correct because test data
      // usually is.
      pinned: i % 3 === 0,
      updatedAt: new Date(Date.UTC(2026, 0, 1) + ((i * 7919) % 1000) * 60_000),
    });
  }
  return rows;
}

function pageThrough(rows: Row[], pageSize: number): Row[] {
  const sorted = [...rows].sort(compareDesc);
  const seen: Row[] = [];
  let cursor: string | null = null;

  // Bounded so a cursor that fails to advance ends the test rather than
  // hanging it.
  for (let guard = 0; guard < 100; guard += 1) {
    const available = cursor
      ? sorted.filter((row) => matches(row, afterCursor(decodeCursor(cursor as string)!)))
      : sorted;
    const page = available.slice(0, pageSize);
    if (page.length === 0) break;
    seen.push(...page);
    const last = page[page.length - 1]!;
    cursor = encodeCursorParts(last.pinned, last.updatedAt, last.id);
    if (available.length <= pageSize) break;
  }
  return seen;
}

describe('conversation list keyset cursor', () => {
  it('round-trips through encode/decode', () => {
    const id = String(new Types.ObjectId());
    const updatedAt = new Date('2026-03-04T05:06:07.000Z');
    const decoded = decodeCursor(encodeCursorParts(true, updatedAt, id))!;

    expect(decoded.pinned).toBe(true);
    expect(decoded.updatedAt.getTime()).toBe(updatedAt.getTime());
    expect(String(decoded.id)).toBe(id);
  });

  it('rejects a malformed cursor instead of throwing', () => {
    expect(decodeCursor('not-a-cursor')).toBeNull();
    expect(decodeCursor(Buffer.from('1:notanumber:abc').toString('base64url'))).toBeNull();
  });

  it('visits every conversation exactly once, in sort order', () => {
    const rows = makeRows(47);
    const seen = pageThrough(rows, 10);

    expect(seen).toHaveLength(rows.length);
    expect(new Set(seen.map((r) => r.id)).size).toBe(rows.length);
    expect(seen.map((r) => r.id)).toEqual([...rows].sort(compareDesc).map((r) => r.id));
  });

  it('does not lose rows that share an updatedAt', () => {
    // The tie-break case: without _id in the cursor these rows page
    // against each other forever or vanish.
    const sameMoment = new Date('2026-02-02T00:00:00.000Z');
    const rows: Row[] = Array.from({ length: 12 }, (_, i) => ({
      id: String(new Types.ObjectId()),
      pinned: i < 4,
      updatedAt: sameMoment,
    }));

    const seen = pageThrough(rows, 5);
    expect(new Set(seen.map((r) => r.id)).size).toBe(rows.length);
  });
});
