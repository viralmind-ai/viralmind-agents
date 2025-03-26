import mongoose from 'mongoose';
import { DBRaceSession, VPSRegion } from '../types/index.ts';

export const raceSessionSchema = new mongoose.Schema<DBRaceSession>(
  {
    _id: { type: mongoose.Schema.Types.ObjectId, auto: true },
    address: { type: String, required: true },
    challenge: { type: String, ref: 'Challenge', required: true },
    prompt: { type: String, required: true },
    category: {
      type: String,
      enum: ['creative', 'mouse', 'slacker', 'gaming', 'wildcard'],
      required: true
    },
    vm_ip: { type: String, required: true },
    vm_port: { type: Number, required: true },
    vm_password: { type: String, required: true },
    vm_region: { type: String, enum: Object.values(VPSRegion), required: true },
    vm_credentials: {
      guacToken: { type: String, required: false },
      guacConnectionId: { type: String, required: false },
      guacClientId: { type: String, required: false },
      username: { type: String, required: true },
      password: { type: String, required: true }
    },
    status: {
      type: String,
      enum: ['active', 'completed', 'expired'],
      default: 'active'
    },
    video_path: { type: String },
    preview: { type: String }, // Base64 encoded screenshot
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
    transaction_signature: { type: String, required: false },
    stream_id: { type: String }
  },
  { collection: 'race_sessions' }
);

// Update the updated_at timestamp on save
raceSessionSchema.pre('save', function (next) {
  this.updated_at = new Date();
  next();
});

export const RaceSessionModel = mongoose.model('RaceSession', raceSessionSchema);
