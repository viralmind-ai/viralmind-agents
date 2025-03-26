import mongoose from 'mongoose';
import { DBForgeRace } from '../types/index.ts';

// Store generated races
export const forgeRaceSchema = new mongoose.Schema<DBForgeRace>(
  {
    title: { type: String, required: true },
    description: { type: String, required: true },
    category: { type: String, required: true },
    icon: { type: String, required: true },
    skills: [{ type: String, required: true }],
    agent_prompt: { type: String, required: true },
    pool_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TrainingPool', required: true }
  },
  {
    collection: 'forge_races',
    timestamps: true
  }
);

export const ForgeRaceModel = mongoose.model('ForgeRace', forgeRaceSchema);
