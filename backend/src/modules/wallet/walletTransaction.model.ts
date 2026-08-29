import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const WALLET_TRANSACTION_TYPES = ['CREDIT', 'DEBIT'] as const;
export type WalletTransactionType = (typeof WALLET_TRANSACTION_TYPES)[number];

/** Append-only ledger — balances are derived/reconciled from this, never edited after the fact. */
const walletTransactionSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    walletId: { type: Schema.Types.ObjectId, ref: 'Wallet', required: true, index: true },
    type: { type: String, enum: WALLET_TRANSACTION_TYPES, required: true },
    amount: { type: Number, required: true, min: 0 },
    reason: { type: String, required: true },
    referenceId: { type: String }, // e.g. a Message._id for per-message billing
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// Keyed on _id because that is what the list actually sorts and paginates
// by (`.sort({_id:-1})` with an `_id < cursor` range). The createdAt index
// this replaces matched the filter but not the sort, so every page loaded
// the whole matching set and sorted it in memory. ObjectId order is
// insertion order, so the rows come back in exactly the same sequence.
walletTransactionSchema.index({ tenantId: 1, _id: -1 });
walletTransactionSchema.index({ walletId: 1, createdAt: -1 });

export type WalletTransactionDoc = HydratedDocument<InferSchemaType<typeof walletTransactionSchema>>;
export const WalletTransaction = model('WalletTransaction', walletTransactionSchema);
