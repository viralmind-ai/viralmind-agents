import mongoose from 'mongoose';
import { DBGymSession } from '../types/index.ts';

export const gymSessionSchema = new mongoose.Schema<DBGymSession>(
  {
    _id: { type: mongoose.Schema.Types.ObjectId, auto: true },
    address: { type: String, required: true },
    status: { type: String, enum: ['active', 'completed', 'expired'], required: true },
    preview: { type: String },
    created_at: { type: Date, required: true },
    updated_at: { type: Date, required: true }
  },
  { collection: 'gym_sessions' }
);

export const GymSessionModel = mongoose.model('GymSession', gymSessionSchema);
