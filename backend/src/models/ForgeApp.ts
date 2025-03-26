import mongoose from 'mongoose';
import { DBForgeApp } from '../types/index.ts';

const ForgeAppSchema = new mongoose.Schema<DBForgeApp>(
  {
    name: { type: String, required: true },
    domain: { type: String, required: true },
    description: { type: String, required: false },
    categories: [{ type: String, required: false }],
    pool_id: { type: mongoose.Schema.Types.ObjectId, ref: 'TrainingPool', required: true },
    tasks: [
      {
        prompt: { type: String, required: true },
        uploadLimit: { type: Number, required: false },
        rewardLimit: { type: Number, required: false }
      }
    ]
  },
  {
    collection: 'forge_apps',
    timestamps: true
  }
);

export const ForgeAppModel = mongoose.model('ForgeApp', ForgeAppSchema);
