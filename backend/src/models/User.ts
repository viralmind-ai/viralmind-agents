import mongoose from 'mongoose';
import { DBUser } from '../types/index.ts';

export const userSchema = new mongoose.Schema<DBUser>(
  {
    api_key: String,
    address: String,
    date_created: { type: Date, default: Date.now }
  },
  { collection: 'users' }
);
export const UserModel = mongoose.model('User', userSchema);
