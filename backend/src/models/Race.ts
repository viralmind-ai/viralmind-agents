import mongoose from 'mongoose';
import { DBRace } from '../types/index.ts';

export const raceSchema = new mongoose.Schema<DBRace>(
  {
    id: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    category: {
      type: String,
      enum: ['creative', 'mouse', 'slacker', 'gaming', 'wildcard'],
      required: true
    },
    icon: { type: String, default: 'trophy' },
    colorScheme: {
      type: String,
      enum: ['pink', 'blue', 'purple', 'orange', 'indigo', 'emerald'],
      required: false
    },
    prompt: { type: String, required: true },
    reward: { type: Number, required: true },
    buttonText: { type: String, default: 'Join Race' },
    stakeRequired: { type: Number, required: false }
  },
  { collection: 'races' }
);

export const RaceModel = mongoose.model('Race', raceSchema);
