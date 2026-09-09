import { Types } from 'mongoose';
import { groupByNormalizedPhone, chooseSurvivor } from './mergeDuplicateContacts';
import type { ContactLean } from './contact.model';

/**
 * No database: grouping and survivor choice are the judgement the whole
 * migration rests on, and getting either wrong merges the wrong customers
 * together — which no amount of care further down would undo.
 */
function contact(phone: string, over: Partial<ContactLean> = {}): ContactLean {
  return {
    _id: new Types.ObjectId(),
    tenantId: new Types.ObjectId(),
    phone,
    tags: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as unknown as ContactLean;
}

describe('groupByNormalizedPhone', () => {
  it('groups the two formats the split produced', () => {
    // The exact case this migration exists for: the REST API wrote the
    // leading +, Meta's webhook did not.
    const groups = groupByNormalizedPhone([contact('+919876543210'), contact('919876543210')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
  });

  it('leaves a number that appears once alone', () => {
    expect(groupByNormalizedPhone([contact('+919876543210'), contact('+919999900000')])).toEqual([]);
  });

  it('does not group different numbers that merely look alike', () => {
    expect(groupByNormalizedPhone([contact('+919876543210'), contact('+919876543211')])).toEqual([]);
  });

  it('groups punctuation variants of one number', () => {
    const groups = groupByNormalizedPhone([
      contact('+91 98765-43210'),
      contact('919876543210'),
      contact('00919876543210'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(3);
  });

  it('never groups two unparseable numbers together', () => {
    // Bad values must group only with an identical bad value, or the
    // migration would merge unrelated customers on the strength of both
    // being wrong.
    expect(groupByNormalizedPhone([contact('not-a-number'), contact('also-bad')])).toEqual([]);
  });

  it('still groups two identical unparseable values', () => {
    const groups = groupByNormalizedPhone([contact('weird-id'), contact('weird-id')]);
    expect(groups).toHaveLength(1);
  });
});

describe('chooseSurvivor', () => {
  it('keeps the oldest row, not the prettiest number', () => {
    // ObjectId order is insertion order, and the older contact is the one
    // the workspace's history hangs off. Keeping the nicer-looking phone
    // string but discarding the older thread optimises the wrong thing —
    // the survivor's number is rewritten to canonical form regardless.
    const older = contact('919876543210');
    const newer = contact('+919876543210');
    expect(String(chooseSurvivor([newer, older])._id)).toBe(String(older._id));
  });

  it('is stable however the group is ordered', () => {
    const a = contact('919876543210');
    const b = contact('+919876543210');
    const c = contact('0091 98765 43210');
    const pick = (g: ContactLean[]) => String(chooseSurvivor(g)._id);
    expect(pick([a, b, c])).toBe(pick([c, b, a]));
    expect(pick([b, a, c])).toBe(pick([a, c, b]));
  });
});
