import { Schema, model } from 'mongoose';
import { DBWalletConnection } from '../types/db.ts';

const walletConnectionSchema = new Schema<DBWalletConnection>(
  {
    token: { type: String, required: true, unique: true },
    address: { type: String, required: true },
    nickname: { type: String, required: false },
    createdAt: { type: Date, default: Date.now, expires: 3600 } // Expire after 1 hour
  },
  { collection: 'wallet_connections' }
);

export const WalletConnectionModel = model<DBWalletConnection>(
  'WalletConnection',
  walletConnectionSchema
);
