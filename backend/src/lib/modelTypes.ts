import type { Types } from 'mongoose';

/**
 * The two fields `{ timestamps: true }` adds at runtime.
 *
 * Mongoose's InferSchemaType only sees what the schema literal declares,
 * so a document with timestamps enabled has createdAt/updatedAt at runtime
 * but not in its inferred type — which is why serialisers reached for
 * `doc.get('createdAt')`, an untyped escape hatch that returns `any`.
 *
 * Intersecting this into a model's attribute type restores both: the
 * fields are typed as Dates on hydrated documents, and — the reason it
 * matters — a `.lean()` result is then assignable to the same type, so one
 * serialiser can take either.
 */
export interface Timestamps {
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A plain object as returned by `.lean()`: the schema's own fields plus
 * timestamps plus the _id Mongo always adds.
 *
 * `.lean()` skips constructing a Mongoose document per row — no getters,
 * setters, change tracking or validation machinery — which is worth having
 * on list endpoints that serialise straight to JSON and never call a
 * document method.
 */
export type Lean<TAttrs> = TAttrs & { _id: Types.ObjectId };
