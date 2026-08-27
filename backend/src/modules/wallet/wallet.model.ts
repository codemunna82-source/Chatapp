import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

const walletSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, unique: true },
    // Denormalized running balance — kept consistent by always writing it in
    // the same transaction/session as the WalletTransaction that changes it
    // (see wallet.repository.ts), and reconcilable at any time by summing
    // WalletTransaction.amount for the wallet.
    balance: { type: Number, required: true, default: 0 },
    currency: { type: String, default: 'USD' },
  },
  { timestamps: true },
);

export type WalletDoc = HydratedDocument<InferSchemaType<typeof walletSchema>>;
export const Wallet = model('Wallet', walletSchema);
